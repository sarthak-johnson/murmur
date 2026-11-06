import { createHash } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { deviceCodes, ingestTokens } from "../src/db/schema.js";
import { BASE, sameOrigin, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = { "Content-Type": "application/json" };

async function start(machineName = "ada-mbp") {
  const app = t?.app;
  if (!app) throw new Error("no app");
  const res = await app.request("/api/device/start", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ machineName }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    deviceCode: string;
    userCode: string;
    verifyUrl: string;
    interval: number;
    expiresIn: number;
  };
}

const poll = (deviceCode: string) =>
  t?.app.request("/api/device/poll", {
    method: "POST",
    body: JSON.stringify({ deviceCode }),
  }) as Promise<Response>;

const approve = (cookie: string, userCode: string, headers = {}) =>
  t?.app.request("/api/device/approve", {
    method: "POST",
    headers: { ...sameOrigin(cookie), ...headers },
    body: JSON.stringify({ userCode }),
  }) as Promise<Response>;

async function linkMachine(login = "ada") {
  const cookie = await t?.loginAs(login);
  const s = await start();
  await approve(cookie as string, s.userCode);
  const res = await poll(s.deviceCode);
  return (await res.json()) as { token: string; machineId: string };
}

test("device flow: start, poll pending, approve, poll returns token, poll again 410", async () => {
  t = await testApp();
  const s = await start();
  expect(s.userCode).toMatch(
    /^[BCDFGHJKLMNPQRSTVWXZ2-9]{4}-[BCDFGHJKLMNPQRSTVWXZ2-9]{4}$/,
  );
  expect(s.verifyUrl).toBe(`${BASE}/device?code=${s.userCode}`);
  expect(s.interval).toBe(3);
  expect(s.expiresIn).toBe(600);
  expect(s.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const [row] = await t.db.select().from(deviceCodes);
  expect(row?.deviceCodeHash).toBe(sha(s.deviceCode));

  const pending = await poll(s.deviceCode);
  expect(pending.status).toBe(428);
  expect(await pending.json()).toEqual({ status: "pending" });

  const cookie = await t.loginAs("ada");
  const ok = await approve(cookie, s.userCode);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ machineName: "ada-mbp" });

  const done = await poll(s.deviceCode);
  expect(done.status).toBe(200);
  const body = (await done.json()) as { token: string; machineId: string };
  expect(body.token).toMatch(/^mur_[A-Za-z0-9_-]{43}$/);
  expect(body.machineId).toMatch(/^[0-9a-f-]{36}$/);
  const [tok] = await t.db.select().from(ingestTokens);
  expect(tok).toMatchObject({
    tokenHash: sha(body.token),
    machineId: body.machineId,
    machineName: "ada-mbp",
    revokedAt: null,
  });

  const again = await poll(s.deviceCode);
  expect(again.status).toBe(410);
  expect(await again.json()).toEqual({ status: "expired" });
  expect(await t.db.select().from(ingestTokens)).toHaveLength(1);
});

test("expired device code returns 410", async () => {
  let now = new Date("2026-11-06T00:00:00Z");
  t = await testApp({ now: () => now });
  const s = await start();
  const cookie = await t.loginAs("ada");
  now = new Date("2026-11-06T00:10:01Z");
  expect((await approve(cookie, s.userCode)).status).toBe(404);
  const res = await poll(s.deviceCode);
  expect(res.status).toBe(410);
  expect(await res.json()).toEqual({ status: "expired" });
});

test("approved but not collected in time returns 410", async () => {
  let now = new Date("2026-11-06T00:00:00Z");
  t = await testApp({ now: () => now });
  const s = await start();
  const cookie = await t.loginAs("ada");
  expect((await approve(cookie, s.userCode)).status).toBe(200);
  now = new Date("2026-11-06T00:10:01Z");
  expect((await poll(s.deviceCode)).status).toBe(410);
  expect(await t.db.select().from(ingestTokens)).toHaveLength(0);
});

test("unknown device code returns 410", async () => {
  t = await testApp();
  expect((await poll("nope")).status).toBe(410);
});

test("approve matches the code in any case, with or without the dash", async () => {
  t = await testApp();
  const cookie = await t.loginAs("ada");
  const a = await start();
  const loose = a.userCode.replace("-", "").toLowerCase();
  expect((await approve(cookie, loose)).status).toBe(200);
  const second = await approve(cookie, a.userCode);
  expect(second.status).toBe(404);
  expect(await second.json()).toEqual({ error: "not_found" });
  expect((await approve(cookie, "BBBB-BBBB")).status).toBe(404);
});

test("approve without matching Origin is 403", async () => {
  t = await testApp();
  const s = await start();
  const cookie = await t.loginAs("ada");
  const evil = await approve(cookie, s.userCode, {
    Origin: "https://evil.example",
  });
  expect(evil.status).toBe(403);
  expect(await evil.json()).toEqual({ error: "forbidden" });
  const prefix = await approve(cookie, s.userCode, {
    Origin: `${BASE}.evil.example`,
  });
  expect(prefix.status).toBe(403);
  const noOrigin = await t.app.request("/api/device/approve", {
    method: "POST",
    headers: { Cookie: cookie, ...json },
    body: JSON.stringify({ userCode: s.userCode }),
  });
  expect(noOrigin.status).toBe(403);
  const textPlain = await approve(cookie, s.userCode, {
    "Content-Type": "text/plain",
  });
  expect(textPlain.status).toBe(403);
  expect((await poll(s.deviceCode)).status).toBe(428);
});

test("approve without a cookie is 401", async () => {
  t = await testApp();
  const s = await start();
  const res = await t.app.request("/api/device/approve", {
    method: "POST",
    headers: { Origin: BASE, ...json },
    body: JSON.stringify({ userCode: s.userCode }),
  });
  expect(res.status).toBe(401);
});

test("start rejects a missing machine name", async () => {
  t = await testApp();
  const res = await t.app.request("/api/device/start", {
    method: "POST",
    headers: json,
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

test("ingest token cannot read /api/sessions", async () => {
  t = await testApp();
  const { token } = await linkMachine();
  const res = await t.app.request("/api/sessions", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  const me = await t.app.request("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(me.status).toBe(401);
});

test("ingest accepts a valid token, records use, and refuses revoked ones", async () => {
  t = await testApp();
  const { token } = await linkMachine();
  const send = (auth: string) =>
    t?.app.request("/api/ingest", {
      method: "POST",
      headers: { Authorization: auth, ...json },
      body: JSON.stringify({ events: [] }),
    }) as Promise<Response>;

  expect((await send(`Bearer ${token}`)).status).not.toBe(401);
  const [used] = await t.db.select().from(ingestTokens);
  expect(used?.lastUsedAt).toBeInstanceOf(Date);

  expect((await send("Bearer mur_nope")).status).toBe(401);
  expect((await send(token)).status).toBe(401);

  await t.db.update(ingestTokens).set({ revokedAt: new Date() });
  const revoked = await send(`Bearer ${token}`);
  expect(revoked.status).toBe(401);
  expect(await revoked.json()).toEqual({ error: "unauthorized" });
});
