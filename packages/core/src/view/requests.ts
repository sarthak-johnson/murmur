/*
 * Plan and part status rules, applied once after every event of a request:
 * - Task: narrate `taskStatus` running -> now, done -> done, failed -> failed.
 *   A task with no status yet is `now` only when the latest narrate names it, else `todo`.
 * - Part: `now` if any of its tasks is now; else `done` if it has tasks and all are done,
 *   or a step on it is done and no later step is running; else `now` if the latest narrate
 *   names it; otherwise `todo`. (The latest narrate never overrides `done`.)
 * - Phase: `now` if any task in it is now or failed; `done` if it has tasks and all are done; else `todo`.
 * A narrate naming a task but no part lands on that task's part.
 * A repeated `map` takes the new order and titles, keeps the detail of ids seen before, and drops vanished ids.
 */
import type { MurmurEvent } from "../events.js";
import {
  MAP_TOOL,
  MapInput,
  NARRATE_TOOL,
  NarrateInput,
} from "../narration.js";
import type { PartView, RequestView, TaskView } from "./types.js";

export const cut = (s: string, n: number) => s.slice(0, n);

const TASK_STATUS = { running: "now", done: "done", failed: "failed" } as const;

/** The part and task the latest narrate resolved to. */
export interface Named {
  part: string | undefined;
  task: string | undefined;
}

/** A valid narrate call, at index `i` of the request's events. */
export interface Narrated extends Named {
  i: number;
  e: MurmurEvent;
  n: NarrateInput;
}

/** What later passes need: `before[i]` is the latest narrate before event `i`. */
export interface Trace {
  before: Named[];
  narrated: Narrated[];
}

/** A path as shown: relative to `cwd` when inside it, no leading `./`. */
export const relPath = (path: string, cwd: string) =>
  path.startsWith(`${cwd}/`)
    ? path.slice(cwd.length + 1)
    : path.replace(/^\.\//, "");

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function newRequest(start: MurmurEvent): RequestView {
  const p = start.payload.prompt;
  const prompt = typeof p === "string" ? p : "";
  return {
    id: start.id,
    prompt,
    startedAt: start.ts,
    kind: "feature",
    kindInferred: true,
    goal: cut(prompt, 80),
    phases: [],
    planInferred: true,
    parts: [],
    looseFiles: [],
    now: null,
    agents: [],
    assumptions: [],
    flags: [],
  };
}

const input = (e: MurmurEvent, tool: string) =>
  e.hook === "PostToolUse" && e.payload.tool_name === tool
    ? e.payload.tool_input
    : undefined;

/** Applies every map and narrate call in `events`, then sets statuses. */
export function applyPlan(req: RequestView, events: MurmurEvent[]): Trace {
  let last: Named = { part: undefined, task: undefined };
  const trace: Trace = { before: [], narrated: [] };
  events.forEach((e, i) => {
    trace.before.push(last);
    const map = MapInput.safeParse(input(e, MAP_TOOL));
    if (map.success) applyMap(req, map.data);
    const note = NarrateInput.safeParse(input(e, NARRATE_TOOL));
    if (note.success) {
      last = applyNarrate(req, e, note.data);
      trace.narrated.push({ ...last, i, e, n: note.data });
    }
  });
  setStatuses(req, last);
  return trace;
}

function applyMap(req: RequestView, map: MapInput): void {
  const oldParts = new Map(req.parts.map((p) => [p.id, p]));
  const oldTasks = new Map(
    req.phases.flatMap((ph) => ph.tasks).map((t) => [t.id, t]),
  );
  req.kind = map.kind;
  req.kindInferred = false;
  req.goal = map.goal;
  req.planInferred = false;
  req.phases = map.phases.map((ph) => ({
    id: ph.id,
    title: ph.title,
    status: "todo",
    tasks: ph.tasks.map((t) => {
      const task: TaskView = oldTasks.get(t.id) ?? {
        id: t.id,
        title: t.title,
        status: "todo",
        agents: [],
      };
      task.title = t.title;
      delete task.part;
      if (t.part !== undefined) task.part = t.part;
      return task;
    }),
  }));
  req.parts = map.parts.map((p) => {
    const part: PartView = oldParts.get(p.id) ?? {
      id: p.id,
      title: p.title,
      status: "todo",
      links: [],
      steps: [],
      files: [],
      choices: [],
      checks: [],
      words: [],
      agents: [],
      failures: 0,
    };
    part.title = p.title;
    part.links = p.links ?? [];
    delete part.phase;
    delete part.tag;
    if (p.phase !== undefined) part.phase = p.phase;
    if (p.tag !== undefined) part.tag = p.tag;
    return part;
  });
}

function applyNarrate(
  req: RequestView,
  e: MurmurEvent,
  n: NarrateInput,
): Named {
  const task = req.phases
    .flatMap((ph) => ph.tasks)
    .find((t) => t.id === n.task);
  // No part named: fall back to the named task's part.
  const partId = n.part ?? task?.part;
  const part = req.parts.find((p) => p.id === partId);
  // Set when a subagent calls narrate itself.
  const agentId = str(e.payload.agent_id);
  req.now = { text: n.now, why: n.why, ts: e.ts };
  if (part) req.now.part = part.id;
  if (task && n.taskStatus) task.status = TASK_STATUS[n.taskStatus];
  if (task && agentId) addOnce(task.agents, agentId);
  if (part) {
    if (n.step)
      part.steps.push({
        ts: e.ts,
        ...n.step,
        ...(agentId ? { agentId } : {}),
        eventIds: [e.id],
      });
    if (agentId) addOnce(part.agents, agentId);
    if (n.aim) part.aim = n.aim;
    if (n.io) part.io = n.io;
    // Role-only until files.ts merges a real touch in; dropped if none comes.
    for (const f of n.files ?? []) {
      const path = relPath(f.path, e.cwd);
      const file = part.files.find((x) => x.path === path);
      if (file) file.role = f.role;
      else
        part.files.push({
          path,
          role: f.role,
          added: 0,
          removed: 0,
          isNew: false,
          eventIds: [],
        });
    }
    upsert(part.choices, n.choices, (c) => c.choice);
    upsert(part.checks, n.checks, (c) => c.check);
    upsert(part.words, n.words, (w) => w.term);
  }
  return { part: part?.id, task: task?.id };
}

const addOnce = (list: string[], id: string) =>
  list.includes(id) || list.push(id);

function upsert<T>(list: T[], items: T[] | undefined, key: (x: T) => string) {
  for (const item of items ?? []) {
    const i = list.findIndex((x) => key(x) === key(item));
    if (i < 0) list.push(item);
    else list[i] = item;
  }
}

function setStatuses(req: RequestView, last: Named): void {
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  for (const t of tasks) {
    if (t.status === "todo" && t.id === last.task) t.status = "now";
  }
  const allDone = (ts: TaskView[]) =>
    ts.length > 0 && ts.every((t) => t.status === "done");
  for (const p of req.parts) {
    const own = tasks.filter((t) => t.part === p.id);
    const done = p.steps.findLastIndex((s) => s.status === "done");
    const stepDone =
      done >= 0 && !p.steps.slice(done).some((s) => s.status === "running");
    p.status = own.some((t) => t.status === "now")
      ? "now"
      : allDone(own) || stepDone
        ? "done"
        : p.id === last.part
          ? "now"
          : "todo";
  }
  for (const ph of req.phases) {
    ph.status = ph.tasks.some(
      (t) => t.status === "now" || t.status === "failed",
    )
      ? "now"
      : allDone(ph.tasks)
        ? "done"
        : "todo";
  }
}
