import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  assumptionDecisions,
  events,
  ingestTokens,
  sessions,
  users,
  webSessions,
} from "../src/db/schema.js";
import { ev, ingest, linkMachine, sameOrigin, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  await t?.close();
  t = undefined as never;
});

const send = (cookie: string, method: string, path: string, body?: unknown) =>
  t.app.request(path, {
    method,
    headers: sameOrigin(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("settings", () => {
  it("gets and sets retentionDays", async () => {
    t = await testApp();
    const c = await t.loginAs("ann");
    expect(await (await send(c, "GET", "/api/settings")).json()).toEqual({
      retentionDays: 90,
    });
    const res = await send(c, "PUT", "/api/settings", { retentionDays: 30 });
    expect(res.status).toBe(200);
    expect(await (await send(c, "GET", "/api/settings")).json()).toEqual({
      retentionDays: 30,
    });
  });

  it.each([0, -1, 3651, 1.5, "7", null])(
    "retentionDays %s is rejected",
    async (v) => {
      t = await testApp();
      const c = await t.loginAs("ann");
      const res = await send(c, "PUT", "/api/settings", { retentionDays: v });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid" });
    },
  );

  it("requires login", async () => {
    t = await testApp();
    expect((await t.app.request("/api/settings")).status).toBe(401);
  });
});

describe("machines", () => {
  it("lists non-revoked machines newest first, and revoke kills the token", async () => {
    t = await testApp();
    const a = await linkMachine(t, "ann", "first");
    await t.db.insert(ingestTokens).values({
      tokenHash: "h2",
      userId: a.userId,
      machineId: randomUUID(),
      machineName: "second",
      createdAt: new Date(Date.now() + 1000),
    });
    const list = (await (
      await send(a.cookie, "GET", "/api/machines")
    ).json()) as {
      machines: { machineId: string; machineName: string }[];
    };
    expect(list.machines.map((m) => m.machineName)).toEqual([
      "second",
      "first",
    ]);
    expect(Object.keys(list.machines[0] as object).sort()).toEqual([
      "createdAt",
      "lastUsedAt",
      "machineId",
      "machineName",
    ]);

    expect((await ingest(t, a.token, [ev("s1")])).status).toBe(200);
    const del = await send(a.cookie, "DELETE", `/api/machines/${a.machineId}`);
    expect(del.status).toBe(200);
    expect((await ingest(t, a.token, [ev("s1")])).status).toBe(401);
    const after = (await (
      await send(a.cookie, "GET", "/api/machines")
    ).json()) as {
      machines: unknown[];
    };
    expect(after.machines).toHaveLength(1);
    expect(
      (await send(a.cookie, "DELETE", `/api/machines/${a.machineId}`)).status,
    ).toBe(404);
  });

  it("cannot revoke another user's machine", async () => {
    t = await testApp();
    const a = await linkMachine(t, "ann");
    const b = await linkMachine(t, "bob");
    expect(
      (await send(b.cookie, "DELETE", `/api/machines/${a.machineId}`)).status,
    ).toBe(404);
    expect((await ingest(t, a.token, [ev("s1")])).status).toBe(200);
  });
});

describe("account", () => {
  it("delete account removes all rows", async () => {
    t = await testApp();
    const a = await linkMachine(t, "ann");
    const b = await linkMachine(t, "bob");
    expect((await ingest(t, a.token, [ev("s1")])).status).toBe(200);
    expect((await ingest(t, b.token, [ev("s2")])).status).toBe(200);
    await t.db.insert(assumptionDecisions).values({
      userId: a.userId,
      sessionId: "s1",
      key: "k",
      decision: "accepted",
    });
    const res = await send(a.cookie, "DELETE", "/api/account");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/murmur_session=;/);
    for (const table of [
      events,
      sessions,
      ingestTokens,
      assumptionDecisions,
      webSessions,
    ]) {
      const rows = await t.db.select({ u: table.userId }).from(table);
      expect(rows.every((r) => r.u === b.userId)).toBe(true);
    }
    expect((await t.db.select().from(users)).map((u) => u.login)).toEqual([
      "bob",
    ]);
    expect(
      (await t.app.request("/api/me", { headers: { Cookie: a.cookie } }))
        .status,
    ).toBe(401);
  });
});

describe("loadConfig", () => {
  const base = { BASE_URL: "http://x" } as NodeJS.ProcessEnv;
  it("devLogin is off by default and only on for exactly 1 outside production", () => {
    expect(loadConfig(base).config.devLogin).toBe(false);
    expect(loadConfig({ ...base, MURMUR_DEV_LOGIN: "1" }).config.devLogin).toBe(
      true,
    );
    expect(
      loadConfig({ ...base, MURMUR_DEV_LOGIN: "true" }).config.devLogin,
    ).toBe(false);
    expect(
      loadConfig({ ...base, MURMUR_DEV_LOGIN: "1", NODE_ENV: "production" })
        .config.devLogin,
    ).toBe(false);
  });
  it("parses trustProxy, cookieSecure, port and base url", () => {
    expect(loadConfig(base).config.trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "1" }).config.trustProxy).toBe(
      true,
    );
    expect(loadConfig(base).config.cookieSecure).toBe(false);
    expect(
      loadConfig({ BASE_URL: "https://m.example" }).config.cookieSecure,
    ).toBe(true);
    expect(loadConfig({}).port).toBe(8787);
    expect(loadConfig({ PORT: "9000" }).config.baseUrl).toBe(
      "http://localhost:9000",
    );
  });
  it("requires BASE_URL in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/BASE_URL/);
  });
});
