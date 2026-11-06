/*
 * Fallbacks for a request with no valid map call: kind from the prompt, and one
 * `Tasks` phase from TaskCreated / TaskCompleted (field names unverified, read tolerantly).
 * A request with a map keeps everything from the map path.
 */
import type { MurmurEvent } from "../events.js";
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
        title: text(p.subject, t.subject, p.title, p.description) ?? id,
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
