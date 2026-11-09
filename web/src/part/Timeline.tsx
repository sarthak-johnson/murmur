import type {
  AgentRole,
  AgentView,
  MessageView,
  MurmurEvent,
  PartView,
  RequestView,
} from "@murmur/core";
import { useLayoutEffect, useRef, useState } from "react";
import { cutWords } from "../format";
import { plainText } from "../markdown";
import { Glyph } from "../marks";
import {
  type HelperKind,
  helperKind,
  helperRuns,
  modelOf,
  type Run,
} from "../session";
import { clock, duration, firstSentence, moment, verdictOf } from "../story";

type Tone = "plain" | "bad" | "good" | "now";
const ROLE: Record<HelperKind, string> = {
  build: "Builder",
  review: "Reviewer",
  recheck: "Recheck",
};
/** What a run did, for its round's marker: a resumed builder's later run is a fix. */
const DID: Partial<Record<AgentRole, string>> = {
  build: "build",
  fix: "fix",
  review: "review",
  recheck: "recheck",
  plan: "plan",
  research: "research",
};
/** A round marker's words in px, for 13 px Geist. */
const markPx = (text: string) => text.length * 7 + 12;
/** Claude's dots closer than this are one: the later one stays, unless it says less. */
const DOT = 12;
const MIN = 60_000;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440, 2880];
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** A bar's words in px, estimated for 13 px semibold Geist; a bar adds 8 px a side. */
const textPx = (text: string) => text.length * 7.4;
const labelPx = (text: string) => 16 + textPx(text);
/** An axis time in px, for 13 px Geist Mono, with room to breathe. */
const tickPx = (text: string) => text.length * 7.8 + 10;
/** How wide a cut gap is drawn, and how far a label sits beside its bar. */
const BREAK = 44;
/** The least a stretch between breaks is drawn, so its runs keep a readable width. */
const STRETCH = 72;
const BESIDE = 6;
/** How far words may run past the track's end, into the panel's right padding. */
const SPILL = 24;
/** The track's width before it is measured (and in tests, which have no layout). */
const TRACK = 640;
const pct = (x: number) => `${+(x * 100).toFixed(4)}%`;
const t = (iso: string) => Date.parse(iso) / MIN;
type Box = [number, number];
const meet = ([a, b]: Box, [c, d]: Box) => a < d && c < b;

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
  /** A lane of many helpers of one role: how many. */
  count?: number;
}

const RUNS: Record<HelperKind | "other", string> = {
  build: "builds",
  review: "reviews",
  recheck: "rechecks",
  other: "runs",
};

/** Past this many helpers, one lane per role: a lane each would be taller than the page. */
export const MANY = 10;

