import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type MurmurEvent, reduce } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { catchUpText, readBackfill } from "../src/backfill.js";
import { handleHook } from "../src/hook.js";
import {
  queueDir,
  readSession,
  setPaused,
  setProjectState,
  setRevoked,
  updateSession,
  writeCredentials,
  writeSession,
} from "../src/local.js";

const SID = "22222222-2222-4333-8444-555555555555";
const ENV = {
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_SESSION_ATTENDED: "1",
};
const t = (s: number) =>
  new Date(Date.parse("2026-11-07T09:00:00.000Z") + s * 1000).toISOString();

let dir: string;
let file: string;
let cwd: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-text-"));
  process.env.MURMUR_HOME = path.join(dir, "murmur");
  cwd = path.join(dir, "repo");
  fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
  file = path.join(dir, `${SID}.jsonl`);
  fs.writeFileSync(file, "");
});

const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;
/** An assistant entry with text blocks and, like the real ones, a tool call between. */
const said = (s: number, ...texts: string[]) =>
  line({
    type: "assistant",
    uuid: `u${s}`,
    timestamp: t(s),
    isSidechain: false,
    cwd,
    message: {
      role: "assistant",
      content: [
        ...texts.map((text) => ({ type: "text", text })),
        {
          type: "tool_use",
          id: `toolu_${s}`,
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
  });
const human = (s: number, content: string) =>
  line({
    type: "user",
    uuid: `u${s}`,
    timestamp: t(s),
    promptId: "p1",
    origin: { kind: "human" },
    cwd,
    message: { role: "user", content },
  });
const NOTE =
  '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent "Build it" finished</summary>\n<result>Status: DONE</result>\n</task-notification>';
const notice = (s: number) =>
  line({
    type: "user",
    uuid: `u${s}`,
    timestamp: t(s),
    promptId: "p2",
    origin: { kind: "task-notification", producer: "session-task" },
    promptSource: "system",
    cwd,
    message: { role: "user", content: NOTE },
  });
const input = (cutoff: string) => ({
  sessionId: SID,
  machineId: "m1",
  cwd,
  transcriptPath: file,
  cutoff,
});
const texts = (events: MurmurEvent[]) =>
  events.filter((e) => e.hook === "AssistantText").map((e) => e.payload.text);

describe("backfill: Claude's words", () => {
  beforeEach(() => {
    fs.writeFileSync(
      file,
      [
        human(1, "Build the plate"),
        said(2, "I'll start with the tokens.", "   "),
        notice(3),
        said(4, "The builder is done: tokens are in."),
        said(9, "This one is after the cutoff."),
      ].join(""),
    );
    // A helper's own text is not Claude talking to the user.
    const sub = path.join(dir, SID, "subagents");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "agent-a1.jsonl"),
      line({
        type: "assistant",
        uuid: "s1",
        timestamp: t(2.5),
        isSidechain: true,
        message: { content: [{ type: "text", text: "helper chatter" }] },
      }),
    );
  });

  it("text blocks become AssistantText and notifications UserPromptSubmit, before the cutoff only", () => {
    const events = readBackfill(input(t(9)));
    expect(
      events.map((e) => [
        e.hook,
        e.payload.text ?? e.payload.prompt ?? e.payload.tool_name,
      ]),
    ).toEqual([
      ["UserPromptSubmit", "Build the plate"],
      ["AssistantText", "I'll start with the tokens."],
      ["PreToolUse", "Bash"],
      // The helper starts, but its own text never becomes a message.
      ["SubagentStart", undefined],
      ["UserPromptSubmit", NOTE],
      ["AssistantText", "The builder is done: tokens are in."],
      ["PreToolUse", "Bash"],
    ]);
    const text = events[1] as MurmurEvent;
    expect(text.payload).toEqual({
      text: "I'll start with the tokens.",
      hook_event_name: "AssistantText",
      session_id: SID,
      cwd,
    });
    expect(text.ts).toBe(t(2));
  });

  it("ids are stable across runs, and the notification stays out of requests", () => {
    const a = readBackfill(input(t(9)));
    const b = readBackfill(input(t(9)));
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    const view = reduce(a);
    expect(view.requests.map((r) => r.prompt)).toEqual(["Build the plate"]);
    expect(view.requests[0]?.messages?.map((m) => m.text)).toEqual([
      "I'll start with the tokens.",
      "The builder is done: tokens are in.",
    ]);
  });

  it("a notification that triggered the backfill is skipped like a prompt", () => {
    const events = readBackfill(input(t(9)), { skipPrompt: NOTE });
    expect(events.filter((e) => e.hook === "UserPromptSubmit")).toHaveLength(1);
  });
});

describe("live catch-up", () => {
  const queued = () => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(queueDir()).sort();
    } catch {}
    return names.map(
      (n) =>
        JSON.parse(
          fs.readFileSync(path.join(queueDir(), n), "utf8"),
        ) as MurmurEvent,
    );
  };
  const on = () => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
    setProjectState(cwd, "on");
    updateSession(SID, {
      backfill: "done",
      transcriptPath: file,
      cwd,
      project: cwd,
      textOffset: 0,
    });
  };

  it("a growing transcript sends each text once; a half-written line waits", () => {
    on();
    fs.writeFileSync(file, human(1, "go") + said(2, "First."));
    expect(catchUpText(SID, ENV)).toBe(1);
    const half = said(3, "Second.");
    fs.appendFileSync(file, half.slice(0, 40));
    expect(catchUpText(SID, ENV)).toBe(0);
    fs.appendFileSync(file, half.slice(40) + said(4, "Third."));
    expect(catchUpText(SID, ENV)).toBe(2);
    expect(catchUpText(SID, ENV)).toBe(0);
    expect(texts(queued())).toEqual(["First.", "Second.", "Third."]);
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
  });

  it("uses the backfill's ids, so a backfill and a catch-up never duplicate", () => {
    on();
    fs.writeFileSync(file, human(1, "go") + said(2, "Same words."));
    catchUpText(SID, ENV);
    const back = readBackfill(input(t(100))).filter(
      (e) => e.hook === "AssistantText",
    );
    expect(queued().map((e) => e.id)).toEqual(back.map((e) => e.id));
  });

  it("after a backfill, starts from its cutoff", () => {
    on();
    const { textOffset: _, ...rest } = readSession(SID);
    writeSession(SID, { ...rest, cutoff: t(3) });
    fs.writeFileSync(
      file,
      said(2, "Imported already.") + said(4, "After the cutoff."),
    );
    expect(catchUpText(SID, ENV)).toBe(1);
    expect(texts(queued())).toEqual(["After the cutoff."]);
  });

  it("off, paused, logged out, revoked and headless send nothing", () => {
    fs.writeFileSync(file, said(2, "Secret plans."));
    on();
    setProjectState(cwd, "off");
    expect(catchUpText(SID, ENV)).toBe(0);
    on();
    setPaused(cwd, true, SID);
    expect(catchUpText(SID, ENV)).toBe(0);
    // Paused text is skipped for good, not sent after a resume.
    setPaused(cwd, false, SID);
    expect(catchUpText(SID, ENV)).toBe(0);
    on();
    setRevoked(true);
    expect(catchUpText(SID, ENV)).toBe(0);
    setRevoked(false);
    expect(
      catchUpText(SID, {
        CLAUDE_CODE_ENTRYPOINT: "sdk-cli",
        CLAUDE_CODE_SESSION_ATTENDED: "0",
      }),
    ).toBe(0);
    fs.rmSync(path.join(process.env.MURMUR_HOME as string, "credentials.json"));
    expect(catchUpText(SID, ENV)).toBe(0);
    expect(queued()).toEqual([]);
  });

  it("waits for a pending backfill", () => {
    on();
    updateSession(SID, { backfill: "pending" });
    fs.writeFileSync(file, said(2, "Later."));
    expect(catchUpText(SID, ENV)).toBe(0);
  });
});

