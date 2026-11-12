import type { MurmurEvent } from "@murmur/core";
import { and, asc, desc, eq, gt, type SQL, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Deps } from "./app.js";
import { type AppEnv, readBody } from "./auth.js";
import type { Db } from "./db/client.js";
import { assumptionDecisions, events, sessions } from "./db/schema.js";

export const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PAGE = 5000;

export const notFound = (c: Context) => c.json({ error: "not_found" }, 404);
const badRequest = (c: Context) => c.json({ error: "bad_request" }, 400);

/** The user's session row, or undefined: another user's session id looks the same as a missing one. */
export async function ownSession(db: Db, userId: string, sessionId: string) {
  const [row] = await db
    .select({ cwd: sessions.cwd, machineId: sessions.machineId })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.sessionId, sessionId)));
  return row;
}

// Cookie routes: the guard in app.ts has already run requireSameOrigin and requireUser.
export function sessionRoutes(app: Hono<AppEnv>, { db, now }: Deps) {
  app.get("/api/sessions", async (c) => {
    // Written out with table names: drizzle renders columns in sql`` unqualified, so
    // `user_id = user_id` compared the token with itself and named any user's machine.
    const machineName = sql<string | null>`(
      select t.machine_name from ingest_tokens t
      where t.user_id = sessions.user_id
        and t.machine_id = sessions.machine_id
        and t.revoked_at is null
      order by t.created_at desc limit 1)`;
    const rows = await db
      .select({
        sessionId: sessions.sessionId,
        cwd: sessions.cwd,
        title: sessions.title,
        machineName,
        startedAt: sessions.startedAt,
        lastEventAt: sessions.lastEventAt,
        ended: sessions.ended,
        // Each session named and counted as its own page reads it, as last stored (summary.ts).
        summary: sessions.summary,
      })
      .from(sessions)
      .where(eq(sessions.userId, c.get("user").id))
      .orderBy(desc(sessions.lastEventAt), asc(sessions.sessionId));
    return c.json({ sessions: rows });
  });

  // Ordered by (ts, id). after + afterId: strictly after that pair; after alone: ts > after.
  app.get("/api/sessions/:id/events", async (c) => {
    const userId = c.get("user").id;
    const id = c.req.param("id");
    const after = c.req.query("after");
    const afterId = c.req.query("afterId");
    if (
      (after !== undefined && Number.isNaN(Date.parse(after))) ||
      (afterId !== undefined && (after === undefined || !UUID.test(afterId)))
    )
      return badRequest(c);
    const s = await ownSession(db, userId, id);
    if (!s) return notFound(c);
    const where: SQL[] = [eq(events.userId, userId), eq(events.sessionId, id)];
    if (after !== undefined) {
      const ts = new Date(after);
      where.push(
        afterId === undefined
          ? gt(events.ts, ts)
          : sql`(${events.ts}, ${events.id}) > (${ts.toISOString()}::timestamptz, ${afterId}::uuid)`,
      );
    }
    const rows = await db
      .select({
        id: events.id,
        ts: events.ts,
        hook: events.hook,
        payload: events.payload,
      })
      .from(events)
      .where(and(...where))
      .orderBy(asc(events.ts), asc(events.id))
      .limit(PAGE + 1);
    // Events carry the session's machine and cwd; the events table does not store them per row.
    const out = rows.slice(0, PAGE).map(
      (r): MurmurEvent => ({
        id: r.id,
        sessionId: id,
        machineId: s.machineId,
        cwd: s.cwd,
        ts: r.ts.toISOString(),
        hook: r.hook as MurmurEvent["hook"],
        payload: r.payload as MurmurEvent["payload"],
      }),
    );
    return c.json({ events: out, hasMore: rows.length > PAGE });
  });

  app.get("/api/sessions/:id/assumptions", async (c) => {
    const userId = c.get("user").id;
    const id = c.req.param("id");
    if (!(await ownSession(db, userId, id))) return notFound(c);
    const decisions = await db
      .select({
        key: assumptionDecisions.key,
        decision: assumptionDecisions.decision,
      })
      .from(assumptionDecisions)
      .where(
        and(
          eq(assumptionDecisions.userId, userId),
          eq(assumptionDecisions.sessionId, id),
        ),
      );
    return c.json({ decisions });
  });

  app.put("/api/sessions/:id/assumptions", async (c) => {
    const userId = c.get("user").id;
    const id = c.req.param("id");
    const body = await readBody(c);
    const key = body?.key;
    const decision = body?.decision;
    if (
      typeof key !== "string" ||
      !key ||
      key.length > 1000 ||
      (decision !== "accepted" && decision !== "rejected")
    )
      return badRequest(c);
    if (!(await ownSession(db, userId, id))) return notFound(c);
    const decidedAt = now();
    await db
      .insert(assumptionDecisions)
      .values({ userId, sessionId: id, key, decision, decidedAt })
      .onConflictDoUpdate({
        target: [
          assumptionDecisions.userId,
          assumptionDecisions.sessionId,
          assumptionDecisions.key,
        ],
        set: { decision, decidedAt },
      });
    return c.json({ key, decision });
  });

  app.delete("/api/sessions/:id", async (c) => {
    const userId = c.get("user").id;
    const id = c.req.param("id");
    // Session row first: its row lock queues behind an in-flight ingest's upsert, so that
    // ingest's events are committed (and visible) before the events delete below runs.
    const deleted = await db.transaction(async (tx) => {
      const gone = await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.sessionId, id)))
        .returning({ sessionId: sessions.sessionId });
      await tx
        .delete(events)
        .where(and(eq(events.userId, userId), eq(events.sessionId, id)));
      await tx
        .delete(assumptionDecisions)
        .where(
          and(
            eq(assumptionDecisions.userId, userId),
            eq(assumptionDecisions.sessionId, id),
          ),
        );
      return gone;
    });
    if (!deleted.length) return notFound(c);
    return c.json({ ok: true });
  });
}
