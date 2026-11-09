import type { MapInput } from "../narration.js";

export type Status = "todo" | "now" | "done";

export interface SessionView {
  sessionId: string;
  cwd: string;
  title: string;
  startedAt: string;
  lastEventAt: string;
  ended: boolean;
  requests: RequestView[];
  needsYou: NeedsYou | null;
  /**
   * Where the session started and where it went: its requests grouped into chapters,
   * the long pauses, the decisions and the totals. Core always sets it; optional only
   * so views built before it still type-check.
   */
  journey?: Journey;
}

export interface RequestView {
  id: string;
  prompt: string;
  startedAt: string;
  kind: MapInput["kind"];
  kindInferred: boolean;
  goal: string;
  phases: PhaseView[];
  planInferred: boolean;
  parts: PartView[];
  looseFiles: FileTouch[];
  now: NowView | null;
  agents: AgentView[];
  assumptions: Assumption[];
  flags: Flag[];
  /** A later request exists or the session ended. */
  finished: boolean;
  /** Helpers started, distinct files changed and commands run in this request. */
  tally: { helpers: number; files: number; commands: number };
  /**
   * What Claude wrote to the user, in time order: every `AssistantText` between this
   * request's prompt and the next request's. Core always sets it (empty when none);
   * optional only so views built before it still type-check.
   */
  messages?: MessageView[];
  /**
   * The plan, map and part detail came from Murmur's recap: the user's own Claude
   * summarised the imported history once, on their machine, through `map` and `narrate`
   * calls marked `recap: true`. Then `planInferred` is false, and the web labels the
   * request "Recap by Claude" where it shows "inferred" for an inferred one. Unset
   * when the plan came from live narration or was inferred.
   */
  recap?: boolean;
  /**
   * The request in 2 to 4 words, for the rail and the journey: the map's `short` when
   * Claude (or the recap) gave one, else cut from `goal` at the first comma, colon,
   * " - " or " and then ", without a filler verb ("Start", "Resume") when what is left
   * still reads, at a word boundary within 32 characters. Core always sets it.
   */
  short?: string;
  /**
   * Where the request stands, read from its last events (first match wins):
   * - "waiting": the session's `needsYou` came during this request.
   * - "running": it is the last request and its last event is not a Stop, or one of its
   *   helpers still runs (not quiet for over 10 minutes before the session's latest event).
   * - "left-open": a later request exists and plan tasks remain not done.
   * - "failed": its last event is a StopFailure, or its last helper (or narrated step)
   *   failed and nothing passed after.
   * - "done": otherwise.
   * Core always sets it.
   */
  state?: RequestState;
  /**
   * How it ended in a sentence: the first sentence of the last message that reads as done
   * (`moment` is "done"), else of the last message, at most 240 characters cut at a word.
   * Unset when Claude wrote nothing.
   */
  outcome?: string;
  /**
   * What Claude asked when `state` is "waiting": the questions of a pending
   * `AskUserQuestion` call, else the question sentences of its last message.
   */
  waiting?: string[];
  /**
   * Work after the plan: set when every plan task is done (by a live narrate, or by
   * TaskCompleted on a native task list) and work goes on after it (a tool call or a
   * helper start, not just a closing message). A recap's plan has no real times, so a
   * recapped request never has one.
   */
  beyond?: Beyond;
  /** Helpers by `AgentView.role`; plan, research and other ones count as other. */
  helperCounts?: HelperCounts;
  /** Subjects ("Task 39", "B7") this request's helpers took past round 1, first seen first. */
  sentBack?: string[];
}

export type RequestState =
  | "running"
  | "waiting"
  | "done"
  | "left-open"
  | "failed";

export interface Beyond {
  /** When the last plan task turned done (the latest time the whole plan became done). */
  since: string;
  /** Helpers started after `since`, or started before and still working after it. */
  agents: string[];
  /** Messages written after `since`, by id; they have no `phase`. */
  messages: string[];
  /** Fix rounds among those helpers: distinct subject and round pairs past round 1. */
  rounds: number;
}

export interface HelperCounts {
  build: number;
  review: number;
  recheck: number;
  fix: number;
  other: number;
}

