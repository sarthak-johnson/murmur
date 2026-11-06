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
