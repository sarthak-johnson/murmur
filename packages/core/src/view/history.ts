/*
 * A request with no valid map call (`planInferred`) still tells its story, from its events.
 * Runs after every request is reduced, so helpers that stop later are seen.
 * - Helpers: each Agent PreToolUse is a run. Runs whose description names the same task
 *   or item id (`Task 12`, `Tasks 13-14`, `B7`, `bug B1`; case and `bug` ignored) share
 *   one part; runs with no id get a part each. The title is the first non-review run's
 *   description without its work verb. Each run is a step labelled by its verb.
 * - Run status: failed on a PostToolUseFailure of its call; done when its subagent
 *   stopped, its call returned (not launched in the background), or the request is
 *   finished and the subagent did nothing after it; else running. A part is `now` while
 *   a run runs, else `done`; its task is `failed` when its last run failed.
 * - Files: Edit and Write inside a run's subagent go to its part, even after the next
 *   prompt. Main-thread ones group by the folder of their display path; a one-file folder
 *   joins its nearest folder with a part; the 6 biggest folders become parts. Root files,
 *   the rest, and touches of subagents with no run stay in `looseFiles`.
 * - Parts are in start order; a part changing a file an earlier one changed links to it
 *   with "same files". With no TaskCreated plan, one "What Claude did" phase lists them.
 */
import type { MurmurEvent } from "../events.js";
import { addTouch, displayPath, touchOf } from "./files.js";
import { addOnce } from "./requests.js";
import type {
  AgentView,
  FileTouch,
  PartView,
  RequestView,
  StepView,
  TaskView,
} from "./types.js";

const MAX_FOLDERS = 6;
const ID = /\b(?:tasks?\s+(\d+(?:\s*[-–]\s*\d+)?)|(?:bug\s+)?([a-z]\d+))\b/i;
const VERB =
  /^(implement|build|draft|write|fix|add|research|investigate|re-?review|review)\b\s*/i;
