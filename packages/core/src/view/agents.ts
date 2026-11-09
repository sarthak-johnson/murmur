/*
 * Subagents, from SubagentStart / SubagentStop matched by `agent_id`.
 * - Description and prompt come from the parent's `Agent` call. The link is the Agent
 *   PostToolUse `tool_response.agentId`; until that arrives (it comes after the subagent
 *   stops), a start takes the oldest unclaimed Agent PreToolUse of the same
 *   `subagent_type`, else the oldest unclaimed one.
 * - Part: the latest part the subagent narrated, else the part current at its start.
 *   It also joins the task and part current at its start, so it shows there unnarrated.
 *   A subagent whose description names a task ("Review Task 38") joins the task and part
 *   of that subject instead, and never one of another subject Claude happened to be on.
 * - A SubagentStop with no earlier start is ignored (Claude Code's prompt-suggestion
 *   generator fires one with an empty `agent_type` after every interactive Stop).
 * - `known` spans requests, so a background subagent stopping later still closes.
 * Returns each claimed Agent call's key (`tool_use_id`, else its event id) with the
 * subagent it started.
 */
import type { MurmurEvent } from "../events.js";
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
      const { task, at } = tiesOf(req, str(input.description), before[i]);
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
    if (e.hook === "SubagentStop" && agent) {
      agent.status = "done";
      agent.endedAt = e.ts;
      const text = str(e.payload.last_assistant_message);
      if (text) agent.lastText = text;
    }
  });
  return started;
}

/**
 * The task and part a new subagent helps with: those of the task its description names,
 * else whatever Claude was on when it spawned, unless that names another task.
 */
function tiesOf(
  req: RequestView,
  description: string,
  on: { task?: string | undefined; part?: string | undefined } | undefined,
): { task?: TaskView | undefined; at?: PartView | undefined } {
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  const named = itemOf(description);
  // A range ("Tasks 13-14") may hold the named task, so only a lone other task is another.
  const other = (s: string | undefined) =>
    !!named && !!s && s !== named && /^(?:Task \d+[a-z]?|B\d+)$/.test(s);
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
