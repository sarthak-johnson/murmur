import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type MurmurEvent, reduce } from "@murmur/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readBackfill, runBackfill, stableId } from "../src/backfill.js";
import {
  type Credentials,
  murmurDir,
  readSession,
  setProjectState,
  writeCredentials,
  writeSession,
} from "../src/local.js";

// Lets a test change what readCredentials returns partway through a run.
const creds = vi.hoisted(() => ({
  next: [] as (Credentials | null)[],
}));
vi.mock("../src/local.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/local.js")>();
  return {
    ...real,
    readCredentials: () =>
      creds.next.length ? creds.next.shift() : real.readCredentials(),
  };
});

const SID = "11111111-2222-4333-8444-555555555555";
const FIXTURE = path.join(import.meta.dirname, "fixtures/backfill");
const TRANSCRIPT = path.join(FIXTURE, `${SID}.jsonl`);
const t = (s: number) =>
  new Date(Date.parse("2026-11-07T09:00:00.000Z") + s * 1000).toISOString();
const input = (extra: Partial<Parameters<typeof readBackfill>[0]> = {}) => ({
  sessionId: SID,
  machineId: "m1",
  cwd: "/work/demo",
  transcriptPath: TRANSCRIPT,
  cutoff: t(100),
  ...extra,
});
const brief = (e: MurmurEvent) =>
  [
    e.hook,
    e.payload.tool_name ?? e.payload.agent_id ?? e.payload.prompt,
    e.payload.agent_id && e.payload.tool_name ? "sub" : "",
  ].join(" ");

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-backfill-"));
  process.env.MURMUR_HOME = path.join(home, "murmur");
});

