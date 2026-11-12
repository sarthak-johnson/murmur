// Murmur office: SessionView (+ a time) -> scene. Pure, no DOM, no layout pixels.
// Everything here reads fields core already builds, except `mainLog` (Claude's own
// main-thread calls), which core would need to expose for Claude's spot.

import type {
  AgentRole,
  AgentView,
  PhaseView,
  RequestState,
  SessionView,
  TaskView,
} from "@murmur/core";
import { requestShort } from "../session";

/** One of Claude's own main-thread events: a prompt, a helper's report coming in, a Stop or a tool call. */
export interface MainEntry {
  t: string;
  k: "prompt" | "report" | "stop" | "tool";
  /** The tool, with Murmur's MCP prefix shortened to "murmur:" ("murmur:narrate"). */
  tool?: string;
  /** Its description, `now`, `summary` or file name, cut at a word within 120 characters. */
  label?: string | undefined;
  /** SendMessage: the helper it went to. */
  to?: string | undefined;
  /** Agent: the helper's description and model. */
  desc?: string | undefined;
  model?: string | undefined;
  /** murmur:narrate: the task it names. */
  task?: string | undefined;
}

/** What the scene reads besides the view: Claude's own calls and each helper's latest action. */
export interface OfficeLogs {
  /** Time-sorted. */
  mainLog: MainEntry[];
  /** A helper's latest action at t in plain words ("Reading App.tsx"). */
  doing(agentId: string, t: string): string | undefined;
  info(agentId: string): { model?: string | undefined } | undefined;
}

/** Where Claude stands. */
export type SpotName =
  | "board"
  | "helper"
  | "archive"
  | "desk"
  | "terminal"
  | "door"
  | "away";
/** The kind of work on a helper's screen and in its hands. */
export type Act = "edit" | "read" | "search" | "run";

/** Where Claude stands, by its latest own tool call. */
export function spotForTool(e: {
  tool?: string | undefined;
  label?: string | undefined;
}): SpotName {
  const tool = e.tool ?? "";
  if (tool === "murmur:narrate" || tool === "murmur:map") return "board";
  if (tool === "Agent" || tool === "SendMessage") return "helper";
  if (/^(Read|Grep|Glob|ToolSearch|Skill|WebFetch|WebSearch)$/.test(tool))
    return "archive";
  if (/^(Edit|Write|NotebookEdit|ArtifactData)$/.test(tool)) return "desk";
  if (tool === "Bash" || tool === "Monitor") {
    const d = (e.label ?? "").toLowerCase();
    if (
      /\b(test|tests|lint|push|merge|deploy|install|commit|build|run|serve|start)\b/.test(
        d,
      )
    )
      return "terminal";
    if (
      /^(read|list|check|count|get|print|find|look|show|locate|search|see)\b/.test(
        d,
      )
    )
      return "archive";
    if (
      /^(write|append|log|edit|update|package|extract|add|fix|record|save|split|create)\b/.test(
        d,
      )
    )
      return "desk";
    return "terminal";
  }
  return "desk";
}

const REVIEW = new Set<AgentRole | undefined>(["review", "recheck"]);
export const DESKS = { build: 8, review: 4 };
export const ROLE_WORD: Partial<Record<AgentRole, string>> = {
  build: "Builder",
  review: "Reviewer",
  recheck: "Re-reviewer",
  fix: "Fixer",
  plan: "Planner",
  research: "Researcher",
};
const STAGE: Partial<Record<AgentRole, string>> = {
  review: "in review",
  recheck: "in review",
  fix: "fixing",
  build: "building",
  plan: "planning",
  research: "researching",
};

const STALE_MS = 60 * 60_000;
/** Words that number a stretch of work: "Batch 2" chips as B2. */
const NUMBERED =
  /^(Batch|Round|Step|Stage|Wave|Part|Milestone|Sprint)\s+(\d+[a-z]?)\b/i;

