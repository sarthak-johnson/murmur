/*
 * What the lobby and the session switcher say of a session, read from core's view of it,
 * so they name and count it as its own page does: its title (Claude's, else its first
 * prompt that is not a reply), its requests and helpers, when its first request began, and
 * whether it waits on you. Kept on the session row; read again a little after an ingest
 * changed it, and at server start for any left stale.
 */
import { type MurmurEvent, reduce, type SessionView } from "@murmur/core";
import { and, asc, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
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
 * Reads one session's summary again when an ingest changed it since the last read, and
 * stores it with the `changedAt` it read. An ingest during the read leaves it stale for
 * the next one; a slower, older read never overwrites a newer one.
 */
async function refreshSummary(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<void> {
  const own = and(
    eq(sessions.userId, userId),
    eq(sessions.sessionId, sessionId),
  );
  const [s] = await db
    .select({
      cwd: sessions.cwd,
      machineId: sessions.machineId,
      changedAt: sessions.changedAt,
      summaryOf: sessions.summaryOf,
    })
    .from(sessions)
    .where(own);
  if (!s || s.summaryOf?.getTime() === s.changedAt.getTime()) return;
  const list = await eventsOf(db, userId, sessionId, s);
  if (!list.length) return;
  await db
    .update(sessions)
    .set({ summary: summarize(reduce(list)), summaryOf: s.changedAt })
    .where(
      and(
        own,
        or(isNull(sessions.summaryOf), lt(sessions.summaryOf, s.changedAt)),
      ),
    );
}

/** After an ingest, a session's summary is read this long later: a burst reads once. */
const SOON_MS = 5000;
const key = (userId: string, sessionId: string) => `${userId} ${sessionId}`;
/** Reads waiting out their delay, by session, each with what runs it. */
const soon = new Map<string, { timer: NodeJS.Timeout; go: () => void }>();
/** The read under way per session: the next one waits for it, so one runs at a time. */
const running = new Map<string, Promise<void>>();

function run(db: Db, userId: string, sessionId: string): Promise<void> {
  const k = key(userId, sessionId);
  const p: Promise<void> = (running.get(k) ?? Promise.resolve())
    .then(() => refreshSummary(db, userId, sessionId))
    .catch((e) => console.error("summary:", e))
    .finally(() => {
      if (running.get(k) === p) running.delete(k);
    });
  running.set(k, p);
  return p;
}

/**
 * Reads a session's summary again a little after an ingest, off the request path: GET
 * /api/sessions only reads what is stored, a few seconds stale at most.
 */
// ponytail: each read reduces the whole session (~0.5 s at 30k events), at most one per
// SOON_MS while it is live; fold new events into a stored view if that ever shows.
export function summarizeSoon(db: Db, userId: string, sessionId: string): void {
  const k = key(userId, sessionId);
  if (soon.has(k)) return;
  const go = () => {
    soon.delete(k);
    void run(db, userId, sessionId);
  };
  const timer = setTimeout(go, SOON_MS);
  timer.unref();
  soon.set(k, { timer, go });
}

/** Runs the reads still waiting now and resolves once none is under way (for tests). */
export async function settleSummaries(): Promise<void> {
  for (const { timer, go } of [...soon.values()]) {
    clearTimeout(timer);
    go();
  }
  while (running.size) await Promise.all([...running.values()]);
}

/**
 * Every session whose summary is missing or older than its last ingest, read again one at
 * a time: at server start, in the background, so the first lobby after it reads them.
 */
export async function backfillSummaries(db: Db): Promise<void> {
  const stale = await db
    .select({ userId: sessions.userId, sessionId: sessions.sessionId })
    .from(sessions)
    .where(
      or(
        isNull(sessions.summaryOf),
        ne(sessions.summaryOf, sessions.changedAt),
      ),
    )
    .orderBy(desc(sessions.lastEventAt));
  for (const s of stale) await run(db, s.userId, s.sessionId);
}
