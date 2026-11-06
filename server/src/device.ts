import { randomInt, randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import type { Hono } from "hono";
import type { Deps } from "./app.js";
import { type AppEnv, randomToken, readBody, sha256 } from "./auth.js";
import { deviceCodes, ingestTokens } from "./db/schema.js";

const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
const EXPIRES_IN = 600;
const INTERVAL = 3;

/** 8 characters, stored without the dash. */
const newUserCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  );
const display = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function deviceRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { db, now, config } = deps;

  // Called by the plugin CLI: no cookie, no Origin.
  app.post("/api/device/start", async (c) => {
    const machineName = (await readBody(c))?.machineName;
    if (
      typeof machineName !== "string" ||
      !machineName.trim() ||
      machineName.length > 255
    )
      return c.json({ error: "bad_request" }, 400);
    const t = now();
    await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, t));
    const deviceCode = randomToken();
    // Retry on the rare user-code collision with a live code.
    for (let i = 0; i < 5; i++) {
      const userCode = newUserCode();
      const inserted = await db
        .insert(deviceCodes)
        .values({
          deviceCodeHash: sha256(deviceCode),
          userCode,
          machineName: machineName.trim(),
          expiresAt: new Date(t.getTime() + EXPIRES_IN * 1000),
        })
        .onConflictDoNothing({ target: deviceCodes.userCode })
        .returning({ userCode: deviceCodes.userCode });
      if (inserted.length) {
        const shown = display(userCode);
        return c.json({
          deviceCode,
          userCode: shown,
          verifyUrl: `${config.baseUrl}/device?code=${shown}`,
          interval: INTERVAL,
          expiresIn: EXPIRES_IN,
        });
      }
    }
    throw new Error("could not allocate a user code");
  });

  // Cookie route: the guard in app.ts has already run requireSameOrigin and requireUser.
  app.post("/api/device/approve", async (c) => {
    const raw = (await readBody(c))?.userCode;
    if (typeof raw !== "string") return c.json({ error: "not_found" }, 404);
    const userCode = raw.replace(/[-\s]/g, "").toUpperCase();
    const [row] = await db
      .update(deviceCodes)
      .set({ userId: c.get("user").id, approvedAt: now() })
      .where(
        and(
          eq(deviceCodes.userCode, userCode),
          isNull(deviceCodes.approvedAt),
          gt(deviceCodes.expiresAt, now()),
        ),
      )
      .returning({ machineName: deviceCodes.machineName });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ machineName: row.machineName });
  });

  // Called by the plugin CLI: no cookie, no Origin. Hands out the token exactly once.
  app.post("/api/device/poll", async (c) => {
    const deviceCode = (await readBody(c))?.deviceCode;
    if (typeof deviceCode !== "string")
      return c.json({ error: "bad_request" }, 400);
    const hash = eq(deviceCodes.deviceCodeHash, sha256(deviceCode));
    const t = now();
    const result = await db.transaction(async (tx) => {
      const [approved] = await tx
        .update(deviceCodes)
        .set({ consumedAt: t })
        .where(
          and(
            hash,
            isNotNull(deviceCodes.approvedAt),
            isNull(deviceCodes.consumedAt),
            gt(deviceCodes.expiresAt, t),
          ),
        )
        .returning({
          userId: deviceCodes.userId,
          machineName: deviceCodes.machineName,
        });
      if (approved?.userId) {
        const token = `mur_${randomToken()}`;
        const machineId = randomUUID();
        await tx.insert(ingestTokens).values({
          tokenHash: sha256(token),
          userId: approved.userId,
          machineId,
          machineName: approved.machineName,
        });
        return { token, machineId };
      }
      const [pending] = await tx
        .select({ h: deviceCodes.deviceCodeHash })
        .from(deviceCodes)
        .where(
          and(
            hash,
            isNull(deviceCodes.approvedAt),
            gt(deviceCodes.expiresAt, t),
          ),
        );
      return pending ? "pending" : "expired";
    });
    if (result === "pending") return c.json({ status: "pending" }, 428);
    if (result === "expired") return c.json({ status: "expired" }, 410);
    return c.json(result);
  });
}
