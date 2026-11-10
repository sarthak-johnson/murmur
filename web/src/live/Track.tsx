/*
 * The phase track: phases as segments left to right, tasks as stations that open their
 * page, and a dashed "Beyond the plan" segment when work goes on after the plan. Under
 * 900 px the same list reads top to bottom (CSS only), every station named.
 */
import type { AgentView, PhaseView, RequestView, TaskView } from "@murmur/core";
import type { CSSProperties } from "react";
import { follow, partPath } from "../router";
import { livePhase, type Mark, phaseSpan, shortTitle } from "../session";
import { clock, duration, nOf, verdictOf } from "../story";
import { StateMark } from "./Rail";

type Shown = "done" | "now" | "todo" | "failed" | "blocked" | "open";

const WORD: Record<Shown, string> = {
  done: "done",
  now: "in progress",
  blocked: "waiting on you",
  todo: "not started",
  failed: "failed",
  open: "left open",
};
const MARK: Record<Shown, Mark> = {
  done: "done",
  now: "running",
  todo: "open",
  failed: "failed",
  blocked: "waiting",
  open: "open",
};

interface Station {
  key: string;
  name: string;
  title: string;
  shown: Shown;
  part?: string | undefined;
}

/**
 * Which stations are captioned: the first, the live and the last; of two side by side
 * the live one keeps it. Each caption gets the room between its neighbours' midpoints.
 */
function captions(stations: Station[]): Map<number, CSSProperties> {
  const n = stations.length;
  const live = stations.findIndex((s) => s.shown === "now");
  let on = [...new Set([0, live, n - 1])]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (n > 3)
    on = on.filter((i, k) => {
      const near = (j: number | undefined) =>
        j !== undefined && Math.abs(j - i) === 1;
      return i === live || !(near(on[k - 1]) || near(on[k + 1])) || live < 0;
    });
  const at = (i: number) => ((i + 0.5) / n) * 100;
  const out = new Map<number, CSSProperties>();
  on.forEach((i, k) => {
    const prev = on[k - 1];
    const next = on[k + 1];
    const a = prev === undefined ? 0 : (at(prev) + at(i)) / 2;
    const b = next === undefined ? 100 : (at(i) + at(next)) / 2;
    const p = (at(i) - a) / (b - a);
    const align = p < 0.3 ? "left" : p > 0.7 ? "right" : "center";
    out.set(i, {
      "--a": `${a}%`,
      "--w": `${b - a}%`,
      "--align": align,
    } as CSSProperties);
  });
  return out;
}

function Stations(props: { stations: Station[]; href(part: string): string }) {
  const { stations, href } = props;
  const caps = captions(stations);
  return (
    <ol className="trk-st">
      {stations.map((s, i) => {
        const cap = caps.get(i);
        const inner = (
          <>
            <StateMark mark={MARK[s.shown]} />
            <span className={cap ? "cap on" : "cap"} style={cap}>
              {s.name}
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
                data-morph=""
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

const span = (from?: string, to?: string) =>
  from && to
    ? clock(from) === clock(to)
      ? clock(from)
      : `${clock(from)} to ${clock(to)}`
    : "";

function agentShown(a: AgentView, over: boolean): Shown {
  if (a.status === "running") return over ? "open" : "now";
  if (/failed|killed/.test(a.report?.status ?? "")) return "failed";
  return "done";
}

/** The plan as a track, with its foot line. Not drawn for a request with no plan. */
export function PhaseTrack(props: {
  sessionId: string;
  request: RequestView;
  done: boolean;
  /** The clock stops at `end`: done, or waiting on you with no helper at work. */
  stopped: boolean;
  end: string;
}) {
  const { sessionId, request: req, done, stopped, end } = props;
  if (!req.phases.length) return null;
  const over = done || req.finished;
  const live = livePhase(req, done);
  const taskShown = (t: TaskView): Shown =>
    t.status === "failed"
      ? "failed"
      : t.status === "done"
        ? "done"
        : over
          ? "open"
          : t.status;
  // Waiting on you outranks running: it is the one thing the reader can do.
  const phaseShown = (ph: PhaseView): Shown =>
    ph.status === "done"
      ? "done"
      : over
        ? "open"
        : ph.status === "blocked"
          ? "blocked"
          : ph === live || ph.status === "now"
            ? "now"
            : ph.tasks.some((t) => t.status === "failed")
              ? "failed"
              : "todo";
  const href = (part: string) => partPath(sessionId, req.id, part);
  const tasks = req.phases.flatMap((p) => p.tasks);
  const doneN = tasks.filter((t) => t.status === "done").length;
  const beyond = req.beyond;
  const beyondAgents = beyond
    ? req.agents
        .filter((a) => beyond.agents.includes(a.id))
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    : [];
  const running = req.agents.filter((a) => a.status === "running").length;
  const now = new Date().toISOString();

  const sub = (ph: PhaseView, shown: Shown) => {
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
  };

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
      : ["Elapsed", duration(req.startedAt, stopped ? end : now)],
  ];

  return (
    <section className="trk" aria-label="Phase track">
      <ol className="trk-segs">
        {req.phases.map((ph) => {
          const shown = phaseShown(ph);
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
                  "--wt": Math.max(ph.tasks.length, 3),
                  "--fill": fill,
                } as CSSProperties
              }
            >
              <div className="trk-lbl">
                <span className="trk-n" title={ph.title}>
                  {ph.title}
                </span>
                <span className="trk-s">{sub(ph, shown)}</span>
              </div>
              <Stations
                href={href}
                stations={ph.tasks.map((t) => ({
                  key: t.id,
                  name: shortTitle(t.title),
                  title: t.ask
                    ? `${t.title}. Waiting on you: ${t.ask.text}`
                    : t.problem
                      ? `${t.title}: ${t.problem}`
                      : t.title,
                  shown: taskShown(t),
                  part: t.part,
                }))}
              />
            </li>
          );
        })}
        {beyond && (
          <li
            className="trk-seg beyond"
            style={
              { "--wt": Math.max(beyondAgents.length, 3) } as CSSProperties
            }
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