/** One message Claude wrote to the user on the main thread. */
export interface MessageView {
  /** The `AssistantText` event's id. */
  id: string;
  ts: string;
  /** Claude's text as written (Markdown), scrubbed. */
  text: string;
  /**
   * The task in this request's `phases` the message is about, by id. On an inferred plan
   * a task's id is its part's id. Set only when the message names its subject ("Task 1",
   * "Tasks 4-5", "B7", "bug B1") or, on a narrated request, contains a task's or part's
   * title; unset when unsure.
   */
  task?: string;
  /** The helper (`AgentView.id`) whose report arrived just before, in the same turn. */
  agent?: string;
  /**
   * The phase (`PhaseView.id`) the message belongs to: its `task`'s phase when it names
   * one, else the phase whose time window holds it. A phase's window runs from the first
   * event tied to any of its tasks (a live narrate naming it, a helper on it or named for
   * its subject, a message naming it, a file change on its part) to the next window's
   * start. Messages before every window go to the first phase. Unset on a request with
   * no phases, and on a message after the plan was done (it is in `beyond.messages`).
   */
  phase?: string;
}

export interface PhaseView {
  id: string;
  title: string;
  status: Status;
  tasks: TaskView[];
}

export interface TaskView {
  id: string;
  title: string;
  part?: string;
  status: Status | "failed";
  agents: string[];
  problem?: string;
  /**
   * Fix rounds the task took: the highest `AgentView.round` of this request's helpers on
   * its subject ("Task 39", read from its title or its part's), less one. Unset when no
   * helper is tied to it.
   */
  rounds?: number;
}

export interface PartView {
  id: string;
  title: string;
  phase?: string;
  tag?: string;
  status: Status;
  links: { to: string; label: string }[];
  /**
   * What the part is for and how we know it is done. `inferred` when Murmur read it from
   * the record (see `PartView.inferred`), never on an aim Claude gave.
   */
  aim?: { aim: string; doneWhen: string; inferred?: boolean };
  io?: { gets: string; gives: string };
  steps: StepView[];
  files: FileTouch[];
  choices: { choice: string; reason: string; assumption: boolean }[];
  checks: { check: string; status: "pass" | "fail" | "untried" }[];
  words: { term: string; meaning: string }[];
  agents: string[];
  failures: number;
  /** Fix rounds, as `TaskView.rounds`, for the part's subject. */
  rounds?: number;
  /**
   * Murmur filled the part's `aim` or `steps` from the record because Claude never gave
   * them: aim from the first builder's brief (else the first reviewer's), done-when from
   * how it ended ("" when unknown); steps from its helpers (labelled by role and verdict:
   * "Built", "Sent back", "Fixed", "Passed"), live narrates naming it and messages naming
   * its tasks. Narrated fields are never replaced.
   */
  inferred?: boolean;
  /** From its first to its last event; no `end` while it is under way. Unset when nothing is tied to it. */
  span?: { start: string; end?: string };
}

export interface StepView {
  ts: string;
  text: string;
  status: "running" | "done" | "failed";
  agentId?: string;
  eventIds: string[];
}

export interface NowView {
  text: string;
  why: string;
  part?: string;
  ts: string;
  /** Read from the latest tool call or Stop because no narrate came after it. */
  inferred?: boolean;
  /** The raw command (or tool name) an inferred `text` stands for, one click away. */
  detail?: string;
}

export interface FileTouch {
  path: string;
  /** What the file does, as narrated; else its path group (see `roleInferred`). */
  role?: string;
  /** `role` is a path group ("tests", "styles", "docs", "config", "source"), not Claude's words. */
  roleInferred?: boolean;
  added: number;
  removed: number;
  isNew: boolean;
  eventIds: string[];
}

