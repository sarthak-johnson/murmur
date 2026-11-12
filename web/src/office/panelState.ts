// What the office's panel shows (the `?open=` of its URL), and what a click in the room opens.
import type { RequestView } from "@murmur/core";
import { type SessionTab, TABS, type Tab } from "../router";

export const SESSION_VIEWS: readonly (readonly [SessionTab, string])[] = [
  ["journey", "Journey"],
  ["timeline", "Timeline"],
  ["requests", "Requests"],
];
export const REQUEST_VIEWS: readonly (readonly [Tab, string])[] = [
  ["story", "Story"],
  ["tasks", "Tasks"],
  ["flow", "Flow"],
  ["files", "Files"],
  ["helpers", "Helpers"],
];
export type PanelTab = SessionTab | Tab;

const SESSION_IDS: readonly string[] = SESSION_VIEWS.map(([t]) => t);
const SPOTS = ["door", "terminal", "claude"];

export const isSessionTab = (open: string): open is SessionTab =>
  SESSION_IDS.includes(open);
export const isTab = (open: string): open is PanelTab =>
  isSessionTab(open) || (TABS as readonly string[]).includes(open);

/** `open` as the panel can show it: a tab or a close-up; anything else is nothing. */
export function readOpen(open: string | undefined): string | null {
  if (!open) return null;
  if (isTab(open) || SPOTS.includes(open)) return open;
  const [kind, id] = open.split(/:(.*)/s);
  return (kind === "task" || kind === "helper") && id ? open : null;
}

/** Views that need room: the panel takes its wide width for them when the reader chose it. */
export const isWideView = (open: string) =>
  open === "flow" ||
  open === "timeline" ||
  open === "journey" ||
  open.startsWith("task:");

/** A room's click target (overlay.ts) as the panel's `open`. */
export function openFor(key: string, req: RequestView | undefined): string {
  const [kind, id = ""] = key.split(/:(.*)/s);
  if (kind === "phase") return "tasks";
  if (kind === "archive") return "files";
  if (kind === "helpers") return "helpers";
  if (kind === "jobs") return "requests";
  if (kind === "agent") return `helper:${id}`;
  if (kind === "task") {
    // A sticky is a task of the plan; its close-up is its part's page when it has one.
    const task = req?.phases.flatMap((p) => p.tasks).find((t) => t.id === id);
    return `task:${task?.part ?? id}`;
  }
  return key;
}

/** The panel's `open` as the room marks it selected: the overlay's own key for that thing. */
export function roomKey(open: string | null, req: RequestView | undefined) {
  if (!open) return null;
  const [kind, id = ""] = open.split(/:(.*)/s);
  if (kind === "helper") return `agent:${id}`;
  if (kind === "task") {
    const task = req?.phases
      .flatMap((p) => p.tasks)
      .find((t) => t.part === id || t.id === id);
    return `task:${task?.id ?? id}`;
  }
  return SPOTS.includes(open) ? open : null;
}

const TOOL_WORDS: Record<string, string> = {
  ArtifactData: "Updated an artifact's data",
  Artifact: "Published an artifact",
  ToolSearch: "Looked up a tool",
  TaskStop: "Stopped a background task",
  TaskCreate: "Started a background task",
  TodoWrite: "Updated its to-do list",
  WebSearch: "Searched the web",
  WebFetch: "Read a web page",
  Skill: "Used a skill",
  Grep: "Searched the code",
  Glob: "Looked for files",
  Read: "Read a file",
  Edit: "Edited a file",
  Write: "Wrote a file",
  Bash: "Ran a command",
  Monitor: "Watched a command",
  AskUserQuestion: "Asked you a question",
  ExitPlanMode: "Showed you its plan",
  CronCreate: "Scheduled a task",
  CronDelete: "Cancelled a scheduled task",
  SendMessage: "Wrote to a helper",
  NotebookEdit: "Edited a notebook",
};

/** A tool in words: its own, or the service an MCP tool belongs to ("Used Supabase"). */
export function toolWords(tool: string): string {
  const known = TOOL_WORDS[tool];
  if (known) return known;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (mcp) {
    const server = (mcp[1] ?? "")
      .replace(/^(claude_ai_|plugin_[^_]+_)/, "")
      .replace(/^claude-in-chrome$/, "the browser")
      .replace(/^mcp[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    if (!server) return "Used a connected tool";
    const named = server.startsWith("the ")
      ? server
      : server.replace(/\b\w/g, (c) => c.toUpperCase());
    return `Used ${named}`;
  }
  return `Used ${tool.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
}