/** The lanes merged by role, builders first, each run keeping its own verdict. */
function byRole(lanes: Lane[]): Lane[] {
  const order: (HelperKind | undefined)[] = [
    "build",
    "review",
    "recheck",
    undefined,
  ];
  return order.flatMap((kind) => {
    const of = lanes.filter((l) => l.kind === kind);
    const first = of[0];
    if (!first) return [];
    const runs = of
      .flatMap((l) => l.runs)
      .sort((a, b) => a.from.localeCompare(b.from));
    return [{ a: first.a, kind, runs, count: of.length }];
  });
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
      // Core read the verdict from the record ("Sent back", "Passed"): it wins.
      const said = part.steps.findLast((s) => s.agentId === a.id)?.text;
      if (/^sent back\b/i.test(said ?? "")) return ["Sent back", "bad"];
      if (/^passed\b/i.test(said ?? "")) return ["Passed", "good"];
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
 * The rounds of work on the task, from each helper's `round`: a round starts at its first
 * helper's start, or earlier where a helper of the round before was resumed (sent back),
 * and is named by what its runs did in time order. None when it all took one round.
 */
export function roundMarks(
  lanes: Lane[],
): { n: number; from: string; words: string[] }[] {
  // Rounds of different subjects ("Task 19", "Task 20") are not one story.
  const subjects = new Set(lanes.flatMap((l) => l.a.subject ?? []));
  const ns = [
    ...new Set(lanes.flatMap((l) => (l.a.round ? [l.a.round] : []))),
  ].sort((a, b) => a - b);
  if (ns.length < 2 || subjects.size !== 1) return [];
  const rounds = ns.map((n) => ({ n, from: "", words: [] as string[] }));
  const runs = lanes
    .flatMap((l) =>
      l.a.round
        ? l.runs.map((r, i) => {
            // A helper's later run is the next round's, as far as rounds go.
            const k = Math.min(
              ns.indexOf(l.a.round as number) + i,
              ns.length - 1,
            );
            const role = l.a.role ?? "other";
            const did =
              i > 0 && (role === "build" || role === "fix") ? "fix" : DID[role];
            return { from: r.from, k, did };
          })
        : [],
    )
    .sort((a, b) => a.from.localeCompare(b.from));
  for (const { from, k, did } of runs) {
    const r = rounds[k] as (typeof rounds)[number];
    if (!r.from || from < r.from) r.from = from;
    if (did && !r.words.includes(did)) r.words.push(did);
  }
  return rounds.filter((r) => r.from);
}

const listed = (words: string[]) =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** Claude's messages about the task: naming one of its tasks, or right after its helpers' reports. */
export function claudeSaid(
  req: RequestView,
  part: PartView,
  helpers: AgentView[],
): MessageView[] {
  const tasks = new Set([
    part.id,
    ...req.phases
      .flatMap((p) => p.tasks.filter((t) => t.part === part.id))
      .map((t) => t.id),
  ]);
  const ids = new Set(helpers.map((a) => a.id));
  // Core's steps from the record name the messages about it by id.
  const named = new Set(part.steps.flatMap((s) => s.eventIds));
  return (req.messages ?? []).filter(
    (m) =>
      (m.task && tasks.has(m.task)) ||
      (m.agent && ids.has(m.agent)) ||
      named.has(m.id),
  );
}

export interface Bar {
  /** Left edge and width in px. */
  x: number;
  w: number;
  tone: Tone;
  /** What its runs were: "Fixed", "6 fix rounds", "Built +2". */
  text: string;
  runs: number;
  title: string;
  /** Where its words are drawn; none when they would touch another label or bar. */
  label?: { x: number; w: number; side: "in" | "right" | "left"; text: string };
}

export interface TimelineLayout {
  /** A time's place on the track, in px. */
  at: (iso: string) => number;
  /** Axis times: the tick at x, its words' box from l, w wide. */
  ticks: { x: number; l: number; w: number; text: string; from: boolean }[];
  /** Long idle stretches cut out of the axis, and how long each really was. */
  breaks: { x: number; w: number; skipped: number }[];
  bars: Bar[][];
}

const nameOf = (runs: Lane["runs"]) =>
  runs.length === 1
    ? (runs[0]?.label ?? "")
    : runs.every((r) => r.label === "Fixed")
      ? `${runs.length} fix rounds`
      : `${runs[0]?.label} +${runs.length - 1}`;

/**
 * Lays the lanes out on a track `track` px wide. Idle stretches long against the whole
 * span are cut to a marked break, so a day of work keeps readable bars. Runs too close
 * to be told apart merge into one bar named by what they were, and a bar's words are
 * drawn inside it, else beside it, else not at all (they stay in its tooltip).
 */
export function layoutTimeline(
  lanes: Lane[],
  track: number,
  extra: string[] = [],
  named?: Map<string, string>,
): TimelineLayout {
  const spans = [
    ...lanes.flatMap((l) => l.runs.map((r) => [t(r.from), t(r.to)] as Box)),
    ...extra.map((e) => [t(e), t(e)] as Box),
  ].sort((a, b) => a[0] - b[0]);
  const lo = spans[0]?.[0] ?? 0;
  const hi = Math.max(lo, ...spans.map((s) => s[1]));

  // Busy stretches, split where nothing happened for a long while.
  const cut = Math.max(20, (hi - lo) / 12);
  const busy: Box[] = [];
  for (const [f, e] of spans) {
    const b = busy.at(-1);
    if (b && f - b[1] <= cut) b[1] = Math.max(b[1], e);
    else busy.push([f, e]);
  }
  // Breaks and the least a stretch is drawn take at most 70% of the track: past that,
  // the shortest gaps are drawn after all.
  while ((busy.length - 1) * BREAK + busy.length * STRETCH > track * 0.7) {
    let k = 1;
    for (let i = 2; i < busy.length; i++)
      if (
        (busy[i]?.[0] ?? 0) - (busy[i - 1]?.[1] ?? 0) <
        (busy[k]?.[0] ?? 0) - (busy[k - 1]?.[1] ?? 0)
      )
        k = i;
    const [gone] = busy.splice(k, 1);
    const prev = busy[k - 1];
    if (gone && prev) prev[1] = gone[1];
  }

  let segs: Box[];
  let step: number;
  if (busy.length === 1) {
    step = STEPS.find((s) => (hi - lo) / s <= 7) ?? 960;
    const start = Math.floor(lo / step) * step;
    segs = [[start, Math.max(Math.ceil(hi / step) * step, start + step)]];
  } else {
    const pad = cut / 10;
    segs = busy.map(([f, e]) => [
      Math.floor((f - pad) / 5) * 5,
      Math.ceil((e + pad) / 5) * 5,
    ]);
    const kept = segs.reduce((n, [f, e]) => n + e - f, 0);
    step = STEPS.find((s) => kept / s <= 6) ?? 960;
  }
  // Each stretch to scale, but none narrower than STRETCH: a short one between breaks
  // is drawn wider, the rest share what is left.
  const room = track - BREAK * (segs.length - 1);
  const lens = segs.map(([f, e]) => Math.max(e - f, 1e-6));
  let small = lens.map(() => false);
  let scale = room / lens.reduce((n, d) => n + d, 0);
  if (segs.length > 1)
    for (let pass = 0; pass < segs.length; pass++) {
      const big = lens.reduce((n, d, i) => (small[i] ? n : n + d), 0);
      scale = (room - STRETCH * small.filter(Boolean).length) / big;
      const next = lens.map((d) => d * scale < STRETCH);
      if (next.every((v, i) => v === small[i])) break;
      small = next;
    }
  const widths = lens.map((d, i) => (small[i] ? STRETCH : d * scale));
  const starts: number[] = [];
  widths.reduce((x, w) => {
    starts.push(x);
    return x + w + BREAK;
  }, 0);
  const atMin = (m: number) => {
    const found = segs.findIndex(([, e]) => m <= e);
    const k = found < 0 ? segs.length - 1 : found;
    const [f, e] = segs[k] as Box;
    const clamped = Math.min(Math.max(m, f), e);
    return (
      (starts[k] ?? 0) + ((clamped - f) / (lens[k] ?? 1)) * (widths[k] ?? 0)
    );
  };
  const at = (iso: string) => atMin(t(iso));
  const segOf = (iso: string) => segs.findIndex(([, e]) => t(iso) <= e);

  const breaks = segs.slice(1).map((_, i) => ({
    x: atMin((segs[i] as Box)[1]),
    w: BREAK,
    skipped: Math.round((busy[i + 1]?.[0] ?? 0) - (busy[i]?.[1] ?? 0)),
  }));

  // Ticks: each stretch's start, then every step inside it, wherever its words fit.
  const first = segs[0]?.[0] ?? 0;
  const last = segs.at(-1)?.[1] ?? 0;
  const multiDay =
    new Date(first * MIN).toDateString() !==
    new Date(last * MIN).toDateString();
  const ticks: TimelineLayout["ticks"] = [];
  let day = "";
  for (const [f, e] of segs) {
    const marks = [f];
    for (let m = Math.ceil(f / step) * step; m <= e; m += step)
      if (m > f) marks.push(m);
    for (const m of marks) {
      const d = new Date(m * MIN);
      // Past midnight the day is named, on the first tick and where it turns.
      const today = d.toDateString();
      const words = `${multiDay && today !== day ? `${d.getDate()} ${MONTHS[d.getMonth()]} ` : ""}${clock(d.toISOString())}`;
      const x = atMin(m);
      // A stretch after a break starts its words at its edge, clear of the break.
      const from = segs.length > 1 && m === f;
      const w = tickPx(words);
      const l = from ? x : x - w / 2;
      const box: Box = [l, l + w];
      const prev = ticks.at(-1);
      if (prev && meet(box, [prev.l, prev.l + prev.w])) continue;
      if (breaks.some((g) => meet(box, [g.x, g.x + g.w]))) continue;
      ticks.push({ x, l, w, text: words, from });
      if (multiDay) day = today;
    }
  }

  const bars = lanes.map((lane) => {
    const said = lane.count ? undefined : named?.get(lane.a.id);
    const groups: Lane["runs"][] = [];
    const span = (g: Lane["runs"]) =>
      at((g.at(-1) as Run).to) - at((g[0] as Run).from);
    for (const run of lane.runs) {
      const g = groups.at(-1);
      const prev = g?.at(-1);
      // Runs closer than a label is wide are one bar, and so is a bar whose words fit
      // neither inside it nor beside it before the next run. Never across a break: a
      // bar spans only time that is drawn.
      if (g && prev && segOf(run.from) === segOf(prev.to)) {
        const name = nameOf(g);
        const gap = at(run.from) - at(prev.to);
        if (
          gap < labelPx(prev.label) ||
          (labelPx(name) > span(g) && gap < 2 * BESIDE + textPx(name))
        ) {
          g.push(run);
          continue;
        }
      }
      groups.push([run]);
    }
    const boxes = groups.map((g) => {
      const x = at((g[0] as Run).from);
      return [x, x + Math.max(4, span(g))] as Box;
    });
    const placed: Box[] = [];
    const free = (box: Box, i: number) =>
      box[0] >= 0 &&
      box[1] <= track + SPILL &&
      !placed.some((p) => meet(box, p)) &&
      !boxes.some((b, j) => j !== i && meet(box, b));
    return groups.map((g, i): Bar => {
      const [x, r] = boxes[i] as Box;
      const w = r - x;
      // A role lane's merged bar holds many helpers' runs: counted, coloured only when they agree.
      const mixed = !!lane.count && g.length > 1;
      const short = mixed
        ? `${g.length} ${RUNS[lane.kind ?? "other"]}`
        : nameOf(g);
      let text = short;
      const tones = new Set(g.map((run) => run.tone));
      // The plan's words name a lone first run when they fit, before its short name.
      const fit = Math.floor((w - 16) / 7);
      if (
        i === 0 &&
        g.length === 1 &&
        said &&
        fit >= 14 &&
        said.length > text.length
      )
        text = cutWords(said, fit);
      const bar: Bar = {
        x,
        w,
        tone:
          mixed && tones.size > 1
            ? "plain"
            : (g.at(-1) as Lane["runs"][number]).tone,
        text,
        runs: g.length,
        title: `${text}: ${said ?? lane.a.description}, ${g
          .map((run) => `${clock(run.from)} to ${clock(run.to)}`)
          .join(", ")}`,
      };
      // Inside (in full, else shorter), else after it, else before it, else not at all.
      const words =
        g.length > 1 && g.every((run) => run.label === "Fixed")
          ? [text, `${g.length} fixes`]
          : [text];
      const inside = words.find((say) => labelPx(say) <= w);
      if (inside) {
        placed.push([x, r]);
        return {
          ...bar,
          label: { x: x + 8, w: textPx(inside), side: "in", text: inside },
        };
      }
      for (const side of ["right", "left"] as const)
        for (const say of words) {
          const tw = textPx(say);
          const box: Box =
            side === "right"
              ? [r + BESIDE, r + BESIDE + tw]
              : [x - BESIDE - tw, x - BESIDE];
          if (!free(box, i)) continue;
          placed.push(box);
          return { ...bar, label: { x: box[0], w: tw, side, text: say } };
        }
      // The plan's words fit nowhere: the run's own short name inside, as it would be.
      if (text !== short && labelPx(short) <= w) {
        placed.push([x, r]);
        return {
          ...bar,
          text: short,
          label: { x: x + 8, w: textPx(short), side: "in", text: short },
        };
      }
      return bar;
    });
  });

  return { at, ticks, breaks, bars };
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
  const each = helperLanes(part, helpers, events);
  if (!each.length) return null;
  const lanes = each.length > MANY ? byRole(each) : each;
  const said = claudeSaid(request, part, helpers).filter(
    (m) => !Number.isNaN(Date.parse(m.ts)),
  );
  const end = said.length ? undefined : closing(request, part);
  const layout = layoutTimeline(
    lanes,
    track,
    said.length ? said.map((m) => m.ts) : end?.ts ? [end.ts] : [],
    named,
  );
  const x = (px: number) => pct(px / track);
  const marks = roundMarks(each).map((m) => ({ ...m, x: layout.at(m.from) }));
  const lines = [
    ...layout.ticks.map((tk) => (
      <i key={tk.x} className="gl" style={{ left: x(tk.x) }} />
    )),
    ...marks
      .slice(1)
      .map((m) => (
        <i key={`r${m.n}`} className="rl" style={{ left: x(m.x) }} />
      )),
  ];
  const gaps = layout.breaks.map((g) => (
    <i key={g.x} className="gap" style={{ left: x(g.x), width: x(g.w) }} />
  ));
  const endAt = end?.ts
    ? layout.at(end.ts)
    : Math.max(...layout.bars.flat().map((b) => b.x + b.w));
  // Claude's dots: a message's moment colours it; dots too close to tell apart are one.
  const dots: {
    x: number;
    tone: "plain" | "bad" | "good";
    label: string;
    id: string;
  }[] = [];
  for (const m of said) {
    const mark = moment(m.text);
    // Green only for the word that closed it: a "done" before more work was not the end.
    const tone =
      mark === "problem"
        ? "bad"
        : mark === "done" && m === said.at(-1)
          ? "good"
          : "plain";
    const dot = {
      x: layout.at(m.ts),
      tone,
      label: `${clock(m.ts)}: ${cutWords(firstSentence(plainText(m.text)), 140)}`,
      id: m.id,
    } as const;
    const prev = dots.at(-1);
    if (prev && dot.x - prev.x < DOT) {
      if (tone !== "plain" || prev.tone === "plain")
        dots[dots.length - 1] = dot;
    } else dots.push(dot);
  }
  const axis = (
    <div className="axis" aria-hidden="true">
      <div />
      <div className="ticks">
        {layout.ticks.map((tk) => (
          <span
            key={tk.x}
            className={`num${tk.from ? " from" : ""}`}
            style={{ left: x(tk.x) }}
          >
            {tk.text}
          </span>
        ))}
        {layout.breaks.map((g) => (
          <span
            key={g.x}
            className="break"
            style={{ left: x(g.x), width: x(g.w) }}
            title={`${duration(new Date(0).toISOString(), new Date(g.skipped * MIN).toISOString())} with no work`}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="rec">
      {marks.length > 0 && (
        <div className="rounds" aria-hidden="true">
          <div />
          <div className="rd-track">
            {marks.map((m, i) => {
              const full = `Round ${m.n} · ${listed(m.words)}`;
              const room = (marks[i + 1]?.x ?? track + SPILL) - m.x;
              // Too little room after its line: the words sit before it, clear of the last.
              const last = marks[i - 1];
              const before = m.x - (last ? last.x + markPx("Round 9") : 0);
              const flip = markPx(full) > room && markPx(full) <= before;
              const text =
                markPx(full) <= room || flip
                  ? full
                  : markPx(`Round ${m.n}`) <= room
                    ? `Round ${m.n}`
                    : "";
              return (
                <span
                  key={m.n}
                  className={`rd${i === marks.length - 1 ? " last" : ""}${flip ? " flip" : ""}`}
                  style={{ left: x(m.x) }}
                  title={full}
                >
                  {text}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <ul className="lanes" aria-label="Timeline" ref={lanesRef}>
        {lanes.map((lane, n) => {
          const k = request.agents.indexOf(lane.a) + 1;
          const model = modelOf(lane.a, events);
          const name = lane.count
            ? lane.kind
              ? `${ROLE[lane.kind]}s`
              : "Other helpers"
            : lane.kind
              ? ROLE[lane.kind]
              : `Agent ${k}`;
          const sub = lane.count
            ? `${lane.count} ${lane.count === 1 ? "helper" : "helpers"}`
            : [lane.kind ? `Agent ${k}` : "", model]
                .filter(Boolean)
                .join(" · ");
          return (
            <li key={lane.a.id} className="lane">
              <span className="lane-name">
                <b>{name}</b>
                {sub && <span>{sub}</span>}
              </span>
              <span className="tr">
                {lines}
                {gaps}
                {layout.bars[n]?.map((bar) => {
                  const side = bar.label?.side;
                  const cls = !side
                    ? " bare"
                    : side === "in"
                      ? ""
                      : side === "left"
                        ? " out flip"
                        : " out";
                  return (
                    <span
                      key={bar.x}
                      className={`run ${bar.tone}${cls}`}
                      style={{ left: x(bar.x), width: x(bar.w) }}
                      title={bar.title}
                    >
                      {bar.label && (
                        <span className="run-label">{bar.label.text}</span>
                      )}
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
        {(said.length > 0 || end) && (
          <li className="lane">
            <span className="lane-name">
              <b>Claude</b>
              {said.length > 0 && (
                <span>
                  {said.length} {said.length === 1 ? "message" : "messages"}
                </span>
              )}
            </span>
            <span className="tr">
              {lines}
              {gaps}
              {dots.map((d) => (
                <span
                  key={d.id}
                  role="img"
                  className={`cdot ${d.tone}`}
                  style={{ left: x(d.x) }}
                  aria-label={d.label}
                  title={d.label}
                />
              ))}
              {end && (
                <span
                  className="close"
                  style={{ right: x(track - endAt) }}
                  title={end.text}
                >
                  {cutWords(end.text, 64)}
                  {part.status === "done" && <Glyph status="done" />}
                </span>
              )}
            </span>
          </li>
        )}
      </ul>
      {axis}
    </div>
  );
}
