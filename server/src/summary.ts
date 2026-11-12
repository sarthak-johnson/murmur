/*
 * What the lobby and the session switcher say of a session, read from core's view of it,
 * so they name and count it as its own page does: its title (Claude's, else its first
 * prompt that is not a reply), its requests and helpers, when its first request began, and
 * whether it waits on you. Kept on the session row; read again when an ingest changed it.
 */
import { type MurmurEvent, reduce, type SessionView } from "@murmur/core";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { events, sessions } from "./db/schema.js";

export interface SessionSummary {
  /** The session's title, as its top bar says it (core `SessionView.title`). */
  title: string;
  requests: number;
  helpers: number;
  /** Its first request's start, else its first event's: where its Journey starts. */
  from: string;
  /** Since when Claude waits on you (a request of it is "waiting"); null when it does not. */
  waitingSince: string | null;
}

export function summarize(view: SessionView): SessionSummary {
  const waits = view.requests.some((r) => r.state === "waiting");
  return {
    title: view.title,
    requests: view.requests.length,
    helpers: view.requests.reduce((n, r) => n + r.tally.helpers, 0),
    from: view.requests[0]?.startedAt ?? view.startedAt,
    waitingSince: waits ? (view.needsYou?.since ?? view.lastEventAt) : null,
  };
}

/** Every event of a session, as GET /events returns them. */
async function eventsOf(
  db: Db,
  userId: string,
  sessionId: string,
  s: { cwd: string; machineId: string },
): Promise<MurmurEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      ts: events.ts,
      hook: events.hook,
      payload: events.payload,
    })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.sessionId, sessionId)))
    .orderBy(asc(events.ts), asc(events.id));
  return rows.map((r) => ({
    id: r.id,
    sessionId,
    machineId: s.machineId,
    cwd: s.cwd,
    ts: r.ts.toISOString(),
    hook: r.hook as MurmurEvent["hook"],
    payload: r.payload as MurmurEvent["payload"],
  }));
}

/**
 * The user's sessions whose summary is missing or older than their last ingest, read
 * again and stored. An ingest during the read leaves it stale for the next one.
 */
// ponytail: read on demand, one session at a time; a live session that changed since the
// last list pays one reduce (~0.5 s at 30k events). Warm it after ingest, debounced, if
// the list gets slow.
export async function refreshSummaries(db: Db, userId: string): Promise<void> {
  const stale = await db
    .select({
      sessionId: sessions.sessionId,
      cwd: sessions.cwd,
      machineId: sessions.machineId,
      changedAt: sessions.changedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        or(
          isNull(sessions.summaryOf),
          ne(sessions.summaryOf, sessions.changedAt),
        ),
      ),
    );
  for (const s of stale) {
    const list = await eventsOf(db, userId, s.sessionId, s);
    if (!list.length) continue;
    await db
      .update(sessions)
      .set({ summary: summarize(reduce(list)), summaryOf: s.changedAt })
      .where(
        and(eq(sessions.userId, userId), eq(sessions.sessionId, s.sessionId)),
      );
  }
}
