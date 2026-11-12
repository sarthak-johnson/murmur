import { createHash, randomUUID } from "node:crypto";
import type { MurmurEvent } from "@murmur/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { createApp, type Deps } from "../src/app.js";
import { openDb } from "../src/db/client.js";
import { ingestTokens, users } from "../src/db/schema.js";
import { settleSummaries } from "../src/summary.js";

export const BASE = "http://localhost";

export interface TestOptions {
  now?: () => Date;
  config?: Partial<Deps["config"]>;
  github?: Deps["github"];
  clientIp?: Deps["clientIp"];
}

// One migrated PGlite per test file (booting + migrating one per test blew the 5 s timeout
// under parallel files). Each testApp() empties it; every table cascades from users.
let shared: ReturnType<typeof openDb> | undefined;
// Boot in a hook so the slow first boot is bounded by hookTimeout, not a test's timeout.
beforeAll(async () => {
  shared ??= openDb("memory://");
  await shared;
});
afterAll(async () => {
  // Summaries an ingest left waiting read the db: done before it closes.
  await settleSummaries();
  if (shared) await (await shared).close();
  shared = undefined;
});

export async function testApp(opts: TestOptions = {}) {
  shared ??= openDb("memory://");
  const { db } = await shared;
  await db.execute(sql`truncate table users cascade`);
  const close = async () => {};
  const deps: Deps = {
    db,
    now: opts.now ?? (() => new Date()),
    config: {
      baseUrl: BASE,
      devLogin: true,
      cookieSecure: false,
      ...opts.config,
    },
  };
  if (opts.github) deps.github = opts.github;
  if (opts.clientIp) deps.clientIp = opts.clientIp;
  const app = createApp(deps);
  /** Logs in through /auth/dev and returns the Cookie header value. */
  const loginAs = async (login: string): Promise<string> => {
    const res = await app.request(
      `/auth/dev?login=${encodeURIComponent(login)}`,
    );
    const set = res.headers.get("set-cookie");
    if (res.status !== 302 || !set) throw new Error(`dev login ${res.status}`);
    return set.split(";")[0] as string;
  };
  return { app, db, loginAs, close };
}

/** Headers for a cookie-authenticated mutating request from the web page. */
export const sameOrigin = (cookie: string) => ({
  Cookie: cookie,
  Origin: BASE,
  "Content-Type": "application/json",
});

/** Logs in and links a machine by writing an ingest token row directly. */
export async function linkMachine(
  t: Awaited<ReturnType<typeof testApp>>,
  login: string,
  machineName = `${login}-mbp`,
) {
  const cookie = await t.loginAs(login);
  const [user] = await t.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.login, login));
  if (!user) throw new Error("no user");
  const token = `mur_${randomUUID().replaceAll("-", "")}`;
  const machineId = randomUUID();
  await t.db.insert(ingestTokens).values({
    tokenHash: createHash("sha256").update(token).digest("hex"),
    userId: user.id,
    machineId,
    machineName,
  });
  return { cookie, token, machineId, userId: user.id };
}

let clock = Date.parse("2026-11-06T10:00:00.000Z");

/** A valid event; each call is one second after the last unless ts is given. */
export function ev(
  sessionId: string,
  hook: MurmurEvent["hook"] = "PreToolUse",
  over: Partial<MurmurEvent> = {},
): MurmurEvent {
  clock += 1000;
  return {
    id: randomUUID(),
    sessionId,
    machineId: randomUUID(),
    cwd: "/repo",
    ts: new Date(clock).toISOString(),
    hook,
    payload: {},
    ...over,
  };
}

export const ingest = (
  t: Awaited<ReturnType<typeof testApp>>,
  token: string,
  events: unknown,
) =>
  t.app.request("/api/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ events }),
  });
