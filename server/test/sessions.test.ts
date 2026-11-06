import type { MurmurEvent } from "@murmur/core";
import { afterEach, expect, test } from "vitest";
import {
  assumptionDecisions,
  events,
  ingestTokens,
  sessions,
} from "../src/db/schema.js";
import { ev, ingest, linkMachine, sameOrigin, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

interface Body {
  sessions: {
    sessionId: string;
    title: string | null;
    machineName: string | null;
    startedAt: string;
    lastEventAt: string;
  }[];
  events: MurmurEvent[];
  hasMore: boolean;
  decisions: { key: string; decision: string }[];
}

const get = async (cookie: string, path: string) => {
  const res = (await t?.app.request(path, {
    headers: { Cookie: cookie },
  })) as Response;
  return { status: res.status, body: (await res.json()) as Body };
};

test("sessions list is newest first and titled from the first prompt", async () => {
  t = await testApp();
  const { token, cookie } = await linkMachine(t, "ada", "ada-mbp");
  await ingest(t, token, [
    ev("old", "SessionStart", { cwd: "/old" }),
    ev("old", "UserPromptSubmit", { payload: { prompt: "fix the login bug" } }),
    ev("old", "UserPromptSubmit", { payload: { prompt: "and the tests" } }),
  ]);
  await ingest(t, token, [ev("new", "SessionStart", { cwd: "/new" })]);
  const { status, body } = await get(cookie, "/api/sessions");
  expect(status).toBe(200);
  expect(body.sessions.map((s) => s.sessionId)).toEqual(["new", "old"]);
  expect(body.sessions[1]).toMatchObject({
    sessionId: "old",
    cwd: "/old",
    title: "fix the login bug",
    machineName: "ada-mbp",
    ended: false,
  });
  expect(body.sessions[0]?.title).toBeNull();
  expect(typeof body.sessions[0]?.startedAt).toBe("string");
  expect(typeof body.sessions[0]?.lastEventAt).toBe("string");

  // The newest live token's name wins; a revoked one does not count.
  const [tok] = await t.db.select().from(ingestTokens);
  await t.db.insert(ingestTokens).values({
    tokenHash: "renamed",
    userId: tok?.userId as string,
    machineId: tok?.machineId as string,
    machineName: "ada-laptop",
    createdAt: new Date(Date.now() + 1000),
  });
  expect(
    (await get(cookie, "/api/sessions")).body.sessions[0]?.machineName,
  ).toBe("ada-laptop");
  await t.db.update(ingestTokens).set({ revokedAt: new Date() });
  expect(
    (await get(cookie, "/api/sessions")).body.sessions[0]?.machineName,
  ).toBeNull();
});

test("events after a cursor are ordered", async () => {
  t = await testApp();
  const { token, cookie, machineId } = await linkMachine(t, "ada");
  const ts = "2026-11-06T11:00:00.000Z";
  const a = ev("s1", "SessionStart", { ts: "2026-11-06T10:59:59.000Z" });
  const same = [
    ev("s1", "PreToolUse", { ts }),
    ev("s1", "PostToolUse", { ts }),
  ];
  const c = ev("s1", "Stop", { ts: "2026-11-06T11:00:01.000Z" });
  // Sent out of order: the server orders by (ts, id).
  await ingest(t, token, [c, same[1], a, same[0]]);
  const all = await get(cookie, "/api/sessions/s1/events");
  expect(all.status).toBe(200);
  const sorted = [...same].sort((x, y) => (x.id < y.id ? -1 : 1));
  const want = [a, ...sorted, c].map((e) => ({ ...e, machineId }));
  expect(all.body).toEqual({ events: want, hasMore: false });

  const afterTs = await get(cookie, `/api/sessions/s1/events?after=${ts}`);
  expect(afterTs.body.events.map((e: MurmurEvent) => e.id)).toEqual([c.id]);
  const first = sorted[0] as MurmurEvent;
  const tuple = await get(
    cookie,
    `/api/sessions/s1/events?after=${ts}&afterId=${first.id}`,
  );
  expect(tuple.body.events.map((e: MurmurEvent) => e.id)).toEqual([
    sorted[1]?.id,
    c.id,
  ]);
  expect((await get(cookie, "/api/sessions/s1/events?after=nope")).status).toBe(
    400,
  );
  expect(
    (await get(cookie, `/api/sessions/s1/events?after=${ts}&afterId=x`)).status,
  ).toBe(400);
});

test("events are capped at 5,000 per page with hasMore", async () => {
  t = await testApp();
  const { token, cookie } = await linkMachine(t, "ada");
  for (let i = 0; i < 11; i++)
    await ingest(
      t,
      token,
      Array.from({ length: i < 10 ? 500 : 1 }, () => ev("s1")),
    );
  const page = await get(cookie, "/api/sessions/s1/events");
  expect(page.body.events).toHaveLength(5000);
  expect(page.body.hasMore).toBe(true);
  const last = page.body.events.at(-1) as MurmurEvent;
  const rest = await get(
    cookie,
    `/api/sessions/s1/events?after=${last.ts}&afterId=${last.id}`,
  );
  expect(rest.body.events).toHaveLength(1);
  expect(rest.body.hasMore).toBe(false);
});

test("user B gets 404 for user A's session", async () => {
  t = await testApp();
  const a = await linkMachine(t, "ada");
  const b = await linkMachine(t, "bob");
  await ingest(t, a.token, [ev("s1", "SessionStart")]);
  expect((await get(b.cookie, "/api/sessions")).body).toEqual({ sessions: [] });
  for (const path of ["events", "assumptions", "stream"]) {
    const res = await get(b.cookie, `/api/sessions/s1/${path}`);
    expect(res).toEqual({ status: 404, body: { error: "not_found" } });
  }
  const put = await t.app.request("/api/sessions/s1/assumptions", {
    method: "PUT",
    headers: sameOrigin(b.cookie),
    body: JSON.stringify({ key: "k", decision: "accepted" }),
  });
  expect(put.status).toBe(404);
  const del = await t.app.request("/api/sessions/s1", {
    method: "DELETE",
    headers: sameOrigin(b.cookie),
    body: "{}",
  });
  expect(del.status).toBe(404);
  // B ingesting the same session id gets B's own session, not A's.
  await ingest(t, b.token, [ev("s1", "Stop")]);
  expect(
    (await get(a.cookie, "/api/sessions/s1/events")).body.events,
  ).toHaveLength(1);
  expect(
    (await get(b.cookie, "/api/sessions/s1/events")).body.events,
  ).toHaveLength(1);
});

test("assumption decisions upsert per key", async () => {
  let now = new Date("2026-11-06T12:00:00.000Z");
  t = await testApp({ now: () => now });
  const { token, cookie } = await linkMachine(t, "ada");
  await ingest(t, token, [ev("s1", "SessionStart")]);
  const put = (body: unknown) =>
    t?.app.request("/api/sessions/s1/assumptions", {
      method: "PUT",
      headers: sameOrigin(cookie),
      body: JSON.stringify(body),
    }) as Promise<Response>;
  expect((await put({ key: "k1", decision: "accepted" })).status).toBe(200);
  now = new Date("2026-11-06T12:05:00.000Z");
  expect((await put({ key: "k1", decision: "rejected" })).status).toBe(200);
  expect((await put({ key: "k2", decision: "accepted" })).status).toBe(200);
  expect((await put({ key: "k3", decision: "maybe" })).status).toBe(400);
  expect((await put({ decision: "accepted" })).status).toBe(400);
  const res = await get(cookie, "/api/sessions/s1/assumptions");
  expect(res.body.decisions).toHaveLength(2);
  expect(res.body.decisions).toEqual(
    expect.arrayContaining([
      { key: "k1", decision: "rejected" },
      { key: "k2", decision: "accepted" },
    ]),
  );
  const rows = await t.db.select().from(assumptionDecisions);
  expect(rows.find((r) => r.key === "k1")?.decidedAt).toEqual(now);
});

test("delete removes the session and its events", async () => {
  t = await testApp();
  const { token, cookie } = await linkMachine(t, "ada");
  await ingest(t, token, [ev("s1", "SessionStart"), ev("s1"), ev("s2")]);
  await t.app.request("/api/sessions/s1/assumptions", {
    method: "PUT",
    headers: sameOrigin(cookie),
    body: JSON.stringify({ key: "k", decision: "accepted" }),
  });
  const del = await t.app.request("/api/sessions/s1", {
    method: "DELETE",
    headers: sameOrigin(cookie),
    body: "{}",
  });
  expect(del.status).toBe(200);
  expect((await get(cookie, "/api/sessions/s1/events")).status).toBe(404);
  const left = await t.db.select().from(events);
  expect(left.map((e) => e.sessionId)).toEqual(["s2"]);
  expect(await t.db.select().from(assumptionDecisions)).toHaveLength(0);
  expect((await t.db.select().from(sessions)).map((s) => s.sessionId)).toEqual([
    "s2",
  ]);
});
