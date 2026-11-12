/*
 * A request with no valid map call (`planInferred`) still tells its story, from its events.
 * Runs after every request is reduced, so helpers that stop later are seen.
 * - Helpers: each Agent PreToolUse is a run. Runs whose description names the same task
 *   or bug id (`Task 12`, `Tasks 13-14`, `Task 18a`, `B7`, `bug B1`, `bug 1`; case and `bug` ignored)
 *   share one part; runs with no id get a part each. The title is the first non-review
 *   run's description without its work verb. Each run is a step labelled by its verb.
 * - Run status: failed on a PostToolUseFailure of its call; done when its subagent
 *   stopped, its call returned (not launched in the background), or its request is
 *   finished and the subagent is over: a SessionEnd came after its last event, or it
 *   was quiet for over 10 minutes before the session's latest event; else running.
 *   Both only ever turn true as events arrive, so a run never flips back. A part is
 *   `now` while a run runs, else `done`; its task is `failed` when its last run failed.
 * - Files: Edit, Write and Bash file changes (`touchesOf`) inside a run's subagent go to its part, even after the next
 *   prompt. Main-thread ones group by the folder of their display path (from the cwd of
 *   the request's prompt, the first event of its list); a one-file folder
 *   joins its nearest folder with a part; the 6 biggest folders become parts. Root files,
 *   the rest, and touches of subagents with no run stay in `looseFiles`.
 * - Parts are in start order; a part changing a file an earlier one changed links to it
 *   with "same files". With no TaskCreated plan, one "What Claude did" phase lists the
 *   helper parts, each task holding its part's helpers; a folder part is no task, and a
 *   request with only folders has no plan. Every helper's `part` is the part that owns it.
 */
import type { MurmurEvent } from "../events.js";
import { addTouch, displayPath, touchesOf } from "./files.js";
import { addOnce, phaseStatus } from "./requests.js";
import { itemOf } from "./rounds.js";
import type {
  AgentView,
  FileTouch,
  PartView,
  RequestView,
  StepView,
  TaskView,
} from "./types.js";

const MAX_FOLDERS = 6;
const VERB =
  /^(implement|build|draft|write|fix|add|research|investigate|re-?review|review)\b[\s:]*/i;
const QUIET_MS = 600_000; // 10 minutes
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

/** A run's part id from the task or bug its description names: `task:12`, `task:13-14`, `item:B7`. */
function subject(description: string): string | undefined {
  const id = itemOf(description);
  if (!id) return undefined;
  return id.startsWith("B")
    ? `item:${id}`
    : `task:${id.replace(/^Tasks? /, "")}`;
}

/**
 * When each helper was last heard from, and `over(since)`: a SessionEnd came after
 * `since`, or it was over 10 minutes before the session's latest event.
 */
export function quiet(all: MurmurEvent[]) {
  const lastAt = new Map<string, string>(); // agent id -> ts of its latest event
  for (const e of all) {
    const id = str(e.payload.agent_id);
    if (id) lastAt.set(id, e.ts);
  }
  const latest = Date.parse(all.at(-1)?.ts ?? "");
  const endAt = all.findLast((e) => e.hook === "SessionEnd")?.ts ?? "";
  const over = (since: string) =>
    endAt > since || latest - Date.parse(since) > QUIET_MS;
  return { lastAt, over };
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
  const { lastAt, over } = quiet(all);
  const failed = new Set<string>();
  const returned = new Set<string>();
  for (const e of all) {
    const use = str(e.payload.tool_use_id);
    if (!use) continue;
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
      const agentId = started.get(use || e.id);
      const agent = agentId ? agents.get(agentId) : undefined;
      const status: StepView["status"] = failed.has(use)
        ? "failed"
        : agent?.status === "done" ||
            returned.has(use) ||
            (req.finished && over(lastAt.get(agentId ?? "") ?? e.ts))
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
        if (agent && !agent.part) agent.part = b.part.id; // as on a planned request
      }
    }
    return out;
  });

  // Pass 2: every touch to its helper's part, else to its own request.
  const main = reqs.map(() => [] as { touch: FileTouch; ts: string }[]);
  for (const req of reqs) if (req.planInferred) req.looseFiles = [];
  events.forEach((list, j) => {
    const req = reqs[j] as RequestView;
    for (const e of list)
      for (const t of touchesOf(e)) {
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
    // A folder is where files changed, not work to do: it stays a part, never a task.
    if (req.phases.length || !helpers.length) return;
    const tasks: TaskView[] = helpers
      .sort(byStart)
      .map(({ part, lastFailed }) => ({
        id: part.id,
        title: part.title,
        part: part.id,
        status: lastFailed ? "failed" : part.status,
        agents: [...part.agents], // its helpers, as `TaskView.agents` says
      }));
    req.phases = [
      {
        id: "did",
        title: "What Claude did",
        status: phaseStatus(tasks),
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
    const activity = {
      reads: 0,
      searches: 0,
      edits: 0,
      commands: 0,
      web: 0,
      tools: 0,
    };
    for (const e of list) {
      if (e.hook !== "PreToolUse") continue;
      const kind = ACTIVITY[str(e.payload.tool_name) ?? ""];
      if (kind) activity[kind]++;
      else if (
        /^mcp__(?!plugin_murmur_murmur__)/.test(str(e.payload.tool_name) ?? "")
      )
        activity.tools++;
    }
    req.activity = activity;
  });
}

// Each tool call by kind, for `RequestView.activity`; MCP tools other than Murmur's count as tools.
const ACTIVITY: Record<
  string,
  "reads" | "searches" | "edits" | "commands" | "web"
> = {
  Read: "reads",
  Grep: "searches",
  Glob: "searches",
  Edit: "edits",
  Write: "edits",
  NotebookEdit: "edits",
  Bash: "commands",
  WebFetch: "web",
  WebSearch: "web",
};

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
    // `touch.path` is relative inside the project, so only an absolute (or `~`) path can be.
    const own = /^[/~]/.test(touch.path) && OWN_FILES.test(touch.path);
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
