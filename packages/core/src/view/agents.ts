/*
 * Subagents, from SubagentStart / SubagentStop matched by `agent_id`.
 * - Description and prompt come from the parent's `Agent` call. The link is the Agent
 *   PostToolUse `tool_response.agentId`; until that arrives (it comes after the subagent
 *   stops), a start takes the oldest unclaimed Agent PreToolUse of the same
 *   `subagent_type`, else the oldest unclaimed one.
 * - Part: the latest part the subagent narrated, else the part it joined at its start.
 *   It joins, so it shows there unnarrated: the task and part of the subject its
 *   description names ("Review Task 38"); else of the one task its words match (shared
 *   words, then shared numbers: "Build scenes 1, 2, 4" on "Scenes 1-4"; tasks tied on one
 *   part give that part alone; tied on several, none); else of the one part they match;
 *   else the task and part current at its start, unless Claude's latest narrate said that
 *   task was done or blocked, or it names another subject. Else it stands on its own.
 * - Its latest tool call is what it is doing (`doing`, in plain words as the now line).
 * - A SubagentStop with no earlier start is ignored (Claude Code's prompt-suggestion
 *   generator fires one with an empty `agent_type` after every interactive Stop).
 * - `known` spans requests, so a background subagent stopping later still closes.
 * Returns each claimed Agent call's key (`tool_use_id`, else its event id) with the
 * subagent it started.
 */
import type { MurmurEvent } from "../events.js";
import { QUIET, TOOL_HOOKS, toolText } from "./infer.js";
import { addOnce, type Trace } from "./requests.js";
import { itemOf, subjectOfWork } from "./rounds.js";
import type { AgentView, PartView, RequestView, TaskView } from "./types.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export function applyAgents(
  req: RequestView,
  events: MurmurEvent[],
  { before, narrated }: Trace,
  known: Map<string, AgentView>,
): Map<string, string> {
  const isAgent = (e: MurmurEvent) => e.payload.tool_name === "Agent";
  const calls = events.filter((e) => e.hook === "PreToolUse" && isAgent(e));
  // An empty tool_use_id names no call, so a call without one is keyed by its event.
  const key = (c: MurmurEvent) => str(c.payload.tool_use_id) || c.id;
  const linked = new Map<string, string>(); // agentId -> tool_use_id
  for (const e of events)
    if (e.hook === "PostToolUse" && isAgent(e)) {
      const id = str(obj(e.payload.tool_response).agentId);
      const use = str(e.payload.tool_use_id);
      if (id && use) linked.set(id, use);
    }
  const claimed = new Set(linked.values());
  const started = new Map<string, string>(); // call key -> agentId
  events.forEach((e, i) => {
    const id = str(e.payload.agent_id);
    if (e.hook === "SubagentStart" && id && !known.has(id)) {
      const type = str(e.payload.agent_type);
      const free = calls.filter((c) => !claimed.has(key(c)));
      const call =
        calls.find((c) => key(c) === linked.get(id)) ??
        free.find(
          (c) => str(obj(c.payload.tool_input).subagent_type) === type,
        ) ??
        free[0];
      if (call) {
        claimed.add(key(call));
        started.set(key(call), id);
      }
      const input = obj(call?.payload.tool_input);
      // Claude's latest word that a task is done or waits on the user moves it off it.
      const said = narrated.findLast((x) => x.i < i)?.n.taskStatus;
      const on = said === "done" || said === "blocked" ? undefined : before[i];
      const { task, at } = tiesOf(req, str(input.description), on);
      const part =
        narrated.findLast((x) => x.part && x.e.payload.agent_id === id)?.part ??
        at?.id;
      const agent: AgentView = {
        id,
        type,
        description: str(input.description),
        prompt: str(input.prompt),
        ...(part ? { part } : {}),
        status: "running",
        startedAt: e.ts,
      };
      known.set(id, agent);
      req.agents.push(agent);
      if (task) addOnce(task.agents, id);
      if (at) addOnce(at.agents, id);
    }
    const agent = known.get(id);
    if (agent && TOOL_HOOKS.has(e.hook) && !QUIET.has(str(e.payload.tool_name)))
      agent.doing = { text: toolText(e.payload).text, ts: e.ts };
    if (e.hook === "SubagentStop" && agent) {
      agent.status = "done";
      agent.endedAt = e.ts;
      const text = str(e.payload.last_assistant_message);
      if (text) agent.lastText = text;
    }
  });
  return started;
}

