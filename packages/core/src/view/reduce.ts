import type { MurmurEvent } from "../events.js";
import { applyAgents } from "./agents.js";
import { applyFiles } from "./files.js";
import { applyFlags, needsYou } from "./flags.js";
import { applyPlan, cut, newRequest } from "./requests.js";
import type { AgentView, SessionView } from "./types.js";

/** The one function every screen is drawn from: raw events in, view out. */
export function reduce(events: MurmurEvent[]): SessionView {
  const sorted = sortEvents(events);
  const agents = new Map<string, AgentView>();
  const requests = splitRequests(sorted).map(({ start, rest }, i, all) => {
    const req = newRequest(start);
    const trace = applyPlan(req, rest);
    applyFiles(req, rest, trace);
    applyAgents(req, rest, trace, agents);
    applyFlags(req, rest, trace, i < all.length - 1);
    return req;
  });
  const first = sorted[0];
  return {
    sessionId: first?.sessionId ?? "",
    cwd: first?.cwd ?? "",
    title: cut(requests[0]?.prompt ?? "", 80),
    startedAt: first?.ts ?? "",
    lastEventAt: sorted.at(-1)?.ts ?? "",
    ended: sorted.some((e) => e.hook === "SessionEnd"),
    requests,
    needsYou: needsYou(sorted),
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** By ts, then id; the first copy of each id wins. */
function sortEvents(events: MurmurEvent[]): MurmurEvent[] {
  const seen = new Set<string>();
  return [...events]
    .sort((a, b) => cmp(a.ts, b.ts) || cmp(a.id, b.id))
    .filter((e) => !seen.has(e.id) && seen.add(e.id));
}

/** Each UserPromptSubmit starts a request; events before the first belong to none. */
function splitRequests(events: MurmurEvent[]) {
  const out: { start: MurmurEvent; rest: MurmurEvent[] }[] = [];
  for (const e of events) {
    if (e.hook === "UserPromptSubmit") out.push({ start: e, rest: [] });
    else out.at(-1)?.rest.push(e);
  }
  return out;
}
