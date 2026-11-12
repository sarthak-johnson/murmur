import type { MurmurEvent } from "../events.js";
import { applyAgents } from "./agents.js";
import { applyFiles } from "./files.js";
import { applyFlags, needsYou } from "./flags.js";
import { inferHistory, quiet } from "./history.js";
import { applyInference, inferNow } from "./infer.js";
import { journeyOf, storylines } from "./journey.js";
import { applyPlan, isNotRequest, newRequest, type Trace } from "./requests.js";
import { applyRounds } from "./rounds.js";
import { applyShape } from "./shape.js";
import {
  fallbackTitle,
  isReply,
  isTitles,
  requestKeys,
  titlesOf,
} from "./titles.js";
import type { AgentView, RequestView, SessionView } from "./types.js";
import { applyWords } from "./words.js";

/**
 * A folder of changes Murmur grouped (an inferred plan's "dir:" part) is no task Claude
 * finished: it is under way while its request runs, and done once the request is.
 */
function underWay(req: RequestView) {
  if (!req.planInferred || req.state !== "running") return;
  const folder = (id: string | undefined) => !!id?.startsWith("dir:");
  for (const p of req.parts)
    if (folder(p.id) && p.status === "done") p.status = "now";
  for (const ph of req.phases) {
    for (const t of ph.tasks)
      if (folder(t.part) && t.status === "done") t.status = "now";
    if (ph.tasks.some((t) => t.status === "now")) ph.status = "now";
  }
}

/** The one function every screen is drawn from: raw events in, view out. */
export function reduce(events: MurmurEvent[]): SessionView {
  // A titles run's answer is Murmur's word on the session, never part of it.
  const every = sortEvents(events);
  const titles = titlesOf(every.filter(isTitles));
  const sorted = every.filter((e) => !isTitles(e));
  const agents = new Map<string, AgentView>();
  const started = new Map<string, string>();
  const ended = sorted.some((e) => e.hook === "SessionEnd");
  const split = splitRequests(sorted);
  const traces: Trace[] = [];
  const requests = split.map(({ start, rest }, i, all) => {
    const req = newRequest(start);
    const trace = applyPlan(req, rest);
    traces.push(trace);
    applyInference(req, rest);
    inferNow(req, rest, trace);
    // Helpers first: a helper's file changes go to the part it is tied to.
    for (const [use, id] of applyAgents(req, rest, trace, agents))
      started.set(use, id);
    applyFiles(req, rest, trace, agents);
    applyFlags(req, rest, trace, i < all.length - 1);
    // A resumed session goes on after its SessionEnd, so only a last one counts.
    req.finished = i < all.length - 1 || rest.at(-1)?.hook === "SessionEnd";
    return req;
  });
  const lists = split.map((s) => [s.start, ...s.rest]);
  inferHistory(requests, lists, agents, started);
  applyWords(requests, lists, agents, started);
  applyRounds(requests, agents, lists);
  const needs = needsYou(sorted);
  const { lastAt, over } = quiet(sorted);
  const live = (a: AgentView) =>
    a.status === "running" && !over(lastAt.get(a.id) ?? a.startedAt);
  // What the titles runs said of each request, found by its key.
  const keys = requestKeys(split.map((s) => s.start));
  const said = keys.map((k) => titles.requests.get(k));
  const idOf = new Map(keys.map((k, i) => [k, requests[i]?.id]));
  // needsYou is cleared by every prompt, so it belongs to the last request begun before it.
  const asking = needs
    ? requests.findLastIndex((r) => r.startedAt <= needs.since)
    : -1;
  requests.forEach((req, i) => {
    applyShape(req, lists[i] ?? [], traces[i] as Trace, {
      later: i < requests.length - 1,
      waiting: i === asking,
      live,
      title: said[i],
    });
    underWay(req);
  });
  // The request this one picks up from: the titles run's word, else a reply follows the
  // request before it.
  requests.forEach((req, i) => {
    const t = said[i];
    const follows = t?.follows === undefined ? undefined : idOf.get(t.follows);
    const before = requests.slice(0, i);
    if (follows && before.some((r) => r.id === follows)) req.follows = follows;
    else if (!t && i > 0 && isReply(req.prompt))
      req.follows = (before[i - 1] as RequestView).id;
  });
  const { chapters, threads } = storylines(
    requests,
    lists,
    said,
    titles.threads,
  );
  const first = sorted[0];
  return {
    sessionId: first?.sessionId ?? "",
    cwd: first?.cwd ?? "",
    // Claude's name from a titles run, else the first prompt that is not a reply.
    title: titles.session ?? fallbackTitle(requests.map((r) => r.prompt)),
    ...(titles.session ? { titledBy: "claude" as const } : {}),
    startedAt: first?.ts ?? "",
    lastEventAt: sorted.at(-1)?.ts ?? "",
    ended,
    requests,
    needsYou: needs,
    journey: journeyOf(requests, lists, chapters),
    threads,
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

export { isNotRequest };

/**
 * Each UserPromptSubmit starts a request, except `isNotRequest` ones, whose events
 * stay with the request before; events before the first belong to none.
 */
function splitRequests(events: MurmurEvent[]) {
  const out: { start: MurmurEvent; rest: MurmurEvent[] }[] = [];
  for (const e of events) {
    if (e.hook === "UserPromptSubmit" && !isNotRequest(e.payload.prompt))
      out.push({ start: e, rest: [] });
    else out.at(-1)?.rest.push(e);
  }
  return out;
}
