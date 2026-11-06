import { and, desc, eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Deps } from "./app.js";
import { type AppEnv, readBody } from "./auth.js";
import { ingestTokens, users } from "./db/schema.js";
import { notFound, UUID } from "./sessions.js";

// Cookie routes: the guard in app.ts has already run requireSameOrigin and requireUser.
export function accountRoutes(app: Hono<AppEnv>, { db, now }: Deps) {
  app.get("/api/settings", (c) =>
    c.json({ retentionDays: c.get("user").retentionDays }),
  );

  app.put("/api/settings", async (c) => {
    const days = (await readBody(c))?.retentionDays;
    if (
      !Number.isInteger(days) ||
      (days as number) < 1 ||
      (days as number) > 3650
    )
      return c.json({ error: "invalid" }, 400);
    await db
      .update(users)
      .set({ retentionDays: days as number })
      .where(eq(users.id, c.get("user").id));
    return c.json({ retentionDays: days });
  });

  app.get("/api/machines", async (c) => {
    const rows = await db
      .select({
        machineId: ingestTokens.machineId,
        machineName: ingestTokens.machineName,
        createdAt: ingestTokens.createdAt,
        lastUsedAt: ingestTokens.lastUsedAt,
      })
      .from(ingestTokens)
      .where(
        and(
          eq(ingestTokens.userId, c.get("user").id),
          isNull(ingestTokens.revokedAt),
        ),
      )
      .orderBy(desc(ingestTokens.createdAt));
    return c.json({ machines: rows });
  });

  app.delete("/api/machines/:machineId", async (c) => {
    const machineId = c.req.param("machineId");
    if (!UUID.test(machineId)) return notFound(c);
    const done = await db
      .update(ingestTokens)
      .set({ revokedAt: now() })
      .where(
        and(
          eq(ingestTokens.userId, c.get("user").id),
          eq(ingestTokens.machineId, machineId),
          isNull(ingestTokens.revokedAt),
        ),
      )
      .returning({ h: ingestTokens.tokenHash });
    if (done.length === 0) return notFound(c);
    return c.json({ ok: true });
  });

  // Children (sessions, events, tokens, logins) cascade from the user row.
  app.delete("/api/account", async (c) => {
    await db.delete(users).where(eq(users.id, c.get("user").id));
    deleteCookie(c, "murmur_session", { path: "/" });
    return c.json({ ok: true });
  });
}