// Words that say what kind of work, or nothing: they never tie a helper to a task.
const PLAIN = new Set(
  "build implement write add draft create make port fix review rereview recheck check research investigate explore find audit plan update run test the and for with from into that this its all new more".split(
    " ",
  ),
);
const wordsOf = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[a-z]{3,}/g) ?? [])
      .map((w) => w.replace(/s$/, ""))
      .filter((w) => !PLAIN.has(w)),
  );
/** The numbers a title names, a range ("1-4") as every number in it. */
function numbersOf(s: string): Set<number> {
  const out = new Set<number>();
  for (const m of s.matchAll(/(\d+)\s*[-–]\s*(\d+)|\d+/g)) {
    const [a, b] = [Number(m[1] ?? m[0]), Number(m[2] ?? m[0])];
    for (let k = a; k <= b && k - a < 50; k++) out.add(k);
    out.add(a);
  }
  return out;
}

/**
 * The one item whose title best matches the words Claude gave a helper: shared words
 * (one at least), then shared numbers ("scenes 1, 2, 4" on "Scenes 1-4"). Unset when
 * none shares a word, or two match equally.
 */
function byWords<T extends { title: string }>(
  description: string,
  items: T[],
): { best?: T | undefined; tied: T[] } {
  const words = wordsOf(description);
  const nums = numbersOf(description);
  const score = (title: string) => {
    const own = wordsOf(title);
    const shared = [...words].filter((w) => own.has(w)).length;
    const n = numbersOf(title);
    return shared ? shared + [...nums].filter((x) => n.has(x)).length : 0;
  };
  const scores = items.map((it) => score(it.title));
  const top = Math.max(0, ...scores);
  const tied = top ? items.filter((_, i) => scores[i] === top) : [];
  return tied.length === 1 ? { best: tied[0], tied } : { tied };
}

/**
 * The task and part a new subagent helps with: those of the task its description names,
 * else of the one task its words match (`byWords`; of tasks tied on one part, that part),
 * else of the one part they match, else whatever Claude was on when it spawned, unless
 * that names another task.
 */
function tiesOf(
  req: RequestView,
  description: string,
  on: { task?: string | undefined; part?: string | undefined } | undefined,
): { task?: TaskView | undefined; at?: PartView | undefined } {
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  const named = itemOf(description);
  if (!named) {
    const { best, tied } = byWords(description, tasks);
    const parts = new Set(tied.map((t) => t.part));
    const shared = parts.size === 1 ? [...parts][0] : undefined;
    const part =
      req.parts.find((p) => p.id === (best?.part ?? shared)) ??
      (tied.length ? undefined : byWords(description, req.parts).best);
    if (best || part) return { task: best, at: part };
    if (tied.length) return {};
  }
  // A range ("Tasks 13-14") may hold a lone task, so only two lone tasks can differ.
  const lone = (s: string | undefined) =>
    !!s && /^(?:Task \d+[a-z]?|B\d+)$/.test(s);
  const other = (s: string | undefined) =>
    lone(named) && lone(s) && s !== named;
  const mine = named
    ? tasks.find((t) => subjectOfWork(req, t) === named)
    : undefined;
  const task =
    mine ??
    tasks.find((t) => t.id === on?.task && !other(subjectOfWork(req, t)));
  const at =
    (named &&
      (req.parts.find((p) => subjectOfWork(req, undefined, p) === named) ??
        req.parts.find((p) => p.id === mine?.part))) ||
    req.parts.find(
      (p) => p.id === on?.part && !other(subjectOfWork(req, undefined, p)),
    );
  return { task, at };
}
