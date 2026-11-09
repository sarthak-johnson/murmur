/*
 * Plain readings of a session for the frame: where a request stands (running, waiting on
 * you, done), what Claude asked, the now line, the plan's names and times, and a helper's
 * runs. All read from the view and its events; nothing here is stored.
 */
import type {
  AgentView,
  MurmurEvent,
  PhaseView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import { plainText } from "./markdown";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** The events between a request's prompt and the next one's. */
export function requestEvents(
  view: SessionView,
  req: RequestView,
  events: MurmurEvent[],
): MurmurEvent[] {
  const next = view.requests[view.requests.indexOf(req) + 1];
  return events.filter(
    (e) => e.ts >= req.startedAt && (!next || e.ts < next.startedAt),
  );
}

export interface Question {
  question: string;
  detail?: string;
}

export interface Waiting {
  since: string;
  questions: Question[];
  /** What Claude needs when it asked no question, e.g. a permission. */
  text: string;
  /** Claude Code is holding a tool call until you allow it. */
  permission?: boolean;
}

/** An AskUserQuestion call on the main thread with no result yet. */
function pendingAsk(evs: MurmurEvent[]): MurmurEvent | undefined {
  const answered = new Set(
    evs
      .filter(
        (e) => e.hook === "PostToolUse" || e.hook === "PostToolUseFailure",
      )
      .map((e) => str(e.payload.tool_use_id))
      .filter(Boolean),
  );
  const ask = evs.findLast(
    (e) =>
      e.hook === "PreToolUse" &&
      e.payload.tool_name === "AskUserQuestion" &&
      !e.payload.agent_id,
  );
  if (!ask) return undefined;
  const id = str(ask.payload.tool_use_id);
  if (id ? answered.has(id) : evs.some((e) => e.ts > ask.ts)) return undefined;
  return ask;
}

function askQuestions(ask: MurmurEvent): Question[] {
  const qs = obj(ask.payload.tool_input).questions;
  return (Array.isArray(qs) ? qs : []).flatMap((q) => {
    const question = str(obj(q).question).trim();
    if (!question) return [];
    const opts = obj(q).options;
    const labels = (Array.isArray(opts) ? opts : [])
      .map((o) => str(obj(o).label).trim())
      .filter(Boolean);
    return [
      { question, ...(labels.length ? { detail: labels.join(" or ") } : {}) },
    ];
  });
}

/** Asked of the user: "Should I…", "Do you…", "May we…", or anything with "you". */
const ASKS =
  /^(?:(?:and|but|so|also|then|or)\s+)?(?:(?:should|shall|may|can|could|would|will|do|does|did|is|are|want)\s+(?:i|we|me|you)\b|want me\b)|\byou(?:rs?)?\b/i;

/**
 * The questions Claude's message leaves for you, in order. Only questions that end its
 * last paragraph or a trailing list count, and only ones put to you: code, links and
 * a question Claude answers itself never do. When unsure, none: a false "needs you"
 * is worse than a missed one.
 */
export function questionsIn(text: string): string[] {
  const src = text
    .replace(/```[\s\S]*?(?:```|$)/g, "\n\n")
    .replace(/`[^`\n]*`/g, "code")
    .replace(/\]\([^)\s]*\)/g, "]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, "link");
  const block =
    src
      .split(/\n\s*\n/)
      .filter((b) => b.trim())
      .at(-1) ?? "";
  // A heading or a list item is a unit of its own; other lines run together.
  type Unit = { text: string; kind: "heading" | "item" | "para" };
  const units: Unit[] = [];
  for (const line of block.split("\n")) {
    const l = line.trim();
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)?.[1];
    const last = units.at(-1);
    if (/^#{1,6}\s/.test(l)) units.push({ text: l, kind: "heading" });
    else if (item !== undefined) units.push({ text: item, kind: "item" });
    else if (last?.kind === "para") last.text += ` ${l}`;
    else units.push({ text: l, kind: "para" });
  }
  const tail =
    units.at(-1)?.kind === "item"
      ? units.slice(units.findLastIndex((u) => u.kind !== "item") + 1)
      : units.slice(-1);
  return tail.flatMap((u) => {
    if (u.kind === "heading") return [];
    // A sentence ends at . ! ? before a space, so "v1.2" stays whole.
    const said = plainText(u.text).replace(/\s+/g, " ").trim();
    const sentences = said.split(/(?<=[.!?])\s+/);
    const asked: string[] = [];
    for (const q of sentences.reverse()) {
      if (!q.endsWith("?")) break;
      asked.unshift(q);
    }
    // "Should I…? Or…?" is one choice.
    const merged: string[] = [];
    for (const q of asked)
      if (/^or\b/i.test(q) && merged.length)
        merged[merged.length - 1] += ` ${q}`;
      else merged.push(q);
    return merged.filter((q) => ASKS.test(q) && q.length > 3);
  });
}

/** The request's last event, and whether Claude ended its turn with no helper at work. */
export function lastActivity(
  view: SessionView,
  req: RequestView,
  events: MurmurEvent[],
) {
  const evs = requestEvents(view, req, events);
  const last = evs.findLast((e) => !e.payload.agent_id) ?? evs.at(-1);
  const stopped =
    last?.hook === "Stop" && !req.agents.some((a) => a.status === "running");
  return { evs, last, stopped };
}

/**
 * What Claude waits on you for, or null: a question it asked (an AskUserQuestion call
 * still open), a needs-you from Claude Code, or the questions of its last message once
 * it stopped. Only the newest request of a session still going can wait.
 */
export function waitingOn(
  view: SessionView,
  req: RequestView,
  events: MurmurEvent[],
): Waiting | null {
  if (req !== view.requests.at(-1) || view.ended || req.finished) return null;
  const { evs, last, stopped } = lastActivity(view, req, events);
  const ask = pendingAsk(evs);
  if (ask) return { since: ask.ts, questions: askQuestions(ask), text: "" };
  const lastMsg = req.messages?.at(-1);
  const asked = lastMsg ? questionsIn(lastMsg.text) : [];
  const fromMessage = asked.map((question) => ({ question }));
  const n = view.needsYou;
  if (n)
    return {
      since: n.since,
      questions: n.reason === "permission" ? [] : fromMessage,
      text: n.text,
      ...(n.reason === "permission" ? { permission: true } : {}),
    };
  if (stopped && last && asked.length)
    return { since: last.ts, questions: fromMessage, text: "" };
  return null;
}

export type RequestState = "running" | "waiting" | "done";

/** Where the request stands, and when it was last active. */
export function requestState(
  view: SessionView,
  req: RequestView,
  events: MurmurEvent[],
  waiting: Waiting | null,
): { state: RequestState; end: string } {
  const { last, stopped } = lastActivity(view, req, events);
  const next = view.requests[view.requests.indexOf(req) + 1];
  const end = last?.ts ?? next?.startedAt ?? view.lastEventAt;
  const helping = req.agents.some((a) => a.status === "running");
  if (waiting && !helping) return { state: "waiting", end };
  if (waiting) return { state: "running", end };
  const done = req.finished || view.ended || stopped;
  return { state: done ? "done" : "running", end };
}

/** "2 waiting on you", "Permission needed", "Waiting on you". */
export function waitingLabel(w: Waiting): string {
  const n = w.questions.length;
  if (n) return `${n} waiting on you`;
  return w.permission ? "Permission needed" : "Waiting on you";
}

/** How a request stands, as the rail marks it: each with its own shape and colour. */
export type Mark = "done" | "running" | "waiting" | "open" | "failed";
const MARKS: readonly string[] = [
  "done",
  "running",
  "waiting",
  "open",
  "failed",
];

/**
 * A request's mark and when it was last active. Core's `request.state` (coming with the
 * reshape's logic phase) replaces this reading when present. Until then: the newest
 * request runs, waits on you or is done; a finished one failed when a task of its plan
 * failed, was left open when its plan has tasks not done, else is done.
 */
export function requestMark(
  view: SessionView,
  req: RequestView,
  events: MurmurEvent[],
): { mark: Mark; state: RequestState; end: string; waiting: Waiting | null } {
  const waiting = waitingOn(view, req, events);
  const { state, end } = requestState(view, req, events, waiting);
  const at = { state, end, waiting };
  const own = (req as { state?: unknown }).state;
  if (typeof own === "string" && MARKS.includes(own))
    return { mark: own as Mark, ...at };
  if (state !== "done") return { mark: state, ...at };
  const tasks = req.phases.flatMap((p) => p.tasks);
  if (tasks.some((t) => t.status === "failed"))
    return { mark: "failed", ...at };
  if (req.finished && tasks.some((t) => t.status !== "done"))
    return { mark: "open", ...at };
  return { mark: "done", ...at };
}

const SHORT = 32;
/** A clause ends at a comma, colon or semicolon, or a spaced hyphen, en or em dash. */
const CLAUSE = new RegExp(
  `[,:;](?:\\s|$)| [-${String.fromCharCode(0x2013, 0x2014)}] `,
);

/**
 * A 2 to 4 word name: the text cut at its first comma, colon or " - ", then at a word
 * boundary near 32 characters. "Restyle the app, then speed it up" reads "Restyle the app".
 */
export function shortOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const head = line.split(CLAUSE)[0]?.trim() || line;
  const tidy = (s: string) => s.replace(/[\s.,;:!?-]+$/, "");
  if (head.length <= SHORT) return tidy(head);
  const cut = head.slice(0, SHORT + 1);
  const at = cut.lastIndexOf(" ");
  return `${tidy(at > SHORT / 2 ? cut.slice(0, at) : head.slice(0, SHORT))}…`;
}

/**
 * A request's short title for the rail and the breadcrumb. Core's `request.short`
 * (coming with the reshape's logic phase) replaces the cut of its goal when present.
 */
export function requestShort(req: RequestView): string {
  const own = (req as { short?: unknown }).short;
  if (typeof own === "string" && own.trim()) return own.trim();
  return shortOf(req.goal || req.prompt) || "Untitled request";
}

const count = (n: number, one: string, many: string) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

/** What a request did, in one line. */
export function doneLine({ helpers, files, commands }: RequestView["tally"]) {
  const bits = [
    ...count(helpers, "helper", "helpers"),
    ...count(files, "file changed", "files changed"),
    ...count(commands, "command run", "commands run"),
  ];
  return bits.length ? bits.join(", ") : "Nothing changed";
}

/** The tool call an inferred now was read from. */
export function nowSource(req: RequestView, events: MurmurEvent[]) {
  const now = req.now;
  return now?.inferred
    ? events.findLast((e) => e.ts === now.ts && !!e.payload.tool_name)
    : undefined;
}

/** "Using mcp__plugin_x__browser_batch" reads as "Using browser batch (x)". */
const tool = (text: string) =>
  text.replace(/\bmcp__(?:plugin_)?([\w-]+?)__([\w-]+)/g, (_, server, name) => {
    const s = String(server).replace(/_/g, "-").split("-").at(-1);
    return `${String(name).replace(/_/g, " ")} (${s})`;
  });

/**
 * The now line. Claude's narrated now wins; an inferred one from a command reads as the
 * command's description, else "Running a command", never as the command itself.
 */
export function nowLine(
  req: RequestView,
  events: MurmurEvent[],
  done: boolean,
): { label: string; text: string; src?: MurmurEvent; why?: string } {
  const now = req.now;
  const over =
    done && (req.planInferred || !!req.recap || !now || !!now.inferred);
  if (over) return { label: "In all", text: doneLine(req.tally) };
  if (!now)
    return {
      label: "Now",
      text: "Waiting for Claude to say what it is working on.",
    };
  const src = nowSource(req, events);
  const label = done ? "Last" : "Now";
  if (now.inferred) {
    const input = obj(src?.payload.tool_input);
    const desc = str(input.description).replace(/\s+/g, " ").trim();
    if (
      src?.payload.tool_name === "AskUserQuestion" ||
      /\bAskUserQuestion\b/.test(now.text)
    ) {
      const n = askQuestions(src ?? ({ payload: {} } as MurmurEvent)).length;
      const text =
        n > 1 ? `Asking you ${n} questions` : "Asking you a question";
      return { label, text, ...(src ? { src } : {}) };
    }
    const command =
      src?.payload.tool_name === "Bash" || /^Running\b/.test(now.text);
    const text = command ? desc || "Running a command" : tool(now.text);
    return { label, text, ...(src ? { src } : {}) };
  }
  return { label, text: now.text, ...(now.why ? { why: now.why } : {}) };
}

/** A task's name without its plan number: "Task 3: Reminder list" reads "Reminder list". */
export function shortTitle(title: string): string {
  const s = title
    .replace(
      /^(?:(?:tasks?|bug|fix|step)\s+)?[A-Z]?\d+[a-z]?(?:\s*[-–,&]\s*\d+)*\s*[:.)–-]\s+/i,
      "",
    )
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : title;
}

/** The helpers on a task, by its own list and its part's. */
export function taskAgents(req: RequestView, task: TaskView): AgentView[] {
  const part = req.parts.find((p) => p.id === task.part);
  const ids = new Set([...task.agents, ...(part?.agents ?? [])]);
  return req.agents.filter((a) => ids.has(a.id));
}

const valid = (ts: string | undefined): ts is string =>
  !!ts && !Number.isNaN(Date.parse(ts));

/** When a task's work was seen, earliest and latest: its helpers, steps and messages. */
export function taskTimes(req: RequestView, task: TaskView): string[] {
  const part = req.parts.find((p) => p.id === task.part);
  return [
    ...taskAgents(req, task).flatMap((a) => [
      a.startedAt,
      a.endedAt,
      a.report?.ts,
    ]),
    ...(req.recap ? [] : (part?.steps.map((s) => s.ts) ?? [])),
    ...(req.messages ?? []).filter((m) => m.task === task.id).map((m) => m.ts),
  ]
    .filter(valid)
    .sort();
}

export function phaseSpan(
  req: RequestView,
  phase: PhaseView,
): { from?: string; to?: string } {
  const times = phase.tasks.flatMap((t) => taskTimes(req, t)).sort();
  const from = times[0];
  const to = times.at(-1);
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/**
 * The phase where the work is: of the phases running, the one with the latest activity
 * (a plan often leaves an earlier phase open while the next one is under way), else the
 * first one not done.
 */
export function livePhase(
  req: RequestView,
  done: boolean,
): PhaseView | undefined {
  if (done) return undefined;
  const running = req.phases.filter((p) => p.status === "now");
  if (running.length < 2)
    return running[0] ?? req.phases.find((p) => p.status !== "done");
  const last = (p: PhaseView) => phaseSpan(req, p).to ?? "";
  return running.reduce((a, b) => (last(b) > last(a) ? b : a));
}

/** "Phase 1 of 2": a phase's own number when its title has one, else its place. */
export function phasePlace(req: RequestView, phase: PhaseView): string {
  const own = /^phase\s+(\d+)\b/i.exec(phase.title)?.[1];
  return `Phase ${own ?? req.phases.indexOf(phase) + 1} of ${req.phases.length}`;
}

/** A helper's model, from the Agent call that started it. */
export function modelOf(a: AgentView, events: MurmurEvent[]): string {
  const call = events.find(
    (e) =>
      e.hook === "PreToolUse" &&
      e.payload.tool_name === "Agent" &&
      str(obj(e.payload.tool_input).prompt) === a.prompt,
  );
  const m = str(obj(call?.payload.tool_input).model);
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "";
}

export type HelperKind = "build" | "review" | "recheck";

export function helperKind(a: AgentView): HelperKind | undefined {
  const d = a.description;
  if (/\bre-?review|\bre-?check/i.test(d)) return "recheck";
  if (/\breview/i.test(d)) return "review";
  if (/^(?:implement|build|write|add|draft|create|fix)\b/i.test(d))
    return "build";
  return undefined;
}

export interface Run {
  from: string;
  to: string;
  running: boolean;
}

/**
 * A helper's runs of work: from its start (or a message sent to it) to its next report
 * or stop. A helper sent back to fix its work has a second run.
 */
export function helperRuns(
  a: AgentView,
  events: MurmurEvent[],
  now: string,
): Run[] {
  const starts = [
    a.startedAt,
    ...events
      .filter(
        (e) =>
          e.hook === "PreToolUse" &&
          e.payload.tool_name === "SendMessage" &&
          str(obj(e.payload.tool_input).to) === a.id &&
          e.ts > a.startedAt,
      )
      .map((e) => e.ts),
  ].sort();
  const ends = events
    .filter(
      (e) =>
        (e.hook === "SubagentStop" && e.payload.agent_id === a.id) ||
        (e.hook === "UserPromptSubmit" &&
          str(e.payload.prompt).includes(`<task-id>${a.id}</task-id>`)),
    )
    .map((e) => e.ts)
    .concat(a.endedAt ?? [], a.report?.ts ?? [])
    .sort();
  return starts.map((from, i) => {
    const next = starts[i + 1];
    const end = ends.find((t) => t >= from && (!next || t <= next));
    const last = i === starts.length - 1;
    const running = last && a.status === "running" && !end;
    // A run resumed after the helper's last stop, with no stop of its own seen, ends
    // where it starts rather than before.
    const stopped = a.endedAt && a.endedAt > from ? a.endedAt : from;
    return { from, to: end ?? (running ? now : stopped), running };
  });
}

/** "Done after one fix round". */
const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
export function rounds(n: number): string {
  return `${WORDS[n] ?? n} fix ${n === 1 ? "round" : "rounds"}`;
}
