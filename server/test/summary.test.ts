import type { MurmurEvent } from "@murmur/core";
import { afterEach, expect, test, vi } from "vitest";
import { events, sessions } from "../src/db/schema.js";
import { READING } from "../src/summarize.js";
import {
  backfillSummaries,
  refreshSummary,
  type SessionSummary,
  type Summarizer,
  settleSummaries,
  stopSummaries,
  summarizeInWorker,
  useSummarizer,
} from "../src/summary.js";
import { ev, ingest, linkMachine, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>> | undefined;
let restore: (() => void) | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await settleSummaries();
  restore?.();
  restore = undefined;
  await t?.close();
  t = undefined;
});

const said = (title: string, n = 0): SessionSummary => ({
  title,
  requests: n,
  helpers: 0,
  from: "2026-11-06T10:00:00.000Z",
  waitingSince: null,
  state: "done",
  reading: READING,
});
/** A summarizer that reads every page and counts the events it was given. */
const counting = (log: number[]): Summarizer => {
  return async (pages) => {
    let n = 0;
    for await (const p of pages) n += p.length;
    log.push(n);
    return said(`read ${n}`, n);
  };
};
const row = async () => {
  const [r] = await (t as NonNullable<typeof t>).db.select().from(sessions);
  return r;
};

test("a burst of ingests reads the session once, a while after the first", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const reads: number[] = [];
  restore = useSummarizer(counting(reads));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (let i = 0; i < 5; i++) await ingest(t, token, [ev("s"), ev("s")]);
  expect(reads).toEqual([]);
  await vi.advanceTimersByTimeAsync(4999);
  expect(reads).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  vi.useRealTimers();
  await settleSummaries();
  expect(reads).toEqual([10]);
  expect((await row())?.summary?.title).toBe("read 10");
  // Nothing new since: no read at all.
  await settleSummaries();
  expect(reads).toEqual([10]);
});

test("a replay stores nothing new: no new version, no read", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const reads: number[] = [];
  restore = useSummarizer(counting(reads));
  const batch = [ev("s"), ev("s")];
  await ingest(t, token, batch);
  await settleSummaries();
  const before = await row();
  const res = await ingest(t, token, batch);
  expect(await res.json()).toEqual({ accepted: 0 });
  await settleSummaries();
  expect(reads).toEqual([2]);
  expect((await row())?.version).toBe(before?.version);
});

test("an older, slower read never overwrites a newer one", async () => {
  t = await testApp();
  const { token, userId } = await linkMachine(t, "ada");
  await ingest(t, token, [ev("s")]);
  let release = () => {};
  const held = new Promise<void>((ok) => {
    release = ok;
  });
  let began = () => {};
  const reading = new Promise<void>((ok) => {
    began = ok;
  });
  // The first read takes version 0's pages, then stalls past a newer ingest and read.
  const slow: Summarizer = async (pages) => {
    for await (const _ of pages);
    began();
    await held;
    return said("old");
  };
  const older = refreshSummary(t.db, userId, "s", slow);
  await reading;
  await ingest(t, token, [ev("s")]);
  await refreshSummary(t.db, userId, "s", async () => said("new"));
  release();
  await older;
  expect(await row()).toMatchObject({
    version: 1,
    summaryOfVersion: 1,
    summary: { title: "new" },
  });
});

test("a read that throws never fails an ingest, and the next read still runs", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  restore = useSummarizer(async () => {
    throw new Error("boom");
  });
  const res = await ingest(t, token, [ev("s")]);
  expect(res.status).toBe(200);
  await settleSummaries();
  expect(logged).toHaveBeenCalledWith("summary:", expect.any(Error));
  expect((await row())?.summary).toBeNull();
  restore();
  const reads: number[] = [];
  restore = useSummarizer(counting(reads));
  expect((await ingest(t, token, [ev("s")])).status).toBe(200);
  await settleSummaries();
  expect(reads).toEqual([2]);
});

