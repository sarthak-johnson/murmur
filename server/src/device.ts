import { randomInt, randomUUID } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { and, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Deps } from "./app.js";
import { type AppEnv, randomToken, readBody, sha256 } from "./auth.js";
import { deviceCodes, ingestTokens } from "./db/schema.js";
import { fixedWindow, ipBucket } from "./ratelimit.js";

const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
const EXPIRES_IN = 600;
const INTERVAL = 3;

/** 8 characters, stored without the dash. */
const newUserCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  );
const display = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

const TEN_MINUTES = 10 * 60 * 1000;
const rateLimited = (c: Context) => c.json({ error: "rate_limited" }, 429);

function defaultClientIp(trustProxy: boolean) {
  return (c: Context): string | undefined => {
    if (trustProxy) {
      // The rightmost entry is the one the trusted proxy appended; earlier ones are client-sent.
      const last = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
      if (last) return last;
    }
    try {
      return getConnInfo(c).remote.address;
    } catch {
      return undefined; // no Node socket, e.g. app.request in tests
    }
  };
}

export function deviceRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { db, now, config } = deps;
  const ipOf = deps.clientIp ?? defaultClientIp(config.trustProxy ?? false);
  // Unknown IPs share one bucket, so missing addresses fail closed.
  const ip = (c: Context) => {
    const addr = ipOf(c);
    return `ip:${addr ? ipBucket(addr) : "unknown"}`;
  };
  const startsPerIp = fixedWindow(20, TEN_MINUTES);
  const failedApprovesPerUser = fixedWindow(10, TEN_MINUTES);
  const failedApprovesPerIp = fixedWindow(30, TEN_MINUTES);

  // Called by the plugin CLI: no cookie, no Origin.
  app.post("/api/device/start", async (c) => {
    const key = ip(c);
    if (startsPerIp.blocked(key, now())) return rateLimited(c);
    startsPerIp.hit(key, now());
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

  // Failed code lookups (info and approve) share one limit per user and per IP.
  // Each attempt takes a hit up front and a success gives it back.
  const attempt = (c: Context<AppEnv>) => {
    const userKey = `user:${c.get("user").id}`;
    const ipKey = ip(c);
    const t = now();
    if (
      failedApprovesPerUser.blocked(userKey, t) ||
      failedApprovesPerIp.blocked(ipKey, t)
    )
      return null;
    failedApprovesPerUser.hit(userKey, t);
    failedApprovesPerIp.hit(ipKey, t);
    return () => {
      failedApprovesPerUser.refund(userKey, t);
      failedApprovesPerIp.refund(ipKey, t);
    };
  };
  const live = (userCode: string, t: Date) =>
    and(
      eq(deviceCodes.userCode, userCode.replace(/[-\s]/g, "").toUpperCase()),
      isNull(deviceCodes.approvedAt),
      gt(deviceCodes.expiresAt, t),
    );

  // Cookie route: names the machine a code belongs to, so the page can show it before approving.
  app.get("/api/device/info", async (c) => {
    const ok = attempt(c);
    if (!ok) return rateLimited(c);
    const [row] = await db
      .select({ machineName: deviceCodes.machineName })
      .from(deviceCodes)
      .where(live(c.req.query("code") ?? "", now()));
    if (!row) return c.json({ error: "not_found" }, 404);
    ok();
    return c.json(row);
  });

  // Cookie route: the guard in app.ts has already run requireSameOrigin and requireUser.
  app.post("/api/device/approve", async (c) => {
    const user = c.get("user");
    const ok = attempt(c);
    if (!ok) return rateLimited(c);
    const t = now();
    const raw = (await readBody(c))?.userCode;
    if (typeof raw !== "string") return c.json({ error: "not_found" }, 404);
    const [row] = await db
      .update(deviceCodes)
      .set({ userId: user.id, approvedAt: t })
      .where(live(raw, t))
      .returning({ machineName: deviceCodes.machineName });
    if (!row) return c.json({ error: "not_found" }, 404);
    ok();
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
