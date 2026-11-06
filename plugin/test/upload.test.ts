import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MurmurEvent } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { murmurDir } from "../src/local.js";
import { enqueue, flush } from "../src/upload.js";

const CREDS = { server: "http://srv", token: "tok", machineId: "m1" };
const T0 = Date.parse("2026-11-06T10:00:00.000Z");
// Only the time-budget test uses a real budget; a loaded machine must not make the rest flaky.
const NO_DEADLINE = 60_000;

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-upload-"));
  process.env.MURMUR_HOME = path.join(home, "murmur");
});

const ev = (i: number, payload: Record<string, unknown> = {}): MurmurEvent => ({
  id: `e${String(i).padStart(4, "0")}`,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/r",
  ts: new Date(T0 + i).toISOString(),
  hook: "Stop",
  payload,
});
const queued = () => fs.readdirSync(path.join(murmurDir(), "queue")).sort();

type Call = { url: string; auth: string; ids: string[]; bytes: number };
function fakeFetch(statuses: (number | "throw")[]) {
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
    return new Response("{}", { status: s ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// Hundreds of real queue files: a busy, nearly full disk can take longer than 5 s.
describe("queue", { timeout: 30_000 }, () => {
  it("flush keeps files when the server is down and sends them in order later", async () => {
    for (const i of [3, 1, 2]) enqueue(ev(i));
    const down = fakeFetch(["throw"]);
    expect(await flush(CREDS, down.fn, NO_DEADLINE)).toEqual({
      sent: 0,
      kept: 3,
    });
    expect(queued()).toHaveLength(3);

    const err = fakeFetch([503]);
    expect(await flush(CREDS, err.fn, NO_DEADLINE)).toEqual({
      sent: 0,
      kept: 3,
    });

    const up = fakeFetch([200]);
    expect(await flush(CREDS, up.fn, NO_DEADLINE)).toEqual({
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

  it("flush splits 450 events into batches of 200, 200, 50", async () => {
    for (let i = 0; i < 450; i++) enqueue(ev(i));
    const f = fakeFetch([200]);
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({
      sent: 450,
      kept: 0,
    });
    expect(f.calls.map((c) => c.ids.length)).toEqual([200, 200, 50]);
    expect(f.calls.flatMap((c) => c.ids)).toEqual(
      Array.from({ length: 450 }, (_, i) => ev(i).id),
    );
  });

  it("a failed batch stops the run and keeps it and everything after", async () => {
    for (let i = 0; i < 450; i++) enqueue(ev(i));
    const f = fakeFetch([200, 500]);
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({
      sent: 200,
      kept: 250,
    });
    expect(f.calls).toHaveLength(2);
    expect(queued()).toHaveLength(250);
  });

  it("a 6 MB event alone is sent in its own batch after truncation", async () => {
    // Each string is under MAX_STRING, so scrubbing keeps all 6 MB.
    const chunks = Array.from({ length: 24 }, () => "y".repeat(256 * 1024));
    enqueue(ev(1));
    enqueue(ev(2, { chunks }));
    enqueue(ev(3));
    const f = fakeFetch([200]);
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({ sent: 3, kept: 0 });
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
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({
      sent: 60,
      kept: 0,
    });
    expect(f.calls.length).toBeGreaterThan(2);
    for (const c of f.calls) expect(c.bytes).toBeLessThan(5_000_000);
  });

  it("a lone event the server rejects as too large is dropped, not retried", async () => {
    enqueue(ev(1));
    const f = fakeFetch([413]);
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({ sent: 0, kept: 0 });
    expect(queued()).toEqual([]);
  });

  it("malformed queue files are deleted, temp files are left alone", async () => {
    enqueue(ev(1));
    const dir = path.join(murmurDir(), "queue");
    fs.writeFileSync(path.join(dir, "000000000000000-bad.json"), "{nope");
    fs.writeFileSync(path.join(dir, "000000000000001-wrong.json"), '{"id":1}');
    fs.writeFileSync(path.join(dir, ".tmp-partial.json"), "{");
    const f = fakeFetch([200]);
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({ sent: 1, kept: 0 });
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
    expect(await flush(CREDS, fn, NO_DEADLINE)).toEqual({ sent: 2, kept: 0 });
  });

  it("flush with no queue dir sends nothing", async () => {
    const f = fakeFetch([200]);
    expect(await flush(CREDS, f.fn, NO_DEADLINE)).toEqual({ sent: 0, kept: 0 });
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
    expect(await flush(CREDS, hang, 100)).toEqual({ sent: 0, kept: 1 });
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
