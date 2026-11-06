import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { events, sessions } from "../src/db/schema.js";
import { ev, ingest, linkMachine, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

test("ingest twice with the same ids stores once", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const batch = [ev("s1", "SessionStart"), ev("s1")];
  const first = await ingest(t, token, batch);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ accepted: 2 });
  const again = await ingest(t, token, batch);
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ accepted: 0 });
  expect(await t.db.select().from(events)).toHaveLength(2);
});

test("ingest rejects 501 events with 413", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const res = await ingest(
    t,
    token,
    Array.from({ length: 501 }, () => ev("s1")),
  );
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "too_many" });
  expect(await t.db.select().from(events)).toHaveLength(0);
  const ok = await ingest(
    t,
    token,
    Array.from({ length: 500 }, () => ev("s1")),
  );
  expect(ok.status).toBe(200);
});

test("ingest rejects a body over 5,000,000 bytes with 413", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const big = ev("s1", "PostToolUse", { payload: { out: "x".repeat(5e6) } });
  const res = await ingest(t, token, [big]);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "too_large" });
  // Chunked, so no Content-Length to trust: the read itself is capped.
  const body = new TextEncoder().encode(JSON.stringify({ events: [big] }));
  const chunked = await t.app.request("/api/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: new ReadableStream({
      start(c) {
        c.enqueue(body);
        c.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
  expect(chunked.status).toBe(413);
  expect(await t.db.select().from(events)).toHaveLength(0);
});

test("ingest rejects a batch with an invalid event and stores nothing", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  for (const bad of [
    { ...ev("s1"), hook: "Nope" },
    { ...ev("s1"), id: "not-a-uuid" },
    { ...ev("s1"), ts: "yesterday" },
  ]) {
    const res = await ingest(t, token, [ev("s1"), bad]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", index: 1 });
  }
  const notArray = await ingest(t, token, "nope");
  expect(notArray.status).toBe(400);
  expect(await t.db.select().from(events)).toHaveLength(0);
  expect(await t.db.select().from(sessions)).toHaveLength(0);
});

test("the token's machine id wins over the event's", async () => {
  t = await testApp();
  const { token, machineId } = await linkMachine(t, "ada");
  await ingest(t, token, [
    ev("s1", "SessionStart", { machineId: randomUUID() }),
  ]);
  const [row] = await t.db.select().from(sessions);
  expect(row?.machineId).toBe(machineId);
});

test("session row keeps the earliest start, latest event, first title and end", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const at = (s: string) => `2026-11-06T10:00:${s}.000Z`;
  const long = "p".repeat(100);
  await ingest(t, token, [
    ev("s1", "UserPromptSubmit", {
      ts: at("20"),
      cwd: "/b",
      payload: { prompt: long },
    }),
    ev("s1", "PreToolUse", { ts: at("30"), cwd: "/b" }),
  ]);
  let [row] = await t.db.select().from(sessions);
  expect(row?.title).toBe(`${"p".repeat(79)}…`);
  expect(row?.cwd).toBe("/b");
  // An older batch arrives late: start and cwd move back, last event and title stay.
  await ingest(t, token, [
    ev("s1", "SessionStart", { ts: at("10"), cwd: "/a" }),
    ev("s1", "UserPromptSubmit", {
      ts: at("11"),
      payload: { prompt: "first" },
    }),
  ]);
  [row] = await t.db.select().from(sessions);
  expect(row?.startedAt.toISOString()).toBe(at("10"));
  expect(row?.lastEventAt.toISOString()).toBe(at("30"));
  expect(row?.cwd).toBe("/a");
  expect(row?.title).toBe(`${"p".repeat(79)}…`);
  expect(row?.ended).toBe(false);
  await ingest(t, token, [ev("s1", "SessionEnd", { ts: at("40") })]);
  await ingest(t, token, [ev("s1", "Notification", { ts: at("50") })]);
  [row] = await t.db.select().from(sessions);
  expect(row?.ended).toBe(true);
  expect(row?.lastEventAt.toISOString()).toBe(at("50"));
});

test("NUL characters are dropped instead of failing the batch", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const res = await ingest(t, token, [
    ev("s1", "PostToolUse", { cwd: "/r\0", payload: { "k\0": "a\0b" } }),
  ]);
  expect(res.status).toBe(200);
  const [row] = await t.db.select().from(events);
  expect(row?.payload).toEqual({ k: "ab" });
});

test("lone surrogates are stored as U+FFFD instead of failing the batch", async () => {
  t = await testApp();
  const { token, cookie } = await linkMachine(t, "ada");
  const res = await ingest(t, token, [
    ev("s1", "PostToolUse", { payload: { "k\ud83d": "cut at a\ud83d" } }),
  ]);
  expect(res.status).toBe(200);
  const back = await t.app.request("/api/sessions/s1/events", {
    headers: { Cookie: cookie },
  });
  const { events: got } = (await back.json()) as {
    events: { payload: unknown }[];
  };
  expect(got[0]?.payload).toEqual({ "k�": "cut at a�" });
});

test("the title skips Murmur's own commands", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const at = (s: string) => `2026-11-06T10:00:${s}.000Z`;
  await ingest(t, token, [
    ev("s1", "UserPromptSubmit", {
      ts: at("10"),
      payload: { prompt: "/murmur:on" },
    }),
    ev("s1", "UserPromptSubmit", {
      ts: at("20"),
      payload: { prompt: "fix the login" },
    }),
  ]);
  const [row] = await t.db.select().from(sessions);
  expect(row?.title).toBe("fix the login");
});

test("long titles cut at a word boundary with an ellipsis, short ones stay", async () => {
  const { makeTitle } = await import("../src/ingest.js");
  expect(makeTitle("a".repeat(80))).toBe("a".repeat(80));
  const words =
    "add a price alert to the watchlist page so that traders see moves quickly today";
  const t = makeTitle(`${words} and more words`);
  expect(t.endsWith("…")).toBe(true);
  expect(Array.from(t).length).toBeLessThanOrEqual(80);
  expect(`${words} and more words`.startsWith(t.slice(0, -1))).toBe(true);
  expect(t.slice(0, -1).endsWith(" ")).toBe(false);
  expect(`${words} and more words`[t.length - 1]).toBe(" ");
});