export interface AgentView {
  id: string;
  type: string;
  description: string;
  prompt: string;
  part?: string;
  status: "running" | "done";
  startedAt: string;
  endedAt?: string;
  lastText?: string;
  /**
   * What the helper was asked to do, in a few sentences: the first paragraph of `prompt`
   * about the work (the one under a `## Context` heading when there is one; lines that
   * only point at files or give working rules are skipped), plain text, at most 600
   * characters, cut at a sentence end. Unset when the prompt has no such paragraph.
   */
  brief?: string;
  /** The helper's report back to Claude, once one arrived. */
  report?: AgentReport;
  /**
   * The kind of work, from `description`: "recheck" (re-review, recheck), "fix" (Fix ...,
   * a fix round), "review", "plan", "build" (implement, build, write, add, draft, create),
   * "research", else "other".
   */
  role?: AgentRole;
  /**
   * What it worked on, from `description`: "Task 39", "Tasks 13-14", "Task 18a", "B7"
   * (also from "bug B7"), else "Phase 2". Unset when none is named.
   */
  subject?: string;
  /**
   * The round of work on `subject` across the session: 1 for its first build and review,
   * n + 1 for a "fix round n" (or "rounds 2-3", the last), one past the latest round for a
   * re-review or fix round with no number and a fix after a review (a re-review right
   * after a fix shares its round). Unset with no subject.
   */
  round?: number;
}

export type AgentRole =
  | "build"
  | "review"
  | "recheck"
  | "fix"
  | "plan"
  | "research"
  | "other";

/**
 * A helper's report. A background helper reports through a task notification (a later
 * one for the same helper replaces it); a foreground one through its Agent call's result.
 */
export interface AgentReport {
  /** The notification's `<status>`; "completed" for a foreground result. */
  status: "completed" | "failed" | "killed" | (string & {});
  /** The notification's `<summary>`, e.g. `Agent "Build style A" finished`; "" for a foreground result. */
  summary: string;
  /** The report itself, as the helper wrote it (Markdown). */
  text: string;
  /**
   * From a first line like `Status: DONE`: "DONE", "DONE_WITH_CONCERNS", "BLOCKED",
   * "NEEDS_CONTEXT" and so on, as written. Unset when the report has no such line.
   */
  verdict?: string;
  /** When the report arrived. */
  ts: string;
  /** The helper stopped with background work of its own still running; a later report may follow. */
  interim: boolean;
}

export interface NeedsYou {
  reason: "permission" | "question" | "idle" | "input";
  text: string;
  since: string;
}

export interface Flag {
  kind: "stuck" | "risky";
  text: string;
  part?: string;
  ts: string;
  pending: boolean;
}

export interface Assumption {
  key: string;
  part?: string;
  choice: string;
  reason: string;
  ts: string;
}

/** The session as a journey, for the session page. */
export interface Journey {
  /**
   * Consecutive requests about the same work. A request joins the chapter before when
   * both name phases ("Phase 2", in goals and plan titles) and share one; else when they
   * share a task or item number from their plan's titles; else when neither names any
   * and the request's kind is the previous one's. Titled from the shared phase ("Phase 2:
   * the agent page", "Phases 0 and 1"), else the first request's `short`.
   */
  chapters: Chapter[];
  /** Gaps over one hour, between requests and inside one, in time order. */
  pauses: Pause[];
  /** Choices of a style, a plan or an approval, by Claude or by the user, in time order. */
  decisions: Decision[];
  totals: {
    helpers: number;
    /** Distinct paths changed across the session. */
    files: number;
    commands: number;
    /** Distinct subjects sent back for a fix round, across the session. */
    sentBack: number;
    pauses: number;
  };
}

export interface Chapter {
  title: string;
  requestIds: string[];
  /** "waiting" or "running" when a request in it is, else its last request's state. */
  state: RequestState;
}

export interface Pause {
  /** The request the gap is inside, or the one it follows. */
  after: string;
  from: string;
  to: string;
  /** The gap is inside the request, not between it and the next. */
  inside: boolean;
}

export interface Decision {
  ts: string;
  requestId: string;
  /** One short sentence. */
  text: string;
  /** "claude" for a message that reads as a decision, "user" for a prompt that approves. */
  by: "claude" | "user";
}

/** The kind of moment a message is (the story's badge). */
export type Moment = "problem" | "fixing" | "done" | "decision" | "plan";

/** One line of a request's brief, from `keyMoments`. */
export interface KeyMoment {
  ts: string;
  mark: Moment;
  text: string;
  /** The task it is about, by id. */
  task?: string;
  /** It came after the viewer last looked. */
  new: boolean;
}
