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
}

export interface PartView {
  id: string;
  title: string;
  phase?: string;
  tag?: string;
  status: Status;
  links: { to: string; label: string }[];
  aim?: { aim: string; doneWhen: string };
  io?: { gets: string; gives: string };
  steps: StepView[];
  files: FileTouch[];
  choices: { choice: string; reason: string; assumption: boolean }[];
  checks: { check: string; status: "pass" | "fail" | "untried" }[];
  words: { term: string; meaning: string }[];
  agents: string[];
  failures: number;
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
}

export interface FileTouch {
  path: string;
  role?: string;
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
}

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
