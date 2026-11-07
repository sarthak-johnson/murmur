import type {
  AgentView,
  MurmurEvent,
  PartView,
  RequestView,
} from "@murmur/core";
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
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480];
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
}) {
  const { request, part, helpers, events } = props;
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
  const ticks = Array.from(
    { length: Math.round((stop - start) / step) + 1 },
    (_, i) => start + i * step,
  );

  return (
    <div className="rec">
      <div className="axis" aria-hidden="true">
        <div />
        <div className="ticks">
          {ticks.map((m) => (
            <span key={m} className="num" style={{ left: pct(pos(m)) }}>
              {clock(new Date(m * MIN).toISOString())}
            </span>
          ))}
        </div>
      </div>
      <ul className="lanes" aria-label="Timeline">
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
                {lane.runs.map((run) => {
                  const { label, tone } = run;
                  const l = pos(t(run.from));
                  const r = pos(t(run.to));
                  // Late bars hang from their end so their label stays on the axis.
                  const place =
                    l > 0.6
                      ? { right: pct(1 - r), minWidth: pct(r - l) }
                      : { left: pct(l), minWidth: pct(r - l) };
                  return (
                    <span
                      key={run.from}
                      className={`run ${tone}`}
                      style={place}
                      title={`${lane.a.description}, ${clock(run.from)} to ${clock(run.to)}`}
                    >
                      {label}
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
