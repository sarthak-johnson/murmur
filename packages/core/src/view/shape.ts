/*
 * The request read as a whole, after every other pass: its short title, work beyond the
 * plan, which phase each message belongs to, its state, outcome and open questions, and
 * a full card (aim, steps, span, file roles) for every part. See the fields' docs in
 * types.ts. A recap's map and narrates sit a millisecond apart just after the prompt, so
 * their times say nothing: windows, beyond and spans read only real events.
 */
import type { MurmurEvent } from "../events.js";
import { QUIET, TOOL_HOOKS } from "./infer.js";
import {
  cutWords,
  firstSentence,
  moment,
  plainText,
  sentences,
} from "./moments.js";
import type { Narrated, Trace } from "./requests.js";
import { helpersOf, itemOf, subjectOfWork } from "./rounds.js";
import {
  fallbackGoal,
  type TitleEntry,
  talkOnly,
  titleClause,
} from "./titles.js";
import type {
  AgentView,
  Beyond,
  MessageView,
  PartView,
  RequestState,
  RequestView,
  StepView,
} from "./types.js";

export interface ShapeContext {
  /** A later request exists. */
  later: boolean;
  /** The session's `needsYou` came during this request. */
  waiting: boolean;
  /** The helper still runs: not stopped, and not quiet for over 10 minutes. */
  live: (a: AgentView) => boolean;
  /** What a titles run said of this request, if one covered it. */
  title?: TitleEntry | undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const real = (e: MurmurEvent) => e.payload.recap !== true;
const byTs = (a: { ts: string }, b: { ts: string }) =>
  a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;

export function applyShape(
  req: RequestView,
  events: MurmurEvent[],
  trace: Trace,
  ctx: ShapeContext,
): void {
  const live = trace.narrated.filter((x) => real(x.e));
  const outcome = outcomeOf(req.messages ?? []);
  if (outcome) req.outcome = outcome;
  // The map's title first (`applyPlan` set it), then the titles run's, then Murmur's own.
  if (req.short) req.titledBy = "claude";
  const t = ctx.title;
  if (t) {
    if (req.planInferred) req.goal = t.goal;
    if (!req.short) req.short = t.short;
    req.titledBy = "claude";
    if (req.kindInferred) {
      req.kind = t.kind;
      req.kindInferred = false;
    }
  } else if (req.planInferred) req.goal = fallbackGoal(req.prompt, outcome);
  if (!req.short) {
    const short = shortOf(req.goal);
    if (short) req.short = short;
  }
  const beyond = beyondOf(req, events, trace);
  if (beyond) req.beyond = beyond;
  placeMessages(req, live, events, beyond);
  req.state = stateOf(req, events, live, ctx);
  if (req.state === "waiting") {
    const asked = waitingOf(req, events);
    if (asked.length) req.waiting = asked;
  }
  const at = new Map(events.map((e) => [e.id, e]));
  // Each helper's SubagentStart, by agent id: a filled step points at it.
  const starts = new Map(
    events
      .filter((e) => e.hook === "SubagentStart")
      .map((e) => [str(e.payload.agent_id), e.id]),
  );
  for (const part of req.parts) fillPart(req, part, at, starts, live, ctx);
  for (const f of req.parts.flatMap((p) => p.files))
    if (!f.role) {
      f.role = groupOf(f.path);
      f.roleInferred = true;
    }
}

// Where a phrase can end and the next begin: before a small word that starts one, or
// before "is" ("Find out why the disk | is 92% full").
const BREAK = new Set(
  "a an the to of and or for with in on at by from into as than but without about after before over under through between across via per is are was were".split(
    " ",
  ),
);
// Words a cut title never ends on: those, and ones that leave it hanging ("was", "any").
const HANG = new Set([
  ...BREAK,
  ..."be been being has have had will would can could should do does did not no any there my our your its their this that these those every all some each then whether if which because while so more most also just you we they it he she i me us them how what why when where who".split(
    " ",
  ),
]);
// A cut just before one of these ends at a whole phrase ("Page with 12 screens of build
// 9 | as it looks now"): nothing to back off from.
const ENDS = new Set(
  [...BREAK].filter((w) => !/^(?:a|an|the|is|are|was|were)$/.test(w)),
);
// A reply with nothing to say of the work ("Yes", "Waiting"): it picks up the one before.
const FOLLOW_UP = "Follow-up";
// Words that open a clause ("whether build 9 was ..."): a cut inside one backs off to
// before it, when that keeps three words.
const OPENS = new Set("whether if that which because while".split(" "));
const FILLER =
  /^(?:start|begin|continue|resume|keep|finish|carry on|proceed with|go on with)\s+/i;
const SHORT_MAX = 32;

/** A goal in a few words: see `RequestView.short`. */
export function shortOf(goal: string): string {
  // An aside in brackets is the first thing a few words can do without.
  const plain = goal.replace(/\s*\([^)]*\)/g, "");
  // The first clause that reads as a title (`titleClause`), else the first, as typed.
  const clauses = plain
    .split(/,|:|;|\s[-–]\s|\sand then\s|[.?!]\s/i)
    .map((c) => c.trim())
    .filter(Boolean);
  let s =
    clauses.map((c) => titleClause(c)).find((c) => c !== undefined) ??
    (talkOnly(plain) ? FOLLOW_UP : (clauses[0] ?? ""));
  const is = (set: Set<string>, w: string | undefined) =>
    set.has((w ?? "").toLowerCase());
  const filler = FILLER.exec(s);
  const rest = filler ? s.slice(filler[0].length).split(/\s+/) : [];
  if (rest.length >= 2 && !is(HANG, rest[0])) s = rest.join(" ");
  let out = "";
  for (const w of s.split(/\s+/)) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > SHORT_MAX) break;
    out = next;
  }
  let words = (out || s.slice(0, SHORT_MAX)).split(" ");
  const trim = (ws: string[]) => {
    const t = [...ws];
    while (t.length > 1 && is(HANG, t.at(-1))) t.pop();
    return t;
  };
  let hanging = false;
  // A cut just before a small word that starts a phrase keeps what it has. Else it backs
  // off to a whole phrase: to before a clause it cut into ("Check the login flow | if
  // anything changed"), else before its last small word ("Track every phase | of the
  // Lit") when two words or more are left. Else it ends with "…" rather than on a word
  // that leaves it hanging ("Confirm whether build 9 | was").
  const all = s.split(/\s+/);
  if (out && words.length < all.length && is(ENDS, all[words.length]))
    words = trim(words);
  else if (out && words.length < all.length) {
    const opens = words.findIndex((w, k) => k > 0 && is(OPENS, w));
    const breaks = words.findLastIndex((w, k) => k > 0 && is(BREAK, w));
    const head = trim(words.slice(0, opens > 0 ? opens : Math.max(breaks, 0)));
    if (head.length >= (opens > 0 ? 3 : 2)) words = head;
    else hanging = opens > 0 || is(HANG, words.at(-1));
    words = trim(words);
  }
  const t = words.join(" ").replace(/[.;]+$/, "");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${hanging ? "…" : ""}`;
}

/** When the whole plan last became done, from real status changes; unset when it is not. */
function doneAt(
  req: RequestView,
  events: MurmurEvent[],
  trace: Trace,
): string | undefined {
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  if (!tasks.length || req.recap || tasks.some((t) => t.status !== "done"))
    return undefined;
  if (req.planInferred)
    return req.phases[0]?.id === "tasks"
      ? events.findLast((e) => e.hook === "TaskCompleted")?.ts
      : undefined;
  const status = new Map<string, string>(tasks.map((t) => [t.id, "todo"]));
  let at: string | undefined;
  for (const x of trace.narrated) {
    if (!x.task || !status.has(x.task) || !x.n.taskStatus) continue;
    status.set(x.task, x.n.taskStatus);
    const all = [...status.values()].every((s) => s === "done");
    if (!all) at = undefined;
    else at ??= x.e.ts;
  }
  return at;
}

function beyondOf(
  req: RequestView,
  events: MurmurEvent[],
  trace: Trace,
): Beyond | undefined {
  const since = doneAt(req, events, trace);
  if (!since) return undefined;
  const after = events.filter((e) => e.ts > since);
  const work = after.some(
    (e) =>
      e.hook === "SubagentStart" ||
      (TOOL_HOOKS.has(e.hook) && !QUIET.has(str(e.payload.tool_name))),
  );
  if (!work) return undefined;
  const busy = new Set(after.map((e) => str(e.payload.agent_id)));
  const agents = req.agents.filter(
    (a) =>
      a.startedAt > since ||
      (busy.has(a.id) && (!a.endedAt || a.endedAt > since)),
  );
  const rounds = new Set(
    agents.flatMap((a) =>
      a.subject && (a.round ?? 0) > 1 ? [`${a.subject}\0${a.round}`] : [],
    ),
  );
  return {
    since,
    agents: agents.map((a) => a.id),
    messages: (req.messages ?? []).filter((m) => m.ts > since).map((m) => m.id),
    rounds: rounds.size,
  };
}

/** Each message's phase: its task's, else the window holding it (see `MessageView.phase`). */
function placeMessages(
  req: RequestView,
  live: Narrated[],
  events: MurmurEvent[],
  beyond: Beyond | undefined,
): void {
  const msgs = req.messages ?? [];
  const tsOf = new Map(events.map((e) => [e.id, e.ts]));
  // Messages are no signal: Claude names a task when it plans it, long before the work.
  const windows: { id: string; start: string; end: string }[] = [];
  for (const ph of req.phases) {
    const times = ph.tasks
      .flatMap((t) => {
        const part = req.parts.find((p) => p.id === t.part);
        return [
          ...live
            .filter(
              (x) =>
                x.task === t.id ||
                (!x.task && x.part !== undefined && x.part === t.part),
            )
            .map((x) => x.e.ts),
          ...helpersOf(req, t).flatMap((a) =>
            [a.startedAt, a.endedAt ?? [], a.report?.ts ?? []].flat(),
          ),
          ...(part?.files ?? []).flatMap((f) =>
            f.eventIds.flatMap((id) => tsOf.get(id) ?? []),
          ),
        ];
      })
      .sort();
    const [start, end] = [times[0], times.at(-1)];
    if (start && end) windows.push({ id: ph.id, start, end });
  }
  const begun = [...windows].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
  );
  const span = (w: { start: string; end: string }) =>
    Date.parse(w.end) - Date.parse(w.start);
  const phaseOf = new Map(
    req.phases.flatMap((ph) => ph.tasks.map((t) => [t.id, ph.id] as const)),
  );
  for (const m of msgs) {
    delete m.phase;
    if (beyond && m.ts > beyond.since) continue;
    // Phases can run side by side, so the narrowest window holding it is the closest.
    const holding = windows
      .filter((w) => w.start <= m.ts && m.ts <= w.end)
      .sort((a, b) => span(a) - span(b))[0];
    const phase =
      (m.task && phaseOf.get(m.task)) ||
      holding?.id ||
      begun.findLast((w) => w.start <= m.ts)?.id ||
      req.phases[0]?.id;
    if (phase) m.phase = phase;
  }
}

const isFailed = (s: string | undefined) => s === "failed" || s === "blocked";

function stateOf(
  req: RequestView,
  events: MurmurEvent[],
  live: Narrated[],
  ctx: ShapeContext,
): RequestState {
  if (ctx.waiting) return "waiting";
  // The main thread's last word; a helper's events and notices say nothing of it.
  // A recap or refresh is Murmur's, queued after the Stop at its own time.
  const last = events.findLast(
    (e) => !e.payload.agent_id && e.hook !== "Notification" && real(e),
  );
  const ended = ["Stop", "StopFailure", "SessionEnd"].includes(
    last?.hook ?? "",
  );
  if ((!ctx.later && !ended) || req.agents.some(ctx.live)) return "running";
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  if (ctx.later && tasks.some((t) => t.status !== "done")) return "left-open";
  if (last?.hook === "StopFailure") return "failed";
  // The last helper (or narrated step) failed and nothing passed after.
  const call = events.findLast(
    (e) => e.hook === "PreToolUse" && e.payload.tool_name === "Agent",
  );
  const use = str(call?.payload.tool_use_id);
  const callFailed = events.find(
    (e) =>
      use && e.hook === "PostToolUseFailure" && e.payload.tool_use_id === use,
  );
  const report = req.agents.at(-1)?.report;
  const step = live.findLast((x) => x.n.step || x.n.taskStatus);
  const failedAt = [
    callFailed?.ts,
    report && /failed|killed/.test(report.status) ? report.ts : undefined,
    step && (step.n.step?.status === "failed" || isFailed(step.n.taskStatus))
      ? step.e.ts
      : undefined,
  ]
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
  if (!failedAt) return "done";
  const passed =
    live.some(
      (x) =>
        x.e.ts > failedAt &&
        (x.n.step?.status === "done" || x.n.taskStatus === "done"),
    ) ||
    req.agents.some(
      (a) =>
        a.report && a.report.ts > failedAt && a.report.status === "completed",
    );
  return passed ? "done" : "failed";
}

const OUTCOME_MAX = 240;

function outcomeOf(msgs: MessageView[]): string | undefined {
  // Claude Code's own error lines are not Claude's words.
  const said = msgs.filter((m) => !/^\s*API Error\b/.test(m.text));
  const pick = said.findLast((m) => moment(m.text) === "done") ?? said.at(-1);
  const first = pick ? firstSentence(pick.text) : "";
  return first ? cutWords(first, OUTCOME_MAX) : undefined;
}

function waitingOf(req: RequestView, events: MurmurEvent[]): string[] {
  const answered = new Set(
    events
      .filter(
        (e) => e.hook === "PostToolUse" || e.hook === "PostToolUseFailure",
      )
      .map((e) => str(e.payload.tool_use_id)),
  );
  const ask = events.findLast(
    (e) =>
      e.hook === "PreToolUse" &&
      e.payload.tool_name === "AskUserQuestion" &&
      !answered.has(str(e.payload.tool_use_id)),
  );
  const questions = obj(ask?.payload.tool_input).questions;
  if (Array.isArray(questions))
    return questions.map((q) => str(obj(q).question)).filter(Boolean);
  const text = req.messages?.at(-1)?.text ?? "";
  return sentences(plainText(text)).filter((s) => s.endsWith("?"));
}

// A brief that tells the helper who it is; the work follows a colon, if anywhere.
const ABOUT_ACTING =
  /^(?:you are|you're|your (?:job|task|role)|you will|act as)\b/i;

/**
 * A part's aim from a helper's brief: its first sentence, or for one that starts by
 * casting the helper ("You are building Task 19 of ...: the agent page's styles.") what
 * follows the colon; unset when that says nothing of the work.
 */
export function aimOf(brief: string): string | undefined {
  const first = firstSentence(brief);
  if (!ABOUT_ACTING.test(first))
    return first ? cutWords(first, AIM_MAX) : undefined;
  const colon = first.indexOf(": ");
  const rest = colon < 0 ? "" : first.slice(colon + 2).trim();
  return rest
    ? cutWords(rest.charAt(0).toUpperCase() + rest.slice(1), AIM_MAX)
    : undefined;
}
// A review report that asks for changes.
const SENT_BACK =
  /\b(?:needs?[ _-]?fix(?:es)?|changes[ _-]requested|not approved|rejected|blocking issues?)\b/i;
const NUMBER = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const AIM_MAX = 300;

/** Fills a part's missing aim, steps and span from the record. */
function fillPart(
  req: RequestView,
  part: PartView,
  at: Map<string, MurmurEvent>,
  starts: Map<string, string>,
  live: Narrated[],
  ctx: ShapeContext,
): void {
  // Steps and span tell every helper on it; the aim reads only helpers of one subject.
  const helpers = helpersOf(req, undefined, part, true);
  const own = new Set(
    req.phases
      .flatMap((ph) => ph.tasks)
      .filter((t) => t.part === part.id)
      .map((t) => t.id),
  );
  // Messages about it: naming one of its tasks, or its subject first ("Task 39 is done").
  const subject = subjectOfWork(req, undefined, part);
  const about = (req.messages ?? []).filter(
    (m) =>
      (m.task && own.has(m.task)) ||
      (subject !== undefined && itemOf(firstSentence(m.text)) === subject),
  );
  const notes = live.filter((x) => x.part === part.id);
  const runs = helpers.map((a, i) =>
    helperStep(a, helpers.slice(i + 1), starts, ctx),
  );
  let filled = false;

  if (!part.aim) {
    const coherent = helpersOf(req, undefined, part);
    const aimBy = (roles: string[]) =>
      coherent.flatMap((a) =>
        roles.includes(a.role ?? "") && a.brief ? (aimOf(a.brief) ?? []) : [],
      )[0];
    const aim =
      aimBy(["build", "fix", "plan", "research"]) ??
      aimBy(["review", "recheck"]);
    if (aim) {
      part.aim = {
        inferred: true,
        aim,
        doneWhen: doneWhenOf(part, coherent, starts, ctx, about),
      };
      filled = true;
    }
  }

  if (!part.steps.length) {
    const steps: StepView[] = [
      ...runs,
      ...notes.map((x) => ({
        ts: x.e.ts,
        text: x.n.now,
        status: isFailed(x.n.taskStatus)
          ? ("failed" as const)
          : ("done" as const),
        ...(str(x.e.payload.agent_id)
          ? { agentId: str(x.e.payload.agent_id) }
          : {}),
        eventIds: [x.e.id],
      })),
      ...about.map((m) => ({
        ts: m.ts,
        text: cutWords(firstSentence(m.text), AIM_MAX),
        status: "done" as const,
        eventIds: [m.id],
      })),
    ].sort(byTs);
    // Claude's latest word on a part still under way is what it is doing.
    const lastStep = steps.at(-1);
    if (
      lastStep &&
      part.status === "now" &&
      notes.some((x) => x.e.id === lastStep.eventIds[0])
    )
      lastStep.status = "running";
    if (steps.length) {
      part.steps = steps;
      filled = true;
    }
  }
  if (filled) part.inferred = true;

  const times = [
    ...helpers.flatMap((a) =>
      [a.startedAt, a.endedAt ?? [], a.report?.ts ?? []].flat(),
    ),
    ...part.steps.flatMap((s) => {
      const e = at.get(s.eventIds[0] ?? "");
      return !e || real(e) ? [s.ts] : [];
    }),
    ...part.files.flatMap((f) =>
      f.eventIds.flatMap((id) => at.get(id)?.ts ?? []),
    ),
    ...about.map((m) => m.ts),
    ...notes.map((x) => x.e.ts),
  ].sort();
  const start = times[0];
  if (start) {
    const underWay =
      helpers.some(ctx.live) ||
      (part.status === "now" &&
        (req.state === "running" || req.state === "waiting"));
    part.span = underWay ? { start } : { start, end: times.at(-1) as string };
  }
}

/** One step for a helper: "Built", "Sent back", "Fixed", "Passed" and their kin. */
function helperStep(
  a: AgentView,
  after: AgentView[],
  starts: Map<string, string>,
  ctx: ShapeContext,
): StepView {
  const running = ctx.live(a);
  const r = a.report;
  const failed = !!r && /failed|killed/.test(r.status);
  const backed =
    after.some(
      (b) =>
        b.subject === a.subject &&
        (b.round ?? 0) > (a.round ?? 0) &&
        (b.role === "fix" || b.role === "recheck"),
    ) || SENT_BACK.test(`${r?.verdict ?? ""} ${r?.text.slice(0, 300) ?? ""}`);
  const review = a.role === "review" || a.role === "recheck";
  const text = review
    ? running
      ? a.role === "review"
        ? "Reviewing"
        : "Re-reviewing"
      : backed
        ? "Sent back"
        : r && !failed
          ? "Passed"
          : a.role === "review"
            ? "Reviewed"
            : "Re-reviewed"
    : a.role === "build"
      ? running
        ? "Building"
        : "Built"
      : a.role === "fix"
        ? running
          ? "Fixing"
          : "Fixed"
        : a.role === "plan"
          ? "Planned"
          : a.role === "research"
            ? "Researched"
            : a.description || "A helper";
  const startEvent = starts.get(a.id);
  return {
    ts: a.startedAt,
    text,
    status: failed ? "failed" : running ? "running" : "done",
    agentId: a.id,
    eventIds: startEvent ? [startEvent] : [],
  };
}

/** How a part ended, for an inferred aim's done-when. */
function doneWhenOf(
  part: PartView,
  helpers: AgentView[],
  starts: Map<string, string>,
  ctx: ShapeContext,
  about: MessageView[],
): string {
  const said = about.findLast((m) => moment(m.text) === "done");
  if (said) return cutWords(firstSentence(said.text), AIM_MAX);
  const i = helpers.reduce(
    (best, a, k) =>
      a.report && (best < 0 || a.report.ts >= (helpers[best]?.report?.ts ?? ""))
        ? k
        : best,
    -1,
  );
  const a = helpers[i];
  if (!a?.report) return "";
  if (helperStep(a, helpers.slice(i + 1), starts, ctx).text === "Passed") {
    const n = part.rounds ?? 0;
    return n
      ? `Passed review after ${NUMBER[n] ?? n} fix round${n === 1 ? "" : "s"}`
      : "Passed review";
  }
  const v = a.report.verdict;
  if (v) {
    const words = v.replace(/_with_/i, ", with ").replace(/[_-]+/g, " ");
    return `Reported ${words.toLowerCase()}`;
  }
  return a.report.status === "failed"
    ? "Failed"
    : a.report.status === "killed"
      ? "Stopped"
      : "";
}

/** A file's group by its path, for a part whose files no narrate described. */
export function groupOf(path: string): string {
  const p = path.toLowerCase();
  if (
    /(?:^|\/)(?:__tests__|__mocks__|tests?|spec|e2e)\/|\.(?:test|spec)\.[a-z0-9]+$/.test(
      p,
    )
  )
    return "tests";
  if (/\.(?:css|scss|sass|less|styl|pcss)$/.test(p)) return "styles";
  if (
    /\.(?:md|mdx|markdown|txt|rst|adoc)$/.test(p) ||
    /(?:^|\/)docs?\//.test(p)
  )
    return "docs";
  if (
    /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|[^/]*\.config\.[a-z]+|\.[^/]*rc(?:\.[a-z]+)?|[^/]*\.(?:ya?ml|toml|ini|lock)|\.env[^/]*|dockerfile|makefile)$/.test(
      p,
    )
  )
    return "config";
  return "source";
}
