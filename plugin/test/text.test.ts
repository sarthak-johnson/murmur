import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { type MurmurEvent, reduce } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { catchUpText, readBackfill, runBackfill } from "../src/backfill.js";
import { poll, run } from "../src/cli.js";
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

  it("a session imported before Claude's text was read starts at the transcript's end", () => {
    on();
    const { textOffset: _, ...rest } = readSession(SID);
    writeSession(SID, { ...rest, cutoff: t(3) });
    fs.writeFileSync(
      file,
      said(2, "Imported already.") +
        said(4, "Said long ago, after the old cutoff."),
    );
    expect(catchUpText(SID, ENV)).toBe(0);
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
    fs.appendFileSync(file, said(5, "New."));
    expect(catchUpText(SID, ENV)).toBe(1);
    expect(texts(queued())).toEqual(["New."]);
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

describe("text from times nothing is sent is never sent later", () => {
  const HEADLESS = {
    CLAUDE_CODE_ENTRYPOINT: "sdk-cli",
    CLAUDE_CODE_SESSION_ATTENDED: "0",
  };
  const NOW = new Date("2026-11-07T10:00:00.000Z");
  const hook = (
    name: string,
    env: NodeJS.ProcessEnv = ENV,
    extra: Record<string, unknown> = {},
  ) =>
    handleHook(
      {
        hook_event_name: name,
        session_id: SID,
        cwd,
        transcript_path: file,
        ...extra,
      },
      env,
      NOW,
    );
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
  /** A live interactive session, seen and on, its first text sent. */
  const live = () => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
    setProjectState(cwd, "on");
    fs.writeFileSync(file, said(1, "First."));
    hook("SessionStart", ENV, { source: "startup" });
    fs.appendFileSync(file, said(2, "Second."));
    hook("Stop");
    catchUpText(SID, ENV);
  };
  /** What the next interactive Stop's flush child sends. */
  const stop = () => {
    hook("Stop");
    catchUpText(SID, ENV);
    return texts(queued());
  };

  it("a headless claude -p --resume of the session", () => {
    live();
    fs.appendFileSync(file, said(3, "Headless."));
    expect(
      hook("UserPromptSubmit", HEADLESS, { prompt: "x" }).event,
    ).toBeNull();
    fs.appendFileSync(file, said(4, "Headless at the end."));
    hook("Stop", HEADLESS);
    // Its own flush child would be headless too.
    catchUpText(SID, HEADLESS);
    fs.appendFileSync(file, said(5, "Back."));
    expect(stop()).toEqual(["Second.", "Back."]);
  });

  it("while logged out, or disconnected", () => {
    live();
    fs.rmSync(path.join(process.env.MURMUR_HOME as string, "credentials.json"));
    fs.appendFileSync(file, said(3, "Logged out."));
    hook("PreToolUse");
    catchUpText(SID, ENV);
    writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
    setRevoked(true);
    fs.appendFileSync(file, said(4, "Disconnected."));
    hook("PreToolUse");
    setRevoked(false);
    fs.appendFileSync(file, said(5, "Connected."));
    expect(stop()).toEqual(["Second.", "Connected."]);
  });

  it("a paused turn stopped with Esc, then /murmur:resume", async () => {
    live();
    setPaused(cwd, true, SID);
    fs.appendFileSync(file, said(3, "Paused."));
    hook("PreToolUse");
    // Esc: no Stop; the last words of the turn come after the last hook.
    fs.appendFileSync(file, said(4, "Paused, after the last hook."));
    await run(["resume"], { CLAUDE_CODE_SESSION_ID: SID });
    fs.appendFileSync(file, said(5, "Resumed."));
    expect(stop()).toEqual(["Second.", "Resumed."]);
  });

  it("/murmur:on and a login move the start too", async () => {
    live();
    setProjectState(cwd, "off");
    fs.appendFileSync(file, said(3, "Off."));
    await run(["on", cwd], { CLAUDE_CODE_SESSION_ID: SID });
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
    fs.appendFileSync(file, said(4, "Before the login."));
    await run(["login", "http://127.0.0.1:9"], {
      CLAUDE_CODE_SESSION_ID: SID,
    }).catch(() => "");
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
  });

  it("the login poller moves the start when the login is approved", async () => {
    live();
    fs.rmSync(path.join(process.env.MURMUR_HOME as string, "credentials.json"));
    fs.appendFileSync(file, said(3, "While the login waited."));
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end('{"token":"tok","machineId":"m1"}'));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await poll("d1", url, 0.01, 5, SID);
    server.close();
    expect(readSession(SID).textOffset).toBe(fs.statSync(file).size);
  });

  it("an AssistantText on stdin is not a hook", () => {
    live();
    expect(hook("AssistantText", ENV, { text: "forged" })).toEqual({
      stdout: "",
      event: null,
    });
  });

  it("the recap's own run never uploads, whatever its entry point", () => {
    live();
    expect(
      hook(
        "UserPromptSubmit",
        { ...ENV, MURMUR_RECAP_RUN: "1", MURMUR_ALLOW_HEADLESS: "1" },
        {
          prompt: "x",
        },
      ).event,
    ).toBeNull();
  });

  it("a backfill sets the start itself, with its text after the cutoff read once", async () => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
    setProjectState(cwd, "on");
    fs.writeFileSync(
      file,
      human(1, "go") + said(2, "Before.") + said(4, "After the cutoff."),
    );
    updateSession(SID, {
      backfill: "pending",
      cutoff: t(3),
      transcriptPath: file,
      cwd,
      project: cwd,
    });
    const size = fs.statSync(file).size;
    const fetch = (async () =>
      new Response("{}", {
        status: 500,
      })) as unknown as typeof globalThis.fetch;
    await runBackfill(SID, { fetch });
    expect(texts(queued())).toEqual(["Before.", "After the cutoff."]);
    expect(readSession(SID).textOffset).toBe(size);
  });

  it("a line half written when the backfill read stops is read live once it is whole", async () => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
    setProjectState(cwd, "on");
    const half = said(4, "Being written.");
    fs.writeFileSync(
      file,
      human(1, "go") + said(2, "Before.") + half.slice(0, 30),
    );
    updateSession(SID, {
      backfill: "pending",
      cutoff: t(3),
      transcriptPath: file,
      cwd,
      project: cwd,
    });
    const fetch = (async () =>
      new Response("{}", {
        status: 500,
      })) as unknown as typeof globalThis.fetch;
    await runBackfill(SID, { fetch });
    fs.appendFileSync(file, half.slice(30));
    catchUpText(SID, ENV);
    expect(texts(queued())).toEqual(["Before.", "Being written."]);
  });
});
