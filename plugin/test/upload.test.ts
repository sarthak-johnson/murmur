import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MurmurEvent } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isRevoked,
  murmurDir,
  setProjectState,
  writeCredentials,
} from "../src/local.js";
import { enqueue, flush } from "../src/upload.js";

const CREDS = { server: "http://srv", token: "tok", machineId: "m1" };
// Recent, so the queue's 7-day cap keeps these events whenever the suite runs.
const T0 = Date.now() - 60_000;
// Only the time-budget test uses a real budget; a loaded machine must not make the rest flaky.
const NO_DEADLINE = 60_000;

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-upload-"));
  process.env.MURMUR_HOME = path.join(home, "murmur");
  setProjectState("/r", "on");
});

const ev = (
  i: number,
  payload: Record<string, unknown> = {},
  extra: Partial<MurmurEvent> = {},
): MurmurEvent => ({
  id: `e${String(i).padStart(4, "0")}`,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/r",
  ts: new Date(T0 + i).toISOString(),
  ...extra,
  hook: "Stop",
  payload,
});
const queued = () => fs.readdirSync(path.join(murmurDir(), "queue")).sort();

type Call = { url: string; auth: string; ids: string[]; bytes: number };
function fakeFetch(statuses: (number | "throw" | Response)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const body = init.body as string;
    calls.push({
      url,
      auth: (init.headers as Record<string, string>).Authorization ?? "",
      ids: JSON.parse(body).events.map((e: MurmurEvent) => e.id),
      bytes: Buffer.byteLength(body),
    });
    const s = statuses.length > 1 ? statuses.shift() : statuses[0];
    if (s === "throw") throw new TypeError("fetch failed");
    if (s instanceof Response) return s.clone();
    return new Response("{}", { status: s ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const opts = (f: { fn: typeof fetch }, extra = {}) => ({
  fetch: f.fn,
  budgetMs: NO_DEADLINE,
  ...extra,
});

describe("queue", () => {
  it("flush keeps files when the server is down and sends them in order later", async () => {
    for (const i of [3, 1, 2]) enqueue(ev(i));
    const down = fakeFetch(["throw"]);
    expect(await flush(CREDS, opts(down))).toEqual({
      sent: 0,
      kept: 3,
    });
    expect(queued()).toHaveLength(3);

    const err = fakeFetch([503]);
    expect(await flush(CREDS, opts(err))).toEqual({
      sent: 0,
      kept: 3,
    });

    const up = fakeFetch([200]);
    expect(await flush(CREDS, opts(up))).toEqual({
      sent: 3,
      kept: 0,
    });
    expect(up.calls).toEqual([
      {
        url: "http://srv/api/ingest",
        auth: "Bearer tok",
        ids: ["e0001", "e0002", "e0003"],
        bytes: expect.any(Number),
      },
    ]);
    expect(queued()).toEqual([]);
  });

  it("flush splits 9 events into batches of 4, 4, 1", async () => {
    for (let i = 0; i < 9; i++) enqueue(ev(i));
    const f = fakeFetch([200]);
    expect(await flush(CREDS, opts(f, { batchSize: 4 }))).toEqual({
      sent: 9,
      kept: 0,
    });
    expect(f.calls.map((c) => c.ids.length)).toEqual([4, 4, 1]);
    expect(f.calls.flatMap((c) => c.ids)).toEqual(
      Array.from({ length: 9 }, (_, i) => ev(i).id),
    );
  });

  it("a failed batch stops the run and keeps it and everything after", async () => {
    for (let i = 0; i < 9; i++) enqueue(ev(i));
    const f = fakeFetch([200, 500]);
    expect(await flush(CREDS, opts(f, { batchSize: 4 }))).toEqual({
      sent: 4,
      kept: 5,
    });
    expect(f.calls).toHaveLength(2);
    expect(queued()).toHaveLength(5);
  });

  it("an event the server calls invalid is dropped and the rest still go", async () => {
    for (let i = 1; i <= 3; i++) enqueue(ev(i));
    const invalid = Response.json(
      { error: "invalid", index: 1 },
      { status: 400 },
    );
    const f = fakeFetch([invalid, 200]);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 2, kept: 0 });
    expect(f.calls.map((c) => c.ids)).toEqual([
      ["e0001", "e0002", "e0003"],
      ["e0001", "e0003"],
    ]);
    expect(queued()).toEqual([]);
  });

  it("a 401 stops flushing and marks the machine disconnected", async () => {
    for (let i = 1; i <= 3; i++) enqueue(ev(i));
    const f = fakeFetch([401]);
    expect(await flush(CREDS, opts(f, { batchSize: 1 }))).toEqual({
      sent: 0,
      kept: 3,
    });
    expect(f.calls).toHaveLength(1);
    expect(isRevoked()).toBe(true);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 0, kept: 3 });
    expect(f.calls).toHaveLength(1);
    writeCredentials({ ...CREDS, token: "new" });
    expect(isRevoked()).toBe(false);
  });

  it("a 401 for a token replaced by a new login does not disconnect the new login", async () => {
    enqueue(ev(1));
    writeCredentials({ ...CREDS, token: "old" });
    let calls = 0;
    const late = (async () => {
      calls++;
      // A new login lands while the old token's request is in flight.
      writeCredentials({ ...CREDS, token: "new" });
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    await flush({ ...CREDS, token: "old" }, opts({ fn: late }));
    expect(calls).toBe(1);
    expect(isRevoked()).toBe(false);
  });

  it("events from another login or a project that is not on are dropped", async () => {
    enqueue(ev(1));
    enqueue(ev(2, {}, { machineId: "old" }));
    enqueue(ev(3, {}, { cwd: "/off" }));
    enqueue(ev(4, {}, { cwd: "/never" }));
    setProjectState("/off", "off");
    const f = fakeFetch([200]);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 1, kept: 0 });
    expect(f.calls.map((c) => c.ids)).toEqual([["e0001"]]);
    expect(queued()).toEqual([]);
  });

  it("the queue keeps 7 days and a size cap, dropping the oldest first", async () => {
    const day = 24 * 3600 * 1000;
    enqueue(ev(1, {}, { ts: new Date(Date.now() - 8 * day).toISOString() }));
    for (let i = 2; i <= 5; i++) enqueue(ev(i));
    const size = fs.statSync(
      path.join(murmurDir(), "queue", queued()[1] ?? ""),
    ).size;
    const down = fakeFetch(["throw"]);
    expect(await flush(CREDS, opts(down, { queueBytes: size * 2.5 }))).toEqual({
      sent: 0,
      kept: 2,
    });
    expect(queued().map((n) => n.split("-")[1])).toEqual([
      "e0004.json",
      "e0005.json",
    ]);
  });

  it("a 6 MB event alone is sent in its own batch after truncation", async () => {
    // Each string is under MAX_STRING, so scrubbing keeps all 6 MB.
    const chunks = Array.from({ length: 24 }, () => "y".repeat(256 * 1024));
    enqueue(ev(1));
    enqueue(ev(2, { chunks }));
    enqueue(ev(3));
    const f = fakeFetch([200]);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 3, kept: 0 });
    expect(f.calls.map((c) => c.ids)).toEqual([
      ["e0001"],
      ["e0002"],
      ["e0003"],
    ]);
    expect(f.calls[1]?.bytes).toBeGreaterThan(6 * 1024 * 1024);
  });

  it("batches stay under 5 MB of body", async () => {
    const chunk = "z".repeat(200 * 1024);
    for (let i = 0; i < 60; i++) enqueue(ev(i, { chunk }));
    const f = fakeFetch([200]);
    expect(await flush(CREDS, opts(f))).toEqual({
      sent: 60,
      kept: 0,
    });
    expect(f.calls.length).toBeGreaterThan(2);
    for (const c of f.calls) expect(c.bytes).toBeLessThan(5_000_000);
  });

  it("a lone event the server rejects as too large is dropped, not retried", async () => {
    enqueue(ev(1));
    const f = fakeFetch([413]);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 0, kept: 0 });
    expect(queued()).toEqual([]);
  });

  it("malformed queue files are deleted, temp files are left alone", async () => {
    enqueue(ev(1));
    const dir = path.join(murmurDir(), "queue");
    fs.writeFileSync(path.join(dir, "000000000000000-bad.json"), "{nope");
    fs.writeFileSync(path.join(dir, "000000000000001-wrong.json"), '{"id":1}');
    fs.writeFileSync(path.join(dir, ".tmp-partial.json"), "{");
    const f = fakeFetch([200]);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 1, kept: 0 });
    expect(f.calls.map((c) => c.ids)).toEqual([["e0001"]]);
    expect(queued()).toEqual([".tmp-partial.json"]);
  });

  it("a file that vanished meanwhile is fine", async () => {
    enqueue(ev(1));
    enqueue(ev(2));
    const dir = path.join(murmurDir(), "queue");
    const fn = (async () => {
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await flush(CREDS, { fetch: fn, budgetMs: NO_DEADLINE })).toEqual({
      sent: 2,
      kept: 0,
    });
  });

  it("flush with no queue dir sends nothing", async () => {
    const f = fakeFetch([200]);
    expect(await flush(CREDS, opts(f))).toEqual({ sent: 0, kept: 0 });
    expect(f.calls).toEqual([]);
  });

  it("flush gives up after the time budget and never throws", async () => {
    enqueue(ev(1));
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      )) as unknown as typeof fetch;
    const t = Date.now();
    expect(await flush(CREDS, { fetch: hang, budgetMs: 100 })).toEqual({
      sent: 0,
      kept: 1,
    });
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