/** "bg needs your input" (a session's own label in a notification) reads as Claude's. */
function waitWords(text: string): string {
  // Only a lowercase label ("bg"), never a name like "Murmur" that means itself.
  return /^[a-z][\w-]* needs your (input|attention|permission)/.test(text)
    ? text.replace(/^\S+/, "Claude")
    : text;
}
/** Claude's own last call older than this is no longer what it is doing. */
export const QUIET_MS = 15 * 60_000;

/**
 * The request Claude is on: the newest still at work or waiting on you, so a quick notice
 * answered while a long request runs on never hides that one; else the newest.
 */
export function activeRequest<R extends { state?: string | undefined }>(
  reqs: readonly R[],
): R | undefined {
  return (
    reqs.findLast((r) => r.state === "running" || r.state === "waiting") ??
    reqs.at(-1)
  );
}

/** Cut at a word boundary within n characters. */
export function cutWords(s: string, n: number): string;
export function cutWords(s: string | undefined, n: number): string | undefined;
export function cutWords(s: string | undefined, n: number): string | undefined {
  if (!s || s.length <= n) return s;
  const c = s.slice(0, n + 1).replace(/\s+\S*$/, "");
  return `${(c.length > n * 0.5 ? c : s.slice(0, n - 1)).replace(/[\s,;:·-]+$/, "")}…`;
}

/** "Build Task 67 Portfolio reads/styles" -> "Portfolio reads/styles". */
export function helperName(a: { description?: string | undefined }): string {
  // A model note ("(Opus)") is on the plate already; it never names the work.
  const desc = (a.description ?? "")
    .replace(/\s*\((opus|sonnet|haiku)[^)]*\)\s*$/i, "")
    .trim();
  const verbless = desc.replace(
    /^(Build|Review|Re-?review|Recheck|Plan|Fix|Write|Implement|Research|Draft|Add|Create)\s+/i,
    "",
  );
  const subject = /^(Tasks?\s+[\w-]+|Phases?\s+\d+|B\d+)/i.exec(verbless)?.[0];
  // What is left after the subject; "Task 38: capture chat reads" leaves a colon behind.
  const rest = verbless
    .replace(/^(Tasks?\s+[\w-]+|Phases?\s+\d+|B\d+)\s*/i, "")
    .replace(/^[\s:;,.\-–]+/, "");
  let d = rest.replace(/^(fix round \d+:?)\s*/i, "");
  // A bare leftover ("round 2", "fix round 4") says nothing alone, so it keeps its subject.
  if (subject && /^((fix(es)?|round \d+|review|recheck)[\s:]*)*$/i.test(d))
    d = `${subject} ${rest}`.trim();
  d = d || desc || "A helper";
  return cutWords(d.charAt(0).toUpperCase() + d.slice(1), 24);
}

// Imperative first words of Bash descriptions, said as what the helper is doing ("Read X" -> "Reading X").
const IMPERATIVE =
  /^(read|list|check|find|inspect|compare|extract|skim|see|locate|split|remove|pin|scan|survey|count|map|run|fix|make|move|open|look|view|show|grep|search|write|edit|add|update|verify|confirm|trace|measure|copy|create|build|test|diff|print|dump|fetch|query|sort|wait|kill|start|stop|restart|install|commit|stage|push|pull|rebase|merge|lint|format|type|capture|record|render|take)\b/i;
const DOUBLE = new Set([
  "run",
  "pin",
  "map",
  "scan",
  "split",
  "stop",
  "set",
  "get",
  "put",
  "cut",
  "plan",
  "drop",
  "tap",
]);
/** "Read HeroMoney component" -> "Reading HeroMoney component"; anything else unchanged. */
export function asDoing(text: string): string;
export function asDoing(text: string | undefined): string | undefined;
export function asDoing(text: string | undefined): string | undefined {
  const w = text ? IMPERATIVE.exec(text)?.[1] : undefined;
  if (!text || !w) return text;
  const low = w.toLowerCase();
  let ing: string;
  if (DOUBLE.has(low)) ing = `${w}${w.slice(-1)}ing`;
  else if (/[^e]e$/i.test(w) && low !== "see") ing = `${w.slice(0, -1)}ing`;
  else ing = `${w}ing`;
  return ing + text.slice(w.length);
}

