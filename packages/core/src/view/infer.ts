/*
 * Fallbacks for a request with no valid map call: kind from the prompt, and one
 * `Tasks` phase from TaskCreated / TaskCompleted (field names unverified, read tolerantly).
 * A request with a map keeps everything from the map path.
 * Also `now` from the latest tool call when no narrate came after it (spec 5.3).
 */
import type { MurmurEvent } from "../events.js";
import { MAP_TOOL, NARRATE_TOOL } from "../narration.js";
import type { Trace } from "./requests.js";
import type { RequestView, TaskView } from "./types.js";

const BUG = /\b(bug|fix|error|broken|crash|fails?|failing|issue)\b/i;
const REFACTOR = /\b(refactor|rename|clean ?up|restructure|extract)\b/i;
const QUESTION = /^\s*(how|what|why|where|which|can|does|is)\b/i;

export function inferKind(prompt: string): RequestView["kind"] {
  if (BUG.test(prompt)) return "bug";
  if (REFACTOR.test(prompt)) return "refactor";
  if (prompt.trimEnd().endsWith("?") || QUESTION.test(prompt))
    return "question";
  return "feature";
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const text = (...vs: unknown[]) =>
  vs.find((v): v is string => typeof v === "string" && v !== "") ??
  (vs.find((v) => typeof v === "number") as number | undefined)?.toString();

export function applyInference(req: RequestView, events: MurmurEvent[]): void {
  if (req.kindInferred) req.kind = inferKind(req.prompt);
  if (!req.planInferred) return;
  const tasks: TaskView[] = [];
  for (const e of events) {
    if (e.hook !== "TaskCreated" && e.hook !== "TaskCompleted") continue;
    const p = e.payload;
    const t = obj(p.task);
    const id = text(p.task_id, t.id, p.id);
    if (!id) continue;
    let task = tasks.find((x) => x.id === id);
    if (!task) {
      task = {
        id,
        title:
          text(
            p.task_subject,
            p.subject,
            t.subject,
            p.title,
            p.task_description,
            p.description,
          ) ?? id,
        status: "todo",
        agents: [],
      };
      tasks.push(task);
    }
    if (e.hook === "TaskCompleted") task.status = "done";
  }
  if (!tasks.length) return;
  req.phases = [
    {
      id: "tasks",
      title: "Tasks",
      status: tasks.every((t) => t.status === "done")
        ? "done"
        : tasks.some((t) => t.status === "done")
          ? "now"
          : "todo",
      tasks,
    },
  ];
}

export const TOOL_HOOKS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
]);
// Tools that say nothing about the work keep the previous now.
export const QUIET = new Set([
  MAP_TOOL,
  NARRATE_TOOL,
  "ToolSearch",
  "TaskList",
  "TaskGet",
]);
const basename = (v: unknown) =>
  typeof v === "string" && v ? v.split("/").filter(Boolean).at(-1) : undefined;

// Plain phrases for tools whose name says nothing to a person.
const PHRASE: Record<string, string> = {
  Grep: "Searching the code",
  Glob: "Searching the code",
  Monitor: "Watching a background job",
  TaskOutput: "Watching a background job",
  BashOutput: "Watching a background job",
  TaskStop: "Stopping a background job",
  KillShell: "Stopping a background job",
  SendMessage: "Messaging a helper",
  WebSearch: "Searching the web",
  WebFetch: "Reading a web page",
  Skill: "Using a skill",
  AskUserQuestion: "Asking you a question",
  TodoWrite: "Updating the task list",
  TaskCreate: "Updating the task list",
  TaskUpdate: "Updating the task list",
  Artifact: "Publishing a page",
  ArtifactData: "Updating a page",
  NotebookEdit: "Editing a notebook",
};
const BROWSER = /chrome|playwright|browser|puppeteer/i;

/**
 * The latest tool call in plain words (spec 8: never raw): a command reads as its
 * `description`, else "Running a command"; an MCP tool as "Looking at the browser" for
 * browser servers, else "Using <server>"; the raw command or tool name stays in `detail`.
 */
function toolText(p: Record<string, unknown>): {
  text: string;
  detail?: string;
} {
  const name = String(p.tool_name);
  const input = obj(p.tool_input);
  const file = basename(input.file_path);
  const description = text(input.description);
  if ((name === "Edit" || name === "Write") && file)
    return { text: `Editing ${file}` };
  if (name === "Read" && file) return { text: `Reading ${file}` };
  if (name === "Agent" && description)
    return { text: `Starting a helper: ${description}` };
  if (name.toLowerCase() === "bash") {
    const command =
      typeof input.command === "string" ? input.command.trim() : "";
    return {
      text: description ?? "Running a command",
      ...(command ? { detail: command } : {}),
    };
  }
  const phrase = PHRASE[name];
  if (phrase) return { text: phrase, detail: name };
  const server = /^mcp__(.+?)__/.exec(name)?.[1];
  if (server) {
    if (BROWSER.test(server))
      return { text: "Looking at the browser", detail: name };
    // "plugin_claude-mem_mcp-search" is the claude-mem plugin; "claude_ai_Gmail" is Gmail.
    const plain = server
      .replace(/^plugin_([^_]+)_.*$/, "$1")
      .replace(/^claude_ai_/, "")
      .replace(/_/g, " ");
    return { text: `Using ${plain}`, detail: name };
  }
  return { text: `Using ${name}`, detail: name };
}

/** Narrated now wins only when no tool call came after the latest narrate. */
export function inferNow(
  req: RequestView,
  events: MurmurEvent[],
  trace: Trace,
): void {
  let tool = -1;
  let stop = -1;
  events.forEach((e, i) => {
    const name = e.payload.tool_name;
    if (TOOL_HOOKS.has(e.hook) && !QUIET.has(String(name))) tool = i;
    if (e.hook === "Stop") stop = i;
  });
  const last = Math.max(tool, stop);
  if (last < 0 || (trace.narrated.at(-1)?.i ?? -1) > tool) return;
  const e = events[last] as MurmurEvent;
  req.now = {
    ...(stop > tool ? { text: "Finished this request" } : toolText(e.payload)),
    why: "",
    ts: e.ts,
    inferred: true,
  };
}