test("a long session is read in pages, in (ts, id) order", async () => {
  t = await testApp();
  const { token, userId } = await linkMachine(t, "ada");
  // Many at one time, so the cursor must step by id within it.
  const ts = "2026-11-06T12:00:00.000Z";
  const all: MurmurEvent[] = Array.from({ length: 2001 }, (_, i) =>
    ev("s", "PreToolUse", i % 3 ? { ts } : {}),
  );
  for (let i = 0; i < all.length; i += 500)
    await ingest(t, token, all.slice(i, i + 500));
  const pages: string[][] = [];
  await refreshSummary(t.db, userId, "s", async (it) => {
    for await (const p of it) pages.push(p.map((e) => e.id));
    return said("paged");
  });
  expect(pages.map((p) => p.length)).toEqual([2000, 1]);
  const want = all
    .toSorted((a, b) =>
      a.ts === b.ts
        ? a.id < b.id
          ? -1
          : 1
        : Date.parse(a.ts) - Date.parse(b.ts),
    )
    .map((e) => e.id);
  expect(pages.flat()).toEqual(want);
});

test("the worker reduces a session as core does", async () => {
  t = await testApp();
  const { token, userId } = await linkMachine(t, "ada");
  const first = ev("s", "UserPromptSubmit", {
    payload: { prompt: "Rebuild the settings page" },
  });
  // An open AskUserQuestion: the lobby says it waits, as the room does (core needsYou).
  const ask = ev("s", "PreToolUse", {
    payload: {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: { questions: [{ question: "Morning or evening?" }] },
    },
  });
  await ingest(t, token, [ev("s", "SessionStart"), first, ask]);
  await refreshSummary(t.db, userId, "s");
  expect((await row())?.summary).toMatchObject({
    title: "Rebuild the settings page",
    requests: 1,
    from: first.ts,
    waitingSince: ask.ts,
    state: "waiting",
    reading: READING,
  });
  // A session left with no events says nothing.
  await t.db.update(sessions).set({ summaryOfVersion: null });
  await t.db.delete(events);
  await refreshSummary(t.db, userId, "s");
  expect((await row())?.summaryOfVersion).toBeNull();
});

test("a worker that dies while a read's pages load fails that read, and the next read gets a new worker", async () => {
  const prompt = (text: string) =>
    ev("s", "UserPromptSubmit", { payload: { prompt: text } });
  let more = () => {};
  const gate = new Promise<void>((ok) => {
    more = ok;
  });
  let sent = () => {};
  const firstSent = new Promise<void>((ok) => {
    sent = ok;
  });
  async function* slowPages() {
    yield [prompt("Rebuild the settings page")];
    sent();
    // The database is slow; the worker dies meanwhile.
    await gate;
    yield [ev("s")];
  }
  const read = summarizeInWorker(slowPages());
  await firstSent;
  await stopSummaries();
  // Long enough for Node to see a rejection nobody handles.
  await new Promise((ok) => setTimeout(ok, 50));
  more();
  await expect(read).rejects.toThrow(/summary worker exited/);
  async function* onePage() {
    yield [prompt("Add a dark theme")];
  }
  expect(await summarizeInWorker(onePage())).toMatchObject({
    title: "Add a dark theme",
  });
});

test("a summary of an older reading is read again at start, though nothing new came", async () => {
  t = await testApp();
  const { token } = await linkMachine(t, "ada");
  const reads: number[] = [];
  restore = useSummarizer(counting(reads));
  await ingest(t, token, [ev("s")]);
  await settleSummaries();
  await backfillSummaries(t.db);
  expect(reads).toEqual([1]);
  // As a server from before this reading stored it: same version, no `reading`.
  const { reading: _, ...old } = said("before");
  await t.db.update(sessions).set({ summary: old as SessionSummary });
  vi.spyOn(console, "log").mockImplementation(() => {});
  await backfillSummaries(t.db);
  expect(reads).toEqual([1, 1]);
  expect((await row())?.summary).toMatchObject({ reading: READING });
  await backfillSummaries(t.db);
  expect(reads).toEqual([1, 1]);
});

test("the lobby's state is that of the request the room follows", async () => {
  t = await testApp();
  const { token, userId } = await linkMachine(t, "ada");
  // Claude works on, then stops mid-plan: its last request still reads running.
  await ingest(t, token, [
    ev("s", "UserPromptSubmit", {
      payload: { prompt: "Build the release script" },
    }),
    ev("s", "PreToolUse", {
      payload: { tool_name: "Bash", tool_input: { command: "npm run build" } },
    }),
  ]);
  await refreshSummary(t.db, userId, "s");
  expect((await row())?.summary).toMatchObject({ state: "running" });
});
