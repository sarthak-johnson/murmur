import type { MurmurEvent } from "../events.js";
import { applyAgents } from "./agents.js";
import { applyFiles } from "./files.js";
import { applyFlags, needsYou } from "./flags.js";
import { inferHistory, quiet } from "./history.js";
import { applyInference, inferNow } from "./infer.js";
import { journeyOf, storylines } from "./journey.js";
import { applyPlan, newRequest, type Trace } from "./requests.js";
import { applyRounds } from "./rounds.js";
import { applyShape } from "./shape.js";
import { fallbackTitle, isReply, isTitles, titlesOf } from "./titles.js";
import type { AgentView, RequestView, SessionView } from "./types.js";
import { applyWords } from "./words.js";

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
    applyFiles(req, rest, trace);
    for (const [use, id] of applyAgents(req, rest, trace, agents))
      started.set(use, id);
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
  // needsYou is cleared by every prompt, so it belongs to the last request begun before it.
  const asking = needs
    ? requests.findLastIndex((r) => r.startedAt <= needs.since)
    : -1;
  requests.forEach((req, i) => {
    applyShape(req, lists[i] ?? [], traces[i] as Trace, {
      later: i < requests.length - 1,
      waiting: i === asking,
      live,
      title: titles.requests.get(req.id),
    });
  });
  // The request this one picks up from: the titles run's word, else a reply follows the
  // request before it.
  requests.forEach((req, i) => {
    const t = titles.requests.get(req.id);
    const before = requests.slice(0, i);
    if (t?.follows && before.some((r) => r.id === t.follows))
      req.follows = t.follows;
    else if (!t && i > 0 && isReply(req.prompt))
      req.follows = (before[i - 1] as RequestView).id;
  });
  const { chapters, threads } = storylines(requests, lists, titles);
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

/**
 * Prompts that are not a person asking for work: /murmur:on and the like switch
 * Murmur itself, and Claude Code submits a `<task-notification>` when a background
 * helper finishes.
 */
export const isNotRequest = (prompt: unknown): boolean =>
  typeof prompt === "string" &&
  /^\s*(\/murmur:\w+(\s|$)|<task-notification>)/.test(prompt);

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