const REVIEW = /^(re-?)?review\b/i;
const LABEL: Record<string, string> = {
  implement: "Built",
  build: "Built",
  review: "Reviewed",
  "re-review": "Re-reviewed",
  rereview: "Re-reviewed",
  fix: "Fixed",
  draft: "Drafted",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const isTool = (e: MurmurEvent, hook: string, name: string) =>
  e.hook === hook && e.payload.tool_name === name;
const describe = (e: MurmurEvent) =>
  str(obj(e.payload.tool_input).description).trim();

function subject(description: string): string | undefined {
  const m = ID.exec(description);
  if (!m) return undefined;
  return m[1]
    ? `task:${m[1].replace(/\s*[-–]\s*/, "-")}`
    : `item:${(m[2] as string).toUpperCase()}`;
}

function titleOf(description: string): string {
  const t = description.replace(VERB, "") || description || "A helper";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface Built {
  part: PartView;
  start: string;
  lastFailed: boolean;
  /** The title came from a run that was not a review. */
  titled: boolean;
}

export function inferHistory(
  reqs: RequestView[],
  events: MurmurEvent[][],
  agents: Map<string, AgentView>,
  started: Map<string, string>,
): void {
  const all = events.flat();
  const lastSeen = new Map<string, number>();
  events.forEach((list, i) => {
    for (const e of list) {
      const id = str(e.payload.agent_id);
      if (id) lastSeen.set(id, i);
    }
  });
  const failed = new Set<string>();
  const returned = new Set<string>();
  for (const e of all) {
    const use = str(e.payload.tool_use_id);
    if (isTool(e, "PostToolUseFailure", "Agent")) failed.add(use);
    const res = obj(e.payload.tool_response);
    if (
      isTool(e, "PostToolUse", "Agent") &&
      res.isAsync !== true &&
      res.status !== "async_launched"
    )
      returned.add(use);
  }

  // Pass 1: helper parts, and which part owns each subagent.
  const owner = new Map<string, PartView>();
  const built = reqs.map((req, i) => {
    const out = new Map<string, Built>();
    if (!req.planInferred) return out;
    for (const e of events[i] ?? []) {
      if (!isTool(e, "PreToolUse", "Agent")) continue;
      const use = str(e.payload.tool_use_id);
      const description = describe(e);
      const id = subject(description) ?? `run:${use || e.id}`;
      const agentId = started.get(use);
      const agent = agentId ? agents.get(agentId) : undefined;
      const status: StepView["status"] = failed.has(use)
        ? "failed"
        : agent?.status === "done" ||
            returned.has(use) ||
            (req.finished && (lastSeen.get(agentId ?? "") ?? -1) <= i)
          ? "done"
          : "running";
      // A helper judged finished reads done everywhere (map chips, helper lists).
      if (status !== "running" && agent?.status === "running")
        agent.status = "done";
      const review = REVIEW.test(description);
      let b = out.get(id);
      if (!b) {
        b = {
          part: newPart(id, description),
          start: e.ts,
          lastFailed: false,
          titled: !review,
        };
        out.set(id, b);
      } else if (!b.titled && !review) {
        b.part.title = titleOf(description);
        b.titled = true;
      }
      const verb = VERB.exec(description)?.[1]?.toLowerCase() ?? "";
      b.part.steps.push({
        ts: e.ts,
        text: LABEL[verb] ?? description,
        status,
        ...(agentId ? { agentId } : {}),
        eventIds: [e.id],
      });
      b.lastFailed = status === "failed";
      if (agentId) {
        addOnce(b.part.agents, agentId);
        owner.set(agentId, b.part);
      }
    }
    return out;
  });

  // Pass 2: every touch to its helper's part, else to its own request.
  const main = reqs.map(() => [] as { touch: FileTouch; ts: string }[]);
  for (const req of reqs) if (req.planInferred) req.looseFiles = [];
  events.forEach((list, j) => {
    const req = reqs[j] as RequestView;
    for (const e of list) {
      const t = touchOf(e);
      if (!t) continue;
      const agentId = str(e.payload.agent_id);
      const part = owner.get(agentId);
      if (part) addTouch(part.files, t);
      else if (!req.planInferred) continue;
      else if (agentId) addTouch(req.looseFiles, t);
      else main[j]?.push({ touch: t, ts: e.ts });
    }
  });

  // Pass 3: folder parts, order, links and plan.
  reqs.forEach((req, i) => {
    if (!req.planInferred) return;
    const helpers = [...(built[i]?.values() ?? [])];
    for (const b of helpers) {
      b.part.status = b.part.steps.some((s) => s.status === "running")
        ? "now"
        : "done";
    }
    const cwd = events[i]?.[0]?.cwd ?? "";
    const folders = folderParts(main[i] ?? [], cwd, req.looseFiles);
    const parts = [...helpers, ...folders].sort(byStart);
    req.parts = parts.map((b) => b.part);
    req.parts.forEach((b, k) => {
      const paths = new Set(b.files.map((f) => f.path));
      for (const a of req.parts.slice(0, k))
        if (a.files.some((f) => paths.has(f.path)))
          b.links.push({ to: a.id, label: "same files" });
    });
    if (req.phases.length || !parts.length) return;
    const tasks: TaskView[] = parts.map(({ part, lastFailed }) => ({
      id: part.id,
      title: part.title,
      part: part.id,
      status: lastFailed ? "failed" : part.status,
      agents: [],
    }));
    req.phases = [
      {
        id: "did",
        title: "What Claude did",
        status: tasks.some((t) => t.status === "now" || t.status === "failed")
          ? "now"
          : tasks.every((t) => t.status === "done")
            ? "done"
            : "todo",
        tasks,
      },
    ];
  });

  reqs.forEach((req, i) => {
    const list = events[i] ?? [];
    const count = (name: string) =>
      list.filter((e) => isTool(e, "PreToolUse", name)).length;
    const paths = new Set(
      [...req.parts.flatMap((p) => p.files), ...req.looseFiles].map(
        (f) => f.path,
      ),
    );
    req.tally = {
      helpers: count("Agent"),
      files: paths.size,
      commands: count("Bash"),
    };
  });
}

function newPart(id: string, description: string): PartView {
  return {
    id,
    title: titleOf(description),
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
}

const byStart = (a: { start: string }, b: { start: string }) =>
  a.start < b.start ? -1 : a.start > b.start ? 1 : 0;

const OWN_FILES = /(^|\/)\.claude\//;
const parent = (folder: string) =>
  folder.slice(0, Math.max(0, folder.lastIndexOf("/")));

/** Main-thread touches as folder parts; what does not fit goes to `loose`. */
function folderParts(
  touches: { touch: FileTouch; ts: string }[],
  cwd: string,
  loose: FileTouch[],
): Built[] {
  const groups = new Map<string, { files: FileTouch[]; start: string }>();
  for (const { touch, ts } of touches) {
    const folder = parent(displayPath(touch.path, cwd));
    // Claude's own memory and plans outside the project are not the work itself.
    const own = OWN_FILES.test(touch.path) && !touch.path.startsWith(`${cwd}/`);
    if (!folder || own) {
      addTouch(loose, touch);
      continue;
    }
    const g = groups.get(folder) ?? { files: [], start: ts };
    groups.set(folder, g);
    addTouch(g.files, touch);
  }
  const depth = (f: string) => f.split("/").length;
  for (const folder of [...groups.keys()].sort((a, b) => depth(b) - depth(a))) {
    const g = groups.get(folder);
    if (g?.files.length !== 1) continue;
    let up = parent(folder);
    while (up && !groups.has(up)) up = parent(up);
    const into = groups.get(up);
    if (!into) continue;
    for (const f of g.files) addTouch(into.files, f);
    if (g.start < into.start) into.start = g.start;
    groups.delete(folder);
  }
  const ranked = [...groups.entries()].sort(
    ([, a], [, b]) => b.files.length - a.files.length || byStart(a, b),
  );
  for (const [, g] of ranked.slice(MAX_FOLDERS))
    for (const f of g.files) addTouch(loose, f);
  return ranked.slice(0, MAX_FOLDERS).map(([folder, g]) => ({
    part: {
      ...newPart(`dir:${folder}`, folder),
      title: folder,
      status: "done",
      files: g.files,
    },
    start: g.start,
    lastFailed: false,
    titled: true,
  }));
}