describe("readBackfill", () => {
  it("maps prompts, tool calls and subagents in time order", () => {
    const events = readBackfill(input());
    expect(events.map(brief)).toEqual([
      "UserPromptSubmit Add a greet function with a test ",
      "PreToolUse Read ",
      "PostToolUse Read ",
      "PreToolUse Edit ",
      "PostToolUse Edit ",
      "PreToolUse Bash ",
      "PostToolUseFailure Bash ",
      "PreToolUse Agent ",
      "SubagentStart a1b2c3 ",
      "PreToolUse Bash sub",
      "PostToolUse Bash sub",
      "SubagentStop a1b2c3 ",
      "PostToolUse Agent ",
      "PreToolUse Agent ",
      "PostToolUse Agent ",
      // Launched in the background and not finished: it starts but never stops.
      "SubagentStart d4e5f6 ",
      "PreToolUse Read sub",
      "PreToolUse Bash ",
      "UserPromptSubmit /murmur:on now ",
      "UserPromptSubmit Here is how it looks\nmake it match ",
      "UserPromptSubmit Now add a README ",
    ]);
    for (const e of events) {
      expect(e).toMatchObject({ sessionId: SID, machineId: "m1" });
      expect(e.payload).toMatchObject({
        hook_event_name: e.hook,
        session_id: SID,
        cwd: "/work/demo",
      });
      expect(e.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    expect(events[0]?.ts).toBe(t(1));
  });

  it("carries tool input, use id and response, from toolUseResult or content", () => {
    const events = readBackfill(input());
    const edit = events.find(
      (e) => e.hook === "PostToolUse" && e.payload.tool_name === "Edit",
    );
    expect(edit?.payload).toMatchObject({
      tool_use_id: "toolu_edit",
      tool_input: { file_path: "/work/demo/greet.js" },
      tool_response: {
        filePath: "/work/demo/greet.js",
        structuredPatch: [{ lines: expect.any(Array) }],
      },
    });
    const failed = events.find((e) => e.hook === "PostToolUseFailure");
    expect(failed?.payload).toMatchObject({
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_use_id: "toolu_bash",
      tool_response: "Error: Exit code 1\nnpm ERR! missing script: test",
    });
    const sub = events.filter((e) => e.payload.agent_id === "a1b2c3");
    expect(sub.map((e) => e.payload.agent_type)).toEqual(
      Array(4).fill("general-purpose"),
    );
    expect(sub[2]?.payload.tool_response).toMatchObject({ stdout: "greet.js" });
  });

  it("the reduced view has the request and the edited file", () => {
    const view = reduce(readBackfill(input()));
    expect(view.requests.map((r) => r.prompt)).toEqual([
      "Add a greet function with a test",
      "/murmur:on now",
      "Here is how it looks\nmake it match",
      "Now add a README",
    ]);
    const req = view.requests[0];
    const files = [
      ...(req?.parts.flatMap((p) => p.files) ?? []),
      ...(req?.looseFiles ?? []),
    ];
    expect(files).toContainEqual(
      expect.objectContaining({ path: "greet.js", added: 2, removed: 1 }),
    );
    expect(req?.agents).toContainEqual(
      expect.objectContaining({ id: "a1b2c3", status: "done" }),
    );
  });

  it("emits nothing at or after the cutoff", () => {
    const events = readBackfill(input({ cutoff: t(15) }));
    expect(events.length).toBe(11);
    expect(events.every((e) => e.ts < t(15))).toBe(true);
    // The Agent call's result, which ends the helper, is at the cutoff.
    expect(events.map(brief)).not.toContain("SubagentStop a1b2c3 ");
  });

  it("prompts sharing a promptId stay apart", () => {
    const all = readBackfill(input()).filter(
      (e) => e.hook === "UserPromptSubmit",
    );
    expect(all.filter((e) => e.payload.prompt_id === "p-1")).toHaveLength(3);
    expect(new Set(all.map((e) => e.id)).size).toBe(4);
  });

  describe("the triggering prompt", () => {
    const transcript = (...texts: string[]) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-transcript-"));
      const file = path.join(dir, `${SID}.jsonl`);
      const lines = texts.map((content, i) =>
        JSON.stringify({
          type: "user",
          uuid: `x${i}`,
          timestamp: t(i),
          promptId: "same",
          origin: { kind: "human" },
          message: { role: "user", content },
        }),
      );
      fs.writeFileSync(file, `${lines.join("\n")}\n`);
      return file;
    };
    const prompts = (file: string, skipPrompt?: string) =>
      readBackfill(input({ transcriptPath: file }), { skipPrompt }).map(
        (e) => e.payload.prompt,
      );

    it("is skipped when the newest prompt is the same text", () => {
      expect(prompts(transcript("a", "b"), "b")).toEqual(["a"]);
      expect(prompts(transcript("a", "  b \n"), " b")).toEqual(["a"]);
      const cmd =
        "<command-message>murmur:on</command-message>\n<command-name>/murmur:on</command-name>\n<command-args>now</command-args>";
      expect(prompts(transcript("a", cmd), "/murmur:on now")).toEqual(["a"]);
    });

    it("skips nothing when its entry is not written yet, or another prompt is newest", () => {
      expect(prompts(transcript("a"), "b")).toEqual(["a"]);
      expect(prompts(transcript("b", "a"), "b")).toEqual(["b", "a"]);
      expect(prompts(transcript("a", "b"))).toEqual(["a", "b"]);
    });
  });

  it("reads only the tail of a large transcript, from a whole line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-transcript-"));
    const file = path.join(dir, `${SID}.jsonl`);
    const line = (i: number) =>
      JSON.stringify({
        type: "user",
        uuid: `x${i}`,
        timestamp: t(i),
        origin: { kind: "human" },
        message: { role: "user", content: `prompt ${i}` },
      });
    const lines = Array.from({ length: 2000 }, (_, i) => line(i));
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    const tail = Buffer.byteLength(lines.slice(-10).join("\n")) + 30;
    const events = readBackfill(
      input({ transcriptPath: file, cutoff: t(5000) }),
      { tailBytes: tail },
    );
    expect(events.map((e) => e.payload.prompt)).toEqual(
      Array.from({ length: 10 }, (_, i) => `prompt ${1990 + i}`),
    );
  });

  it("gives the same ids on every run, and the live hook's id for tool and subagent events", () => {
    const a = readBackfill(input()).map((e) => e.id);
    expect(readBackfill(input()).map((e) => e.id)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    expect(
      stableId(SID, "UserPromptSubmit", { prompt_id: "p-1" }),
    ).toBeUndefined();
    const start = readBackfill(input()).find((e) => e.hook === "SubagentStart");
    expect(start?.id).toBe(
      stableId(SID, "SubagentStart", { agent_id: "a1b2c3" }),
    );
    const pre = readBackfill(input()).find(
      (e) => e.payload.tool_use_id === "toolu_edit",
    );
    expect(pre?.id).toBe(
      stableId(SID, "PreToolUse", { tool_use_id: "toolu_edit" }),
    );
    expect(stableId(SID, "Stop", {})).toBeUndefined();
  });

  it("skips malformed lines, a missing transcript and missing subagent files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-transcript-"));
    const other = "99999999-2222-4333-8444-555555555555";
    const file = path.join(dir, `${other}.jsonl`);
    fs.writeFileSync(
      file,
      `null\n[1]\n{"type":"user"}\n${fs.readFileSync(TRANSCRIPT, "utf8")}`,
    );
    const events = readBackfill(
      input({ sessionId: other, transcriptPath: file }),
    );
    expect(events.map(brief)).toContain("PostToolUse Agent ");
    expect(events.some((e) => e.payload.agent_id)).toBe(false);
    expect(
      readBackfill(input({ transcriptPath: path.join(dir, "gone.jsonl") })),
    ).toEqual([]);
  });

  it("over the caps keeps the most recent events", () => {
    const all = readBackfill(input());
    const few = readBackfill(input(), { maxEvents: 3 });
    expect(few).toEqual(all.slice(-3));
    const bytes = all
      .slice(-2)
      .reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
    expect(readBackfill(input(), { maxBytes: bytes })).toEqual(all.slice(-2));
  });

  it("scrubs secrets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-transcript-"));
    const file = path.join(dir, `${SID}.jsonl`);
    const key = `sk-ant-${"a".repeat(30)}`;
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: "user",
        uuid: "x1",
        timestamp: t(1),
        origin: { kind: "human" },
        message: { role: "user", content: `use ${key}` },
      })}\n`,
    );
    const [e] = readBackfill(input({ transcriptPath: file }));
    expect(JSON.stringify(e)).not.toContain(key);
  });
});

describe("runBackfill", () => {
  const queued = () => {
    try {
      return fs.readdirSync(path.join(murmurDir(), "queue"));
    } catch {
      return [];
    }
  };

  it("queues the history once, marks the session done and flushes", async () => {
    writeCredentials({ server: "http://srv", token: "tok", machineId: "m1" });
    setProjectState("/work/demo", "on");
    writeSession(SID, {
      ...readSession(SID),
      backfill: "pending",
      cutoff: t(15),
      transcriptPath: TRANSCRIPT,
      cwd: "/work/demo",
    });
    const sent: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      sent.push(
        ...JSON.parse(init.body as string).events.map((e: MurmurEvent) => e.id),
      );
      return new Response("{}");
    }) as unknown as typeof globalThis.fetch;
    expect(await runBackfill(SID, { fetch })).toBe(11);
    expect(sent).toEqual(
      readBackfill(input({ cutoff: t(15) })).map((e) => e.id),
    );
    expect(readSession(SID).backfill).toBe("done");
    expect(await runBackfill(SID, { fetch })).toBe(0);
    expect(queued()).toEqual([]);
  });

  it("does nothing when not pending or logged out", async () => {
    setProjectState("/work/demo", "on");
    const pending = {
      ...readSession(SID),
      backfill: "pending" as const,
      cutoff: t(15),
      transcriptPath: TRANSCRIPT,
      cwd: "/work/demo",
    };
    writeSession(SID, pending);
    expect(await runBackfill(SID)).toBe(0);
    writeCredentials({ server: "http://srv", token: "tok", machineId: "m1" });
    writeSession(SID, {
      ...pending,
      backfill: "running",
      runningSince: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await runBackfill(SID)).toBe(0);
    expect(queued()).toEqual([]);
  });

  const sender = () => {
    const sent: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      sent.push(
        ...JSON.parse(init.body as string).events.map((e: MurmurEvent) => e.id),
      );
      return new Response("{}");
    }) as unknown as typeof globalThis.fetch;
    return { sent, fetch };
  };
  const pendingAt = (extra = {}) =>
    writeSession(SID, {
      ...readSession(SID),
      backfill: "pending",
      cutoff: t(100),
      transcriptPath: TRANSCRIPT,
      cwd: "/work/demo",
      ...extra,
    });

  it("retries a run that has been running for over 10 minutes", async () => {
    writeCredentials({ server: "http://srv", token: "tok", machineId: "m1" });
    setProjectState("/work/demo", "on");
    pendingAt({
      backfill: "running",
      runningSince: new Date(Date.now() - 11 * 60_000).toISOString(),
    });
    const { sent, fetch } = sender();
    expect(await runBackfill(SID, { fetch })).toBe(21);
    expect(sent).toHaveLength(21);
    expect(readSession(SID).backfill).toBe("done");
  });

  it("a prompt trigger is not imported twice", async () => {
    writeCredentials({ server: "http://srv", token: "tok", machineId: "m1" });
    setProjectState("/work/demo", "on");
    pendingAt({ triggerPrompt: "Now add a README" });
    const { sent, fetch } = sender();
    expect(await runBackfill(SID, { fetch })).toBe(20);
    expect(sent).toEqual(
      readBackfill(input(), { skipPrompt: "Now add a README" }).map(
        (e) => e.id,
      ),
    );
    // The raw prompt does not stay on disk once it is no longer needed.
    const state = readSession(SID);
    expect(state.backfill).toBe("done");
    expect(state.triggerPrompt).toBeUndefined();
    expect(
      fs.readFileSync(
        path.join(murmurDir(), "sessions", `${SID}.json`),
        "utf8",
      ),
    ).not.toContain("Now add a README");
  });

  it("skips the flush when the login changed while it ran", async () => {
    const a = { server: "http://srv", token: "tok", machineId: "m1" };
    writeCredentials(a);
    setProjectState("/work/demo", "on");
    pendingAt();
    const { sent, fetch } = sender();
    creds.next = [a, { ...a, token: "other" }];
    expect(await runBackfill(SID, { fetch })).toBe(21);
    expect(sent).toEqual([]);
    pendingAt({ backfill: "pending" });
    creds.next = [a, null];
    await runBackfill(SID, { fetch });
    expect(sent).toEqual([]);
    creds.next = [];
  });
});
