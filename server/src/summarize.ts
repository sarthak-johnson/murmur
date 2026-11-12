// What the lobby says of a session, from core's view of it. Pure: the summary worker runs it.
import type { SessionView } from "@murmur/core";

export interface SessionSummary {
  /** The session's title, as its top bar says it (core `SessionView.title`). */
  title: string;
  requests: number;
  helpers: number;
  /** Its first request's start, else its first event's: where its Journey starts. */
  from: string;
  /** Since when Claude waits on you (core `needsYou` of a waiting request), else null. */
  waitingSince: string | null;
}

export function summarize(view: SessionView): SessionSummary {
  // The request core reads as waiting, as the room and the rail read it (web waitingOn).
  const waits = view.requests.some((r) => r.state === "waiting");
  return {
    title: view.title,
    requests: view.requests.length,
    helpers: view.requests.reduce((n, r) => n + r.tally.helpers, 0),
    from: view.requests[0]?.startedAt ?? view.startedAt,
    waitingSince: waits ? (view.needsYou?.since ?? null) : null,
  };
}
