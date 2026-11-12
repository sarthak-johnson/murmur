/*
 * The phase track: phases as segments left to right, tasks as stations that open their
 * page, and a dashed "Beyond the plan" segment when work goes on after the plan. Every
 * station is named under its dot. Under 900 px, or when a phase's stations get too narrow
 * to name, the same list reads top to bottom.
 */
import type { AgentView, PhaseView, RequestView, TaskView } from "@murmur/core";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { PIECES, StateMark, Words } from "../marks";
import { follow, partPath } from "../router";
import { livePhase, type Mark, phaseSpan, shortTitle } from "../session";
import { helperNow, WORD as STATE_WORD, type State, workState } from "../state";
import { clock, duration, nOf, verdictOf } from "../story";

export type Shown =
  | "done"
  | "now"
  | "todo"
  | "failed"
  | "blocked"
  | "open"
  | "paused";

/** The state words of state.ts, in lower case for a list's screen-reader tail. */
export const WORD: Record<Shown, string> = {
  done: STATE_WORD.done.toLowerCase(),
  now: STATE_WORD.running.toLowerCase(),
  blocked: STATE_WORD.waiting.toLowerCase(),
  todo: STATE_WORD.todo.toLowerCase(),
  failed: STATE_WORD.failed.toLowerCase(),
  open: STATE_WORD.open.toLowerCase(),
  paused: STATE_WORD.paused.toLowerCase(),
};
export const MARK: Record<Shown, Mark> = {
  done: "done",
  now: "running",
  todo: "open",
  failed: "failed",
  blocked: "waiting",
  open: "open",
  paused: "open",
};

interface Station {
  key: string;
  name: string;
  title: string;
  shown: Shown;
  part?: string | undefined;
}

