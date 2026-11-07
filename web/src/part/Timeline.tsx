import type {
  AgentView,
  MurmurEvent,
  PartView,
  RequestView,
} from "@murmur/core";
import { useLayoutEffect, useRef, useState } from "react";
import { cutWords } from "../catchup";
import { Glyph } from "../live/PlanColumn";
import { plainText } from "../markdown";
import {
  type HelperKind,
  helperKind,
  helperRuns,
  modelOf,
  type Run,
} from "../session";
import { clock, firstSentence, verdictOf } from "../story";

type Tone = "plain" | "bad" | "good" | "now";
const ROLE: Record<HelperKind, string> = {
  build: "builder",
  review: "reviewer",
  recheck: "recheck",
};
const MIN = 60_000;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440, 2880];
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** A bar's label in px, estimated: 12 px semibold, 8 px padding a side. */
const labelPx = (text: string) => 16 + text.length * 7;
/** The track's width before it is measured (and in tests, which have no layout). */
const TRACK = 640;
const pct = (x: number) => `${+(x * 100).toFixed(4)}%`;

/** Claude's own closing step on a task: the recap's last line, else its last word about it. */
function closing(req: RequestView, part: PartView) {
  const tasks = new Set(
    req.phases
      .flatMap((p) => p.tasks.filter((t) => t.part === part.id))
      .map((t) => t.id),
  );
  const said = req.messages?.findLast((m) => m.task && tasks.has(m.task));
  const text = req.recap
    ? part.steps.at(-1)?.text
    : said
      ? firstSentence(said.text)
      : undefined;
  return text ? { text: plainText(text), ts: said?.ts } : undefined;
}

export interface Lane {
  a: AgentView;
  kind: HelperKind | undefined;
  runs: (Run & { label: string; tone: Tone })[];
}

/**
 * Each helper's runs, named by what they were and judged by how they ended: a build is
 * built or fixed; a review or recheck followed by more building sent the work back,
 * else it passed once the task is done.
 */
export function helperLanes(
  part: PartView,
  helpers: AgentView[],
  events: MurmurEvent[],
): Lane[] {
  const now = new Date().toISOString();
  const lanes = [...helpers]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((a) => ({ a, kind: helperKind(a), runs: helperRuns(a, events, now) }));
  const all = lanes.flatMap((l) => l.runs.map((r) => ({ ...r, ...l })));
  const judge = (
    { a, kind }: (typeof lanes)[number],
    run: Run,
    i: number,
  ): [string, Tone] => {
    if (run.running) return [kind === "build" ? "Building" : "Running", "now"];
    const v = verdictOf(a.report);
    if (a.report?.status === "failed") return ["Failed", "bad"];
    if (kind === "build")
      return [
        i > 0 || /^fix\b/i.test(a.description) ? "Fixed" : "Built",
        "plain",
      ];
    if (kind === "review" || kind === "recheck") {
      const fixedAfter = all.some(
        (o) =>
          o.a !== a &&
          o.from >= run.to &&
          (o.kind === "build" || (kind === "review" && o.kind === "recheck")),
      );
      if (fixedAfter || v?.tone === "bad") return ["Sent back", "bad"];
      if (part.status === "done" || v?.tone === "done")
        return ["Passed", "good"];
      return [kind === "review" ? "Reviewed" : "Rechecked", "plain"];
    }
    return [v?.label ?? "Worked", v?.tone === "bad" ? "bad" : "plain"];
  };
  return lanes.map((l) => ({
    ...l,
    runs: l.runs.map((r, i) => {
      const [label, tone] = judge(l, r, i);
      return { ...r, label, tone };
    }),
  }));
}

/**
 * How a task went on one time axis: a lane per helper, each run of its work a bar named
 * by what it was and coloured by how it ended, and Claude's closing step at the end.
 */
