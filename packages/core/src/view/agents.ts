/*
 * Subagents, from SubagentStart / SubagentStop matched by `agent_id`.
 * - Description and prompt come from the parent's `Agent` call. The link is the Agent
 *   PostToolUse `tool_response.agentId`; until that arrives (it comes after the subagent
 *   stops), a start takes the oldest unclaimed Agent PreToolUse of the same
 *   `subagent_type`, else the oldest unclaimed one.
 * - Part: the latest part the subagent narrated, else the part current at its start.
 *   It also joins the task and part current at its start, so it shows there unnarrated.
 * - A SubagentStop with no earlier start is ignored (Claude Code's prompt-suggestion
 *   generator fires one with an empty `agent_type` after every interactive Stop).
 * - `known` spans requests, so a background subagent stopping later still closes.
 */
import type { MurmurEvent } from "../events.js";
import { addOnce, type Trace } from "./requests.js";
import type { AgentView, RequestView } from "./types.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export function applyAgents(
  req: RequestView,
  events: MurmurEvent[],
  { before, narrated }: Trace,
  known: Map<string, AgentView>,
): void {
  const isAgent = (e: MurmurEvent) => e.payload.tool_name === "Agent";
  const calls = events.filter((e) => e.hook === "PreToolUse" && isAgent(e));
  const linked = new Map<string, string>(); // agentId -> tool_use_id
  for (const e of events)
    if (e.hook === "PostToolUse" && isAgent(e)) {
      const id = str(obj(e.payload.tool_response).agentId);
      if (id) linked.set(id, str(e.payload.tool_use_id));
    }
  const claimed = new Set(linked.values());
  events.forEach((e, i) => {
    const id = str(e.payload.agent_id);
    if (e.hook === "SubagentStart" && id && !known.has(id)) {
      const type = str(e.payload.agent_type);
      const free = calls.filter(
        (c) => !claimed.has(str(c.payload.tool_use_id)),
      );
      const call =
        calls.find((c) => str(c.payload.tool_use_id) === linked.get(id)) ??
        free.find(
          (c) => str(obj(c.payload.tool_input).subagent_type) === type,
        ) ??
        free[0];
      if (call) claimed.add(str(call.payload.tool_use_id));
      const input = obj(call?.payload.tool_input);
      const part =
        narrated.findLast((x) => x.part && x.e.payload.agent_id === id)?.part ??
        before[i]?.part;
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
      // It helps with whatever Claude was on when it spawned, even if it never narrates.
      const task = req.phases
        .flatMap((ph) => ph.tasks)
        .find((t) => t.id === before[i]?.task);
      if (task) addOnce(task.agents, id);
      const at = req.parts.find((p) => p.id === before[i]?.part);
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
}