function Stations(props: {
  stations: Station[];
  href(part: string): string;
  stacked: boolean;
}) {
  const { stations, href, stacked } = props;
  const n = stations.length;
  return (
    <ol className="trk-st">
      {stations.map((s, i) => {
        // Each caption has its station's share of the phase, centred under its dot.
        const slot = stacked
          ? undefined
          : { left: `${(i * 100) / n}%`, width: `${100 / n}%` };
        const inner = (
          <>
            <StateMark mark={MARK[s.shown]} />
            <span className="cap" style={slot}>
              <Words text={s.name} />
            </span>
            <span className="sr-only">, {WORD[s.shown]}</span>
          </>
        );
        return (
          <li
            key={s.key}
            className={`st ${s.shown}`}
            style={
              {
                "--x": `${((i + 0.5) / stations.length) * 100}%`,
              } as CSSProperties
            }
          >
            {s.part ? (
              <a
                href={href(s.part)}
                title={s.title}
                onClick={follow(href(s.part))}
              >
                {inner}
              </a>
            ) : (
              <span title={s.title}>{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export const span = (from?: string, to?: string) =>
  from && to
    ? clock(from) === clock(to)
      ? clock(from)
      : `${clock(from)} to ${clock(to)}`
    : "";

const SHOWN: Record<State, Shown> = {
  running: "now",
  waiting: "blocked",
  paused: "paused",
  done: "done",
  open: "open",
  failed: "failed",
  todo: "todo",
};
/** A state (state.ts) as the lists draw it. */
export const shownOf = (s: State): Shown => SHOWN[s];
/** A request's state, from the old "over" flag where only that is known. */
const reqState = (r: boolean | State): State =>
  typeof r === "string" ? r : r ? "done" : "running";

/** A helper's state at `at` (state.ts `helperNow`), under its request's state. */
export function agentShown(
  a: AgentView,
  request: boolean | State,
  at = new Date().toISOString(),
): Shown {
  return SHOWN[helperNow(a, at, reqState(request)).state];
}

/** A task's state: once the request is over, one not done is left open (state.ts `workState`). */
export const taskShown = (t: TaskView, request: boolean | State): Shown =>
  SHOWN[workState(t.status, reqState(request))];

/** A phase's state; `live` is the phase where the work is (`livePhase`). */
export function phaseShown(
  ph: PhaseView,
  over: boolean,
  live: PhaseView | undefined,
): Shown {
  if (ph.status === "done") return "done";
  if (over) return "open";
  // Waiting on you outranks running: it is the one thing the reader can do.
  if (ph.status === "blocked") return "blocked";
  if (ph === live || ph.status === "now") return "now";
  return ph.tasks.some((t) => t.status === "failed") ? "failed" : "todo";
}

/** "2 of 5 done · 20:55 to 21:03": a phase's count and, as fits its state, its times. */
export function phaseLine(req: RequestView, ph: PhaseView, shown: Shown) {
  const n = ph.tasks.filter((t) => t.status === "done").length;
  const count = `${n} of ${ph.tasks.length} done`;
  const { from, to } = phaseSpan(req, ph);
  if (shown === "done")
    return [count, span(from, to)].filter(Boolean).join(" · ");
  if (shown === "open") return `${count} · left open`;
  if (shown === "blocked") return `${count} · waiting on you`;
  if (shown === "now")
    return from ? `${count} · started ${clock(from)}` : count;
  return `${nOf(ph.tasks.length, "task")}, not started`;
}

/**
 * A phase's share of the track's width: its stations, so every station across the track
 * gets the same slot; a phase of one gets two, so its name and count still read.
 */
const weight = (n: number) => Math.max(n, 2);

/** The gap between phases (`.trk-segs` in theme.css), the narrowest readable slot, and a caption's side padding (`.cap`). */
const GAP = 28;
const SLOT = 72;
const PAD = 10;

/**
 * Whether the track reads top to bottom at this width: when any phase's stations, each
 * with its share of the phase (phases share the width by `weight`), get under 72 px, or
 * under `widest[i]`, the phase's widest word, which would otherwise be cut.
 */
export function stacks(
  width: number,
  counts: number[],
  widest: number[] = [],
): boolean {
  const wts = counts.map(weight);
  const sum = wts.reduce((a, b) => a + b, 0);
  const room = width - GAP * (counts.length - 1);
  return counts.some(
    (n, i) =>
      n > 0 &&
      (room * (wts[i] as number)) / sum / n <
        Math.max(SLOT, (widest[i] ?? 0) + PAD),
  );
}

/** Each phase's widest piece of a caption, in the caption's own type (`.cap`), in px. */
function widestWords(el: Element, names: string[][]): number[] {
  const g = document.createElement("canvas").getContext("2d");
  if (!g) return [];
  g.font = `500 13px ${getComputedStyle(el).fontFamily}`;
  return names.map((phase) =>
    Math.max(
      0,
      ...phase
        .flatMap((name) => name.match(PIECES) ?? [])
        .filter((p) => p.trim())
        .map((p) => g.measureText(p).width),
    ),
  );
}

/** Stacked under 900 px or when `stacks` says so, measured on every resize. */
function useStacked(captions: string[][]) {
  const ref = useRef<HTMLOListElement>(null);
  const [stacked, setStacked] = useState(false);
  const key = JSON.stringify(captions);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const names = JSON.parse(key) as string[][];
    const narrow = window.matchMedia?.("(max-width: 899px)");
    let widest: number[] | undefined;
    const measure = () => {
      // Not laid out (hidden, or a test's DOM): nothing to measure.
      if (!narrow?.matches && el.clientWidth > 0)
        widest ??= widestWords(el, names);
      setStacked(
        !!narrow?.matches ||
          (el.clientWidth > 0 &&
            stacks(
              el.clientWidth,
              names.map((n) => n.length),
              widest,
            )),
      );
    };
    measure();
    // The first measure can run on the fallback font.
    document.fonts?.ready.then(() => {
      widest = undefined;
      measure();
    });
    const ro =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    narrow?.addEventListener("change", measure);
    return () => {
      ro?.disconnect();
      narrow?.removeEventListener("change", measure);
    };
  }, [key]);
  return { ref, stacked };
}

/** The plan as a track, with its foot line. Not drawn for a request with no plan. */
export function PhaseTrack(props: {
  sessionId: string;
  request: RequestView;
  done: boolean;
  /** Where its clock stops (state.ts `RequestNow.to`): never the wall clock in a replay. */
  end: string;
}) {
  const { sessionId, request: req, done, end } = props;
  const beyond = req.beyond;
  const beyondAgents = beyond
    ? req.agents
        .filter((a) => beyond.agents.includes(a.id))
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    : [];
  const { ref, stacked } = useStacked([
    ...req.phases.map((p) => p.tasks.map((t) => shortTitle(t.title))),
    ...(beyond ? [beyondAgents.map((a) => a.description || "A helper")] : []),
  ]);
  if (!req.phases.length) return null;
  const over = done || req.finished;
  const live = livePhase(req, done);
  const href = (part: string) => partPath(sessionId, req.id, part);
  const tasks = req.phases.flatMap((p) => p.tasks);
  const doneN = tasks.filter((t) => t.status === "done").length;
  const running = req.agents.filter((a) => a.status === "running").length;
  const still = [
    ...(running ? [`${nOf(running, "helper")} running`] : []),
    ...(beyond?.rounds
      ? [`${nOf(beyond.rounds, "fix round")} after the plan`]
      : []),
  ];
  const leftOpen = over ? tasks.length - doneN : 0;
  const foot: [string, string][] = [
    ["Plan", `${doneN} of ${tasks.length} done`],
    ...(!over && still.length
      ? [["Still working", still.join(", ")] as [string, string]]
      : []),
    ...(leftOpen
      ? [["Left open", nOf(leftOpen, "task")] as [string, string]]
      : []),
    over
      ? ["Took", duration(req.startedAt, end)]
      : ["Elapsed", duration(req.startedAt, end)],
  ];

  return (
    <section className={stacked ? "trk stack" : "trk"} aria-label="Phase track">
      <ol className="trk-segs" ref={ref}>
        {req.phases.map((ph) => {
          const shown = phaseShown(ph, over, live);
          const fill = ph.tasks.length
            ? ph.tasks.filter((t) => t.status === "done").length /
              ph.tasks.length
            : 0;
          return (
            <li
              key={ph.id}
              className={`trk-seg ${shown}`}
              style={
                {
                  "--wt": weight(ph.tasks.length),
                  "--fill": fill,
                } as CSSProperties
              }
            >
              <div className="trk-lbl">
                <span className="trk-n" title={ph.title}>
                  {ph.title}
                </span>
                <span className="trk-s">{phaseLine(req, ph, shown)}</span>
              </div>
              <Stations
                href={href}
                stacked={stacked}
                stations={ph.tasks.map((t) => ({
                  key: t.id,
                  name: shortTitle(t.title),
                  title: t.ask
                    ? `${t.title}. Waiting on you: ${t.ask.text}`
                    : t.problem
                      ? `${t.title}: ${t.problem}`
                      : t.title,
                  shown: taskShown(t, over),
                  // Its close-up by the task's own id: several tasks share one part.
                  part: t.part && t.id,
                }))}
              />
            </li>
          );
        })}
        {beyond && (
          <li
            className="trk-seg beyond"
            style={{ "--wt": weight(beyondAgents.length) } as CSSProperties}
          >
            <div className="trk-lbl">
              <span className="trk-n">Beyond the plan</span>
              <span className="trk-s">
                since {clock(beyond.since)} ·{" "}
                {over || !running ? "done" : "running"}
              </span>
            </div>
            <Stations
              href={href}
              stacked={stacked}
              stations={beyondAgents.map((a) => {
                const verdict = verdictOf(a.report)?.label;
                return {
                  key: a.id,
                  name: a.description || "A helper",
                  title: verdict
                    ? `${a.description}: ${verdict}`
                    : a.description,
                  shown: agentShown(a, over),
                  part: a.part,
                };
              })}
            />
          </li>
        )}
      </ol>
      <p className="trk-foot">
        {foot.map(([k, v], i) => (
          <span key={k}>
            {i > 0 && <span className="sr-only">; </span>}
            <b>{k}:</b>{" "}
            <span className={k === "Plan" ? undefined : "num"}>{v}</span>
          </span>
        ))}
      </p>
    </section>
  );
}
