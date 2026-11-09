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
  const prod = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://db",
    BASE_URL: "https://m.example",
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
  };
  it("devLogin is off by default and only on for exactly 1 outside production", () => {
    expect(loadConfig(base).config.devLogin).toBe(false);
    expect(loadConfig({ ...base, MURMUR_DEV_LOGIN: "1" }).config.devLogin).toBe(
      true,
    );
    expect(
      loadConfig({ ...base, MURMUR_DEV_LOGIN: "true" }).config.devLogin,
    ).toBe(false);
    expect(loadConfig({ ...prod, MURMUR_DEV_LOGIN: "1" }).config.devLogin).toBe(
      false,
    );
  });
  it("binds to localhost only when dev login is on, unless HOST is set", () => {
    expect(loadConfig({ ...base, MURMUR_DEV_LOGIN: "1" }).host).toBe(
      "127.0.0.1",
    );
    expect(
      loadConfig({ ...base, MURMUR_DEV_LOGIN: "1", HOST: "0.0.0.0" }).host,
    ).toBe("0.0.0.0");
    expect(loadConfig(base).host).toBeUndefined();
    expect(loadConfig({ ...prod, HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
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
  it("names every missing production setting at once", () => {
    expect(loadConfig(prod).databaseUrl).toBe("postgres://db");
    expect(() =>
      loadConfig({ ...prod, DATABASE_URL: "", GITHUB_CLIENT_SECRET: "" }),
    ).toThrow(
      "Murmur cannot start in production without DATABASE_URL or MURMUR_DATA_DIR, GITHUB_CLIENT_SECRET.",
    );
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "without DATABASE_URL or MURMUR_DATA_DIR, BASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET.",
    );
  });
  it("takes MURMUR_DATA_DIR in place of DATABASE_URL in production", () => {
    const { DATABASE_URL: _, ...noDb } = prod;
    const onDisk = loadConfig({ ...noDb, MURMUR_DATA_DIR: "/srv/murmur" });
    expect(onDisk.dataDir).toBe("/srv/murmur");
    expect(onDisk.databaseUrl).toBeUndefined();
    expect(() => loadConfig({ ...noDb, MURMUR_DATA_DIR: "" })).toThrow(
      "without DATABASE_URL or MURMUR_DATA_DIR.",
    );
    expect(loadConfig(base).dataDir).toBeUndefined();
  });
  it("binds to localhost in production behind a proxy, unless HOST is set", () => {
    expect(loadConfig({ ...prod, TRUST_PROXY: "1" }).host).toBe("127.0.0.1");
    expect(
      loadConfig({ ...prod, TRUST_PROXY: "1", HOST: "0.0.0.0" }).host,
    ).toBe("0.0.0.0");
    expect(loadConfig(prod).host).toBeUndefined();
    expect(loadConfig({ ...base, TRUST_PROXY: "1" }).host).toBeUndefined();
  });
  it("parses MURMUR_ALLOWED_LOGINS into lowercase logins and GitHub ids", () => {
    const parse = (v: string) =>
      loadConfig({ ...base, MURMUR_ALLOWED_LOGINS: v }).config.allowList;
    expect(loadConfig(base).config.allowList).toBeUndefined();
    expect(parse(" ")).toBeUndefined();
    expect(parse("Ada, bob,,CHARLIE-9 ")).toEqual({
      logins: ["ada", "bob", "charlie-9"],
      ids: [],
    });
    // login:id matches the numeric GitHub id only, so a rename keeps access
    // and someone who takes the old name gets none.
    expect(parse("ada:583231, bob")).toEqual({
      logins: ["bob"],
      ids: [583231],
    });
    expect(() => parse("ada:12x")).toThrow(
      'MURMUR_ALLOWED_LOGINS: "ada:12x" is not a GitHub login or login:id.',
    );
    expect(() => parse("ada bob")).toThrow(/"ada bob"/);
  });
  it("MURMUR_ALLOWED_LOGINS=* means anyone may sign in", () => {
    expect(
      loadConfig({ ...base, MURMUR_ALLOWED_LOGINS: "*" }).config.allowList,
    ).toBeUndefined();
    expect(
      loadConfig({ ...base, MURMUR_ALLOWED_LOGINS: "ada,*" }).config.allowList,
    ).toBeUndefined();
    expect(
      loadConfig({ ...prod, MURMUR_ALLOWED_LOGINS: "*" }).startupNote,
    ).toMatch(/^Murmur is open/);
  });
  it("strips trailing slashes from BASE_URL", () => {
    expect(loadConfig({ BASE_URL: "https://m.example//" }).config.baseUrl).toBe(
      "https://m.example",
    );
  });
  it("refuses DATABASE_URL and MURMUR_DATA_DIR together", () => {
    expect(() =>
      loadConfig({
        ...base,
        DATABASE_URL: "postgres://db",
        MURMUR_DATA_DIR: "/d",
      }),
    ).toThrow("Set DATABASE_URL or MURMUR_DATA_DIR, not both.");
  });
  it("says at startup in production whether anyone may sign in", () => {
    expect(loadConfig(base).startupNote).toBeUndefined();
    expect(loadConfig(prod).startupNote).toBe(
      "Murmur is open: anyone with a GitHub account can sign in. Set MURMUR_ALLOWED_LOGINS to make it invite-only.",
    );
    expect(
      loadConfig({ ...prod, MURMUR_ALLOWED_LOGINS: "ada,bob" }).startupNote,
    ).toBe("Murmur is invite-only: 2 GitHub logins may sign in.");
    expect(
      loadConfig({ ...prod, MURMUR_ALLOWED_LOGINS: "ada:1,bob" }).startupNote,
    ).toBe("Murmur is invite-only: 2 GitHub logins may sign in.");
    expect(
      loadConfig({ ...prod, MURMUR_ALLOWED_LOGINS: "ada" }).startupNote,
    ).toBe("Murmur is invite-only: 1 GitHub login may sign in.");
  });
});