/** The latest entry of a time-sorted log at or before t (binary search). */
export function latestAt(log: readonly { t: string }[], t: string): number {
  let lo = 0;
  let hi = log.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((log[mid]?.t ?? "") <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** A chip-sized name: "Phase 4 Portfolio" -> P4, "Phases 6-7" -> P6-7, "Task 177 Library sweep" -> T177, else its first word. */
export function shortOf(title: string): string {
  const p = /\bPhases?\s+(\d+(?:\s*[-–]\s*\d+)?)/i.exec(title);
  const t = /\bTasks?\s+(\d+[a-z]?)/i.exec(title);
  if (t) return `T${t[1]}`;
  if (p) return `P${(p[1] ?? "").replace(/\s/g, "")}`;
  // "Batch 2 Library", "Round 3": a numbered word reads as its letter and number, so two
  // batches never share a chip.
  const numbered = NUMBERED.exec(title);
  if (numbered)
    return `${(numbered[1] ?? "").charAt(0).toUpperCase()}${numbered[2]}`;
  return (title.split(/[\s:]+/)[0] ?? "").slice(0, 8);
}

/** What kind of work a helper's latest action is, for its screen and hands. The doing text is built
 * from the tool or the Bash description, so this goes by meaning: a Bash "Read the plan" is reading. */
export function actOf(text: string | undefined): Act {
  if (!text) return "edit";
  if (
    /^(Read|Reading|Skim|Inspect|Check|See|View|Extract|Survey|Look)\b/i.test(
      text,
    )
  )
    return "read";
  if (
    /^(Search|Searching|Find|Locate|List|Listing|Grep|Scan|Count)\b/i.test(text)
  )
    return "search";
  if (/^(Editing|Writing)\b/.test(text)) return "edit";
  return "run";
}

/** A helper on this floor: this request's, or (`fromRequest`, its number) an earlier one's still at work. */
export type Helper = AgentView & { fromRequest?: number };

/** A helper's desk and what is shown on and around it. */
export interface Desk {
  kind: "build" | "review";
  /** Its place in WORK_DESKS or REVIEW_DESKS. */
  slot: number;
  agent: string;
  description: string;
  subject?: string | undefined;
  role?: AgentRole | undefined;
  /** Its short name for the plate ("Portfolio reads/styles"). */
  name: string;
  /** "Builder", "Reviewer", ..., else "Helper". */
  roleWord: string;
  startedAt: string;
  endedAt?: string | undefined;
  status: AgentView["status"];
  /** It works for an earlier request: that request's number. */
  fromRequest?: number | undefined;
  /** Its place in the floor's start order, for its look. */
  look: number;
  /** While running: the kind of work, and its latest action as a bubble (never the same words on two desks). */
  act?: Act;
  bubble?: string;
  /** The board column and sticky it works for; `group` picks its colour and `chip` its plate chip. */
  phase?: number;
  task?: string;
  group?: number;
  chip?: string;
  /** The model Claude briefed it with. */
  model?: string | undefined;
}

/** A sticky note: one plan task. */
export interface Note {
  id: string;
  phase: string;
  status: TaskView["status"];
  title: string;
  agents: string[];
  /** The running helpers on it, for the head chips. */
  heads: string[];
  /** While under way: the stages of the helpers on it ("building + in review"). */
  stage?: string | undefined;
}

/** A board column: one plan phase. */
export interface Column {
  id: string;
  title: string;
  status: PhaseView["status"];
  notes: Note[];
}

/** Claude: where it stands, what it says, and what it is on. */
export interface ClaudeSpot {
  spot: SpotName;
  bubble?: string | undefined;
  /** At its desk with nothing of its own going on (its turn ended, or none yet). */
  idle?: boolean;
  /** At your door, waiting on you since `since`. */
  waiting?: boolean;
  /** When the call (or wait) it is on started. */
  since?: string;
  tool?: string | undefined;
  /** At this helper's desk (a brief, or a note to it). */
  helper?: string;
  /** At the board: the column it stands by. */
  column?: number;
}

/** What Claude waits on you for. */
export interface Waiting {
  text: string;
  since: string;
  asks: string[];
}

/** A request on the request board. */
export interface Job {
  id: string;
  n: number;
  short: string;
  state?: RequestState | undefined;
}

export interface Scene {
  request: {
    id: string;
    /** 1-based. */
    n: number;
    short: string;
    goal: string;
    state?: RequestState | undefined;
    startedAt: string;
    /** The latest request: Claude is on this floor. */
    current: boolean;
  };
  plan: { done: number; total: number };
  columns: Column[];
  /** The column Claude last narrated, else the first under way; -1 for none. */
  focus: number;
  desks: Desk[];
  /** Helpers with no desk free for them. */
  off: Helper[];
  claude: ClaudeSpot;
  waiting: Waiting | null;
  /** Helpers at work. */
  running: number;
  jobs: Job[];
  /** The number of the request Claude is on: the newest, or one still at work under it. */
  activeN: number;
}

/** Claude at its desk, at a helper's desk or the board, by its latest own call; null for no call in this request. */
function claudeFromLog(
  e: MainEntry | null,
  busy: number,
  helpers: Helper[],
  desks: Desk[],
  columns: Column[],
  focus: number,
): ClaudeSpot {
  if (!e || e.k === "stop") {
    return {
      spot: "desk",
      bubble: busy
        ? `Watching ${busy} helper${busy > 1 ? "s" : ""}`
        : undefined,
      idle: true,
    };
  }
  if (e.k !== "tool") {
    return {
      spot: "desk",
      bubble:
        e.k === "report" ? "Reading a helper's report" : "Reading your message",
      since: e.t,
    };
  }
  const claude: ClaudeSpot = {
    spot: spotForTool(e),
    bubble: cutWords(e.label, 80),
    tool: e.tool,
    since: e.t,
  };
  if (claude.spot === "helper") {
    const a = e.to
      ? helpers.find((h) => h.id === e.to)
      : helpers.find((h) => h.description === e.desc);
    const desk = a && desks.find((d) => d.agent === a.id);
    if (desk) {
      claude.helper = desk.agent;
      claude.bubble = cutWords(
        e.tool === "Agent"
          ? `Briefing: ${desk.name}`
          : `Note to ${desk.name}: ${e.label}`,
        80,
      );
    } else claude.spot = "desk";
  }
  if (claude.spot === "board") {
    const col = e.task
      ? columns.findIndex((c) => c.notes.some((n) => n.id === e.task))
      : -1;
    claude.column = col >= 0 ? col : Math.max(0, focus);
  }
  return claude;
}

/**
 * view: a core SessionView. reqId: the request whose floor is shown (the first when not found);
 * t: ISO time; logs: Claude's own calls and each helper's latest action. Null for a view with no request.
 */
export function deriveScene(
  view: Pick<SessionView, "requests" | "needsYou">,
  reqId: string,
  t: string,
  logs: OfficeLogs,
  /**
   * The floor Claude is on, when not the newest request (one still at work under a done
   * notice): whether this is it, and its number.
   */
  opts: { onFloor?: boolean; activeN?: number; quiet?: boolean } = {},
): Scene | null {
  const reqs = view.requests;
  const idx = Math.max(
    0,
    reqs.findIndex((r) => r.id === reqId),
  );
  const req = reqs[idx];
  if (!req) return null;
  const current = opts.onFloor ?? idx === reqs.length - 1;

  // Helpers: this request's, plus (on the current floor) any earlier request's still at work.
  // One with no sign of life for an hour is not at work, whatever its last word: a helper
  // whose stop was never recorded would otherwise sit at a desk for days.
  const carried: Helper[] = current
    ? reqs
        .slice(0, idx)
        // Only a request still under way (as core says) has helpers at work.
        .flatMap((r, i) =>
          r.state !== "running" && r.state !== "waiting"
            ? []
            : r.agents
                .filter(
                  (a) =>
                    a.status === "running" &&
                    Date.parse(t) - Date.parse(a.doing?.ts ?? a.startedAt) <
                      STALE_MS,
                )
                .map((a) => ({ ...a, fromRequest: i + 1 })),
        )
    : [];
  // This request's own helper gone quiet for an hour reads as stopped at its last sign.
  const own: Helper[] = req.agents.map((a) => {
    const lastSign = a.doing?.ts ?? a.startedAt;
    return a.status === "running" &&
      Date.parse(t) - Date.parse(lastSign) >= STALE_MS
      ? { ...a, status: "done", endedAt: lastSign }
      : a;
  });
  const helpers: Helper[] = [...carried, ...own].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  const look = new Map(helpers.map((a, i) => [a.id, i]));

  // Desks: first free slot by start order; a done helper's desk is reused once all are taken.
  const desks: Desk[] = [];
  const off: Helper[] = [];
  const said = new Set<string>();
  const rooms = {
    build: Array.from({ length: DESKS.build }, (): Helper | null => null),
    review: Array.from({ length: DESKS.review }, (): Helper | null => null),
  };
  // Helpers with no desk in their own room; a free desk in the other room takes them.
  const unseated: Helper[] = [];
  for (const kind of ["build", "review"] as const) {
    const slots = rooms[kind];
    for (const a of helpers.filter(
      (h) => (kind === "review") === REVIEW.has(h.role),
    )) {
      let s = slots.indexOf(null);
      if (s < 0) {
        s = slots.findIndex(
          (o) => o?.status === "done" && o.endedAt && o.endedAt <= a.startedAt,
        );
      }
      if (s < 0) {
        unseated.push(a);
        continue;
      }
      const was = slots[s];
      if (was) off.push(was);
      slots[s] = a;
    }
  }
  for (const a of unseated) {
    const other = REVIEW.has(a.role) ? rooms.build : rooms.review;
    const s = other.indexOf(null);
    if (s < 0) off.push(a);
    else other[s] = a;
  }
  for (const kind of ["build", "review"] as const) {
    rooms[kind].forEach((a, slot) => {
      if (!a) return;
      desks.push({
        kind,
        slot,
        agent: a.id,
        description: a.description,
        subject: a.subject,
        role: a.role,
        name: helperName(a),
        roleWord: (a.role && ROLE_WORD[a.role]) ?? "Helper",
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        status: a.status,
        fromRequest: a.fromRequest,
        look: look.get(a.id) ?? 0,
      });
    });
  }
  // Names that all open the same way ("Lit plate: Portfolio", "Lit plate: Chat") lose the
  // shared opening, so a plate keeps the words that tell it apart.
  const opening = /^([^:]{2,24}):\s+/;
  const first = opening.exec(desks[0]?.name ?? "")?.[0];
  if (first && desks.length > 1 && desks.every((d) => d.name.startsWith(first)))
    for (const d of desks) {
      const rest = d.name.slice(first.length);
      d.name = rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  // Latest action as a bubble; never the same words on two desks (the later one shows just its screen).
  const atWork = desks
    .filter((k) => k.status === "running")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const d of atWork) {
    const doing = logs.doing(d.agent, t);
    d.act = actOf(doing);
    const text = cutWords(asDoing(doing), 32);
    if (text && !said.has(text)) {
      d.bubble = text;
      said.add(text);
    }
  }

  const reqOver = req.state !== "running" && req.state !== "waiting";
  // Board: one column per phase, one sticky note per task, with who is on it and at what stage.
  const running = new Map(
    desks.filter((d) => d.status === "running").map((d) => [d.agent, d]),
  );
  const columns: Column[] = req.phases.map((p) => ({
    id: p.id,
    title:
      p.title === "What Claude did" && p.status === "now"
        ? "What Claude is doing"
        : p.title,
    status: p.status,
    notes: p.tasks.map((task) => {
      const agents = task.agents ?? [];
      const on = agents
        .map((id) => running.get(id))
        .filter((d) => d !== undefined);
      const stages = [
        ...new Set(
          on.map((d) => (d.role ? STAGE[d.role] : undefined)).filter(Boolean),
        ),
      ];
      return {
        id: task.id,
        phase: p.id,
        // A request that is over (left open) has nothing under way: its unfinished tasks
        // read as not started, not as running in blue.
        status:
          task.status === "now" && on.length === 0 && reqOver
            ? "todo"
            : task.status,
        title: task.title,
        agents,
        heads: on.map((d) => d.agent),
        stage:
          task.status === "now" && stages.length
            ? stages.join(" + ")
            : undefined,
      };
    }),
  }));
  const tasks = columns.flatMap((c) => c.notes);
  // On a one-phase board each sticky has its own chip; two that would read the same get a letter.
  const noteChip = new Map<string, string>();
  const only = columns.length === 1 ? columns[0] : undefined;
  if (only) {
    const base = only.notes.map((n) => shortOf(n.title));
    only.notes.forEach((n, i) => {
      const mine = base[i] ?? "";
      const same = base.flatMap((b, j) => (b === mine ? [j] : []));
      noteChip.set(
        n.id,
        same.length > 1 ? mine + "abcdefghij"[same.indexOf(i)] : mine,
      );
    });
  }
  // Tie each desk to the sticky and phase it works for, and to the model Claude briefed it with.
  for (const d of desks) {
    const ci = columns.findIndex((c) =>
      c.notes.some((n) => n.agents.includes(d.agent)),
    );
    const col = columns[ci];
    const note = col?.notes.find((n) => n.agents.includes(d.agent));
    if (col && note) {
      const ni = col.notes.indexOf(note);
      d.phase = ci;
      d.task = note.id;
      // Colour and chip group desks by phase; a one-phase plan (one column) groups by task instead.
      d.group = only ? ni : ci;
      d.chip = only ? (noteChip.get(note.id) ?? "") : shortOf(col.title);
    }
    d.model = logs.info(d.agent)?.model;
  }

  // The column Claude last narrated, else the first one under way.
  let focus = -1;
  for (let i = latestAt(logs.mainLog, t); i >= 0; i--) {
    const e = logs.mainLog[i];
    if (!e || e.t < req.startedAt) break;
    if (e.tool === "murmur:narrate" && e.task) {
      focus = columns.findIndex((c) => c.notes.some((n) => n.id === e.task));
      break;
    }
  }
  if (focus < 0) focus = columns.findIndex((c) => c.status === "now");

  // Claude: away on a past request's floor; at your door when waiting; else by its last own call.
  const waiting: Waiting | null =
    current && view.needsYou && req.state === "waiting"
      ? {
          text: waitWords(view.needsYou.text),
          since: view.needsYou.since,
          asks: req.waiting ?? [view.needsYou.text],
        }
      : null;
  const busy = running.size;
  let claude: ClaudeSpot;
  if (!current) claude = { spot: "away" };
  else if (waiting) {
    claude = {
      spot: "door",
      bubble: waiting.text,
      waiting: true,
      since: waiting.since,
    };
  } else {
    const last = logs.mainLog[latestAt(logs.mainLog, t)];
    // A call that long ago is not what Claude is doing now: it sits at its desk.
    // So is any call in a session gone quiet (shown as it was left).
    const quiet =
      opts.quiet || (last && Date.parse(t) - Date.parse(last.t) > QUIET_MS);
    const e = last && last.t >= req.startedAt && !quiet ? last : null;
    claude = claudeFromLog(e, busy, helpers, desks, columns, focus);
  }

  return {
    request: {
      id: req.id,
      n: idx + 1,
      short: requestShort(req),
      goal: req.goal,
      state: req.state,
      startedAt: req.startedAt,
      current,
    },
    plan: {
      done: tasks.filter((n) => n.status === "done").length,
      total: tasks.length,
    },
    columns,
    focus,
    desks,
    off,
    claude,
    waiting,
    running: busy,
    jobs: reqs.map((r, i) => ({
      id: r.id,
      n: i + 1,
      short: requestShort(r),
      state: r.state,
    })),
    activeN: opts.activeN ?? reqs.length,
  };
}
