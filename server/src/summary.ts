/*
 * What the lobby and the session switcher say of a session, read from core's view of it,
 * so they name and count it as its own page does (summarize.ts). Kept on the session row
 * with the `version` it was read at; read again a little after an ingest stored events of
 * it, and at server start for any left stale. The read pages the session's events and the
 * reduce runs in a worker thread, so neither holds up the server.
 */
import { Worker } from "node:worker_threads";
import type { MurmurEvent } from "@murmur/core";
import { and, asc, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { events, sessions } from "./db/schema.js";
import { READING, type SessionSummary } from "./summarize.js";

export type { SessionSummary } from "./summarize.js";

/** A stored summary read by an older `READING`: stale whatever its version. */
const oldReading = sql`(${sessions.summary}->>'reading') is distinct from ${String(READING)}`;

/** Events read per query. */
const PAGE = 2000;

/** Reduces a session's events, page by page, to its summary. */
export type Summarizer = (
  pages: AsyncIterable<MurmurEvent[]>,
) => Promise<SessionSummary | null>;

/** Every event of a session in GET /events order, a page at a time by (ts, id). */
async function* pagesOf(
  db: Db,
  userId: string,
  sessionId: string,
  s: { cwd: string; machineId: string },
): AsyncGenerator<MurmurEvent[]> {
  let after: { ts: Date; id: string } | undefined;
  for (;;) {
    const rows = await db
      .select({
        id: events.id,
        ts: events.ts,
        hook: events.hook,
        payload: events.payload,
      })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.sessionId, sessionId),
          after &&
            or(
              gt(events.ts, after.ts),
              and(eq(events.ts, after.ts), gt(events.id, after.id)),
            ),
        ),
      )
      .orderBy(asc(events.ts), asc(events.id))
      .limit(PAGE);
    if (rows.length) {
      yield rows.map((r) => ({
        id: r.id,
        sessionId,
        machineId: s.machineId,
        cwd: s.cwd,
        ts: r.ts.toISOString(),
        hook: r.hook as MurmurEvent["hook"],
        payload: r.payload as MurmurEvent["payload"],
      }));
    }
    const last = rows.at(-1);
    if (!last || rows.length < PAGE) return;
    after = { ts: last.ts, id: last.id };
  }
}

/** The one worker, started on first use; it does not keep the process alive. */
let worker: Worker | undefined;
const waiting = new Map<
  number,
  { ok: (s: SessionSummary | null) => void; fail: (e: Error) => void }
>();
let nextId = 0;

function theWorker(): Worker {
  if (worker) return worker;
  // tsx, as the server runs: the worker and core are TypeScript.
  const w = new Worker(new URL("./summary-worker.ts", import.meta.url), {
    execArgv: ["--import", import.meta.resolve("tsx")],
  });
  w.unref();
  const lost = (e: Error) => {
    if (worker === w) worker = undefined;
    for (const p of waiting.values()) p.fail(e);
    waiting.clear();
  };
  w.on(
    "message",
    (m: { id: number; summary?: SessionSummary | null; error?: string }) => {
      const p = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error === undefined) p?.ok(m.summary ?? null);
      else p?.fail(new Error(m.error));
    },
  );
  w.on("error", lost);
  w.on("exit", (code) => lost(new Error(`summary worker exited ${code}`)));
  worker = w;
  return w;
}

/** Reduces a session in the worker (exported for tests). */
export const summarizeInWorker: Summarizer = async (pages) => {
  const id = nextId++;
  const w = theWorker();
  const done = new Promise<SessionSummary | null>((ok, fail) =>
    waiting.set(id, { ok, fail }),
  );
  // A worker lost while the pages load rejects `done` before it is returned: handled
  // here, or Node exits on the unhandled rejection; the caller still sees it below.
  done.catch(() => {});
  try {
    for await (const events of pages) {
      // Lost already: stop reading the session, `done` has failed.
      if (!waiting.has(id)) return done;
      w.postMessage({ id, events });
    }
    w.postMessage({ id, end: true });
  } catch (e) {
    waiting.delete(id);
    w.postMessage({ id, end: true, drop: true });
    throw e;
  }
  return done;
};

let summarizer: Summarizer = summarizeInWorker;
/** Swaps what reduces a session (for tests); returns the way back. */
export function useSummarizer(s: Summarizer): () => void {
  summarizer = s;
  return () => {
    summarizer = summarizeInWorker;
  };
}

/**
 * Reads one session's summary again when an ingest stored events of it since the last
 * read, and stores it with the `version` it read at. An ingest during the read leaves it
 * stale for the next one; a slower, older read never overwrites a newer one.
 */
export async function refreshSummary(
  db: Db,
  userId: string,
  sessionId: string,
  read: Summarizer = summarizer,
): Promise<void> {
  const own = and(
    eq(sessions.userId, userId),
    eq(sessions.sessionId, sessionId),
  );
  const [s] = await db
    .select({
      cwd: sessions.cwd,
      machineId: sessions.machineId,
      version: sessions.version,
      summaryOfVersion: sessions.summaryOfVersion,
      oldReading: sql<boolean>`${oldReading}`,
    })
    .from(sessions)
    .where(own);
  if (!s || (s.summaryOfVersion === s.version && !s.oldReading)) return;
  const summary = await read(pagesOf(db, userId, sessionId, s));
  if (!summary) return;
  await db
    .update(sessions)
    .set({ summary, summaryOfVersion: s.version })
    .where(
      and(
        own,
        or(
          isNull(sessions.summaryOfVersion),
          lt(sessions.summaryOfVersion, s.version),
          and(eq(sessions.summaryOfVersion, s.version), oldReading),
        ),
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
 * Reads a session's summary again a little after an ingest stored events of it, off the
 * request path: GET /api/sessions only reads what is stored, a few seconds stale at most.
 */
// ponytail: each read reduces the whole session, at most one per SOON_MS while it is
// live; fold new events into a stored view if that ever shows.
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
 * At shutdown, before the database closes: drops the reads still waiting, lets the ones
 * under way finish and stops the worker. A dropped read is read at the next start.
 */
export async function stopSummaries(): Promise<void> {
  for (const { timer } of soon.values()) clearTimeout(timer);
  soon.clear();
  while (running.size) await Promise.all([...running.values()]);
  await worker?.terminate();
}

/**
 * Every session whose summary is missing, older than its last ingest or of an older
 * `READING`, read again one at a time: at server start, in the background, so the first lobby after it reads them.
 */
export async function backfillSummaries(db: Db): Promise<void> {
  const stale = await db
    .select({ userId: sessions.userId, sessionId: sessions.sessionId })
    .from(sessions)
    .where(
      or(
        isNull(sessions.summaryOfVersion),
        ne(sessions.summaryOfVersion, sessions.version),
        oldReading,
      ),
    )
    .orderBy(desc(sessions.lastEventAt));
  if (!stale.length) return;
  console.log(`summaries: reading ${stale.length} stale`);
  for (const s of stale) await run(db, s.userId, s.sessionId);
  console.log(`summaries: read ${stale.length}`);
}
