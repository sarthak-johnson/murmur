// What the lobby says of a session, from core's view of it. Pure: the summary worker runs it.
import {
  activeRequest,
  type RequestState,
  type SessionView,
} from "@murmur/core";

/**
 * Which reading a stored summary is of: one more each time core's reading of a session or
 * this summary's shape changes, so the next start reads every summary again (summary.ts).
 */
export const READING = 2;

export interface SessionSummary {
  /** The session's title, as its top bar says it (core `SessionView.title`). */
  title: string;
  requests: number;
  helpers: number;
  /** Its first request's start, else its first event's: where its Journey starts. */
  from: string;
  /** Since when Claude waits on you (core `needsYou` of a waiting request), else null. */
  waitingSince: string | null;
  /**
   * Core's state of the request the room follows (core `activeRequest`), so the lobby can
   * say "Paused" where the room does; null with no request.
   */
  state: RequestState | null;
  /** The `READING` it was read by. */
  reading: number;
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
    state: activeRequest(view.requests)?.state ?? null,
    reading: READING,
  };
}
