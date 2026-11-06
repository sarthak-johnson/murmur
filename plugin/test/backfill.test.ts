import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type MurmurEvent, reduce } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { readBackfill, runBackfill, stableId } from "../src/backfill.js";
import {
  murmurDir,
  readSession,
  setProjectState,
  writeCredentials,
  writeSession,
} from "../src/local.js";

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
      // A subagent whose meta is not finished starts but never stops.
      "SubagentStart d4e5f6 ",
      "PreToolUse Read sub",
      "PreToolUse Bash ",
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
    expect(events.length).toBe(12);
    expect(events.every((e) => e.ts < t(15))).toBe(true);
    expect(events.at(-1)?.hook).toBe("SubagentStop");
  });

  it("gives the same ids on every run, and the live hook's id for the same event", () => {
    const a = readBackfill(input()).map((e) => e.id);
    expect(readBackfill(input()).map((e) => e.id)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    const first = readBackfill(input())[0] as MurmurEvent;
    expect(first.id).toBe(
      stableId(SID, "UserPromptSubmit", { prompt_id: "p-1" }),
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
    // Old timestamps: the queue's 7-day cap is relative to now, so keep it out of this test.
    const old = Date.now;
    Date.now = () => Date.parse(t(20));
    try {
      expect(await runBackfill(SID, { fetch })).toBe(12);
    } finally {
      Date.now = old;
    }
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
    writeSession(SID, { ...pending, backfill: "running" });
    expect(await runBackfill(SID)).toBe(0);
    expect(queued()).toEqual([]);
  });
});