export function Timeline(props: {
  request: RequestView;
  part: PartView;
  helpers: AgentView[];
  events: MurmurEvent[];
  /** What each helper's work was, in the plan's words, by helper id: names its first bar. */
  named?: Map<string, string>;
}) {
  const { request, part, helpers, events, named } = props;
  const lanesRef = useRef<HTMLUListElement>(null);
  const [track, setTrack] = useState(TRACK);
  useLayoutEffect(() => {
    const el = lanesRef.current?.querySelector(".tr");
    if (!el) return;
    const read = () => setTrack(el.clientWidth || TRACK);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lanes = helperLanes(part, helpers, events);
  if (!lanes.length) return null;
  const all = lanes.flatMap((l) => l.runs);
  const end = closing(request, part);

  const t = (iso: string) => Date.parse(iso) / MIN;
  const from = Math.min(...all.map((r) => t(r.from)));
  const to = Math.max(
    ...all.map((r) => t(r.to)),
    ...(end?.ts ? [t(end.ts)] : []),
  );
  const step = STEPS.find((s) => (to - from) / s <= 7) ?? 960;
  const start = Math.floor(from / step) * step;
  const stop = Math.max(Math.ceil(to / step) * step, start + step);
  const pos = (m: number) => (m - start) / (stop - start);
  const multiDay =
    new Date(start * MIN).toDateString() !==
    new Date(stop * MIN).toDateString();
  const ticks = Array.from(
    { length: Math.round((stop - start) / step) + 1 },
    (_, i) => start + i * step,
  );

  return (
    <div className="rec">
      <div className="axis" aria-hidden="true">
        <div />
        <div className="ticks">
          {ticks.map((m, i) => {
            const d = new Date(m * MIN);
            // Past midnight the day is named, on the first tick and where it turns.
            const prev = new Date((ticks[i - 1] ?? m) * MIN);
            const day =
              multiDay && (i === 0 || prev.getDate() !== d.getDate())
                ? `${d.getDate()} ${MONTHS[d.getMonth()]} `
                : "";
            return (
              <span key={m} className="num" style={{ left: pct(pos(m)) }}>
                {day}
                {clock(d.toISOString())}
              </span>
            );
          })}
        </div>
      </div>
      <ul
        className="lanes"
        aria-label="Timeline"
        ref={lanesRef}
        style={{ "--step": pct(step / (stop - start)) } as never}
      >
        {lanes.map((lane) => {
          const k = request.agents.indexOf(lane.a) + 1;
          const model = modelOf(lane.a, events);
          const role = [model, lane.kind ? ROLE[lane.kind] : ""]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={lane.a.id} className="lane">
              <span className="lane-name">
                <b>Agent {k}</b>
                {role && <span>{role}</span>}
              </span>
              <span className="tr">
                {lane.runs.map((run, i) => {
                  const { tone } = run;
                  const l = pos(t(run.from));
                  const r = pos(t(run.to));
                  // At its true width; the plan's words name it when they fit, else its
                  // short name, else the short name goes beside the bar.
                  const room = (r - l) * track;
                  const said = i === 0 ? named?.get(lane.a.id) : undefined;
                  const fit = Math.floor((room - 16) / 7);
                  const label =
                    said && fit >= 14 && labelPx(said) > labelPx(run.label)
                      ? cutWords(said, fit)
                      : run.label;
                  const out = labelPx(label) > room;
                  const flip = out && r > 0.8;
                  return (
                    <span
                      key={run.from}
                      className={`run ${tone}${out ? " out" : ""}${flip ? " flip" : ""}`}
                      style={{ left: pct(l), width: pct(r - l) }}
                      title={`${said ?? lane.a.description}, ${clock(run.from)} to ${clock(run.to)}`}
                    >
                      <span className="run-label">{label}</span>
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
        {end && (
          <li className="lane">
            <span className="lane-name">
              <b>Claude</b>
            </span>
            <span className="tr">
              <span
                className="close"
                style={{ right: pct(1 - pos(end.ts ? t(end.ts) : to)) }}
                title={end.text}
              >
                {cutWords(end.text, 64)}
                {part.status === "done" && <Glyph status="done" />}
              </span>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