describe("the hook marks where live text starts, without reading the transcript", () => {
  const NOW = new Date("2026-11-07T10:00:00.000Z");
  const hook = (name: string, extra: Record<string, unknown> = {}) =>
    handleHook(
      {
        hook_event_name: name,
        session_id: SID,
        cwd,
        transcript_path: file,
        ...extra,
      },
      ENV,
      NOW,
    );
  beforeEach(() => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
    fs.writeFileSync(file, said(2, "Before Murmur saw it."));
  });

  it("a brand new session starts at the transcript's end", () => {
    setProjectState(cwd, "on");
    hook("SessionStart", { source: "startup" });
    expect(readSession(SID)).toMatchObject({
      backfill: "done",
      transcriptPath: file,
      cwd,
      textOffset: fs.statSync(file).size,
    });
  });

  it("a session first seen while off starts where it was when turned on", () => {
    setProjectState(cwd, "off");
    hook("SessionStart", { source: "startup" });
    fs.appendFileSync(file, said(3, "While off."));
    setProjectState(cwd, "on");
    hook("UserPromptSubmit", { prompt: "hi" });
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
  });

  it("a Stop while off or paused moves the start past what was said", () => {
    setProjectState(cwd, "on");
    hook("SessionStart", { source: "startup" });
    setProjectState(cwd, "off");
    fs.appendFileSync(file, said(3, "While off."));
    hook("Stop");
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
    setProjectState(cwd, "on");
    setPaused(cwd, true, SID);
    fs.appendFileSync(file, said(4, "While paused."));
    hook("Stop");
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
  });
});
