import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_STRING } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { handleHook } from "../src/hook.js";
import {
  NARRATION_INSTRUCTION,
  projectState,
  setPaused,
  setProjectState,
  writeCredentials,
} from "../src/local.js";

const ASK =
  "Murmur: show this project in Murmur? Run /murmur:on to turn it on, or /murmur:off to stop asking.";
const LOGIN = "Murmur: run /murmur:login to connect.";
const NOW = new Date("2026-11-06T10:00:00.000Z");
const ENV = {
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_SESSION_ATTENDED: "1",
};

let repo: string;
beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-hook-"));
  process.env.MURMUR_HOME = path.join(home, "murmur");
  repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
});

const login = () =>
  writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
const payload = (hook: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: hook,
  session_id: "s1",
  cwd: repo,
  ...extra,
});
const start = (source = "startup") => payload("SessionStart", { source });

describe("handleHook", () => {
  it("off project uploads nothing", () => {
    login();
    setProjectState(repo, "off");
    for (const p of [start(), payload("UserPromptSubmit", { prompt: "hi" })]) {
      expect(handleHook(p, ENV, NOW)).toEqual({ stdout: "", event: null });
    }
  });

  it("unset project asks once then stays quiet", () => {
    login();
    const first = handleHook(start(), ENV, NOW);
    expect(JSON.parse(first.stdout)).toEqual({ systemMessage: ASK });
    expect(first.event).toBeNull();
    expect(projectState(repo)).toBe("asked");
    expect(handleHook(start(), ENV, NOW)).toEqual({ stdout: "", event: null });
    expect(handleHook(payload("Stop"), ENV, NOW)).toEqual({
      stdout: "",
      event: null,
    });
  });

  it("on project injects the instruction", () => {
    login();
    setProjectState(repo, "on");
    for (const source of ["startup", "resume", "clear", "compact"]) {
      const r = handleHook(start(source), ENV, NOW);
      expect(JSON.parse(r.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: NARRATION_INSTRUCTION,
        },
      });
      expect(r.event).toMatchObject({
        sessionId: "s1",
        machineId: "m1",
        cwd: repo,
        hook: "SessionStart",
        ts: NOW.toISOString(),
      });
    }
    const other = handleHook(payload("PreToolUse"), ENV, NOW);
    expect(other.stdout).toBe("");
    expect(other.event?.hook).toBe("PreToolUse");
  });

  it("on project while logged out asks to log in each start and sends nothing", () => {
    setProjectState(repo, "on");
    for (let i = 0; i < 2; i++) {
      const r = handleHook(start("resume"), ENV, NOW);
      expect(JSON.parse(r.stdout)).toEqual({ systemMessage: LOGIN });
      expect(r.event).toBeNull();
    }
    expect(handleHook(payload("Stop"), ENV, NOW)).toEqual({
      stdout: "",
      event: null,
    });
  });

  it("paused session sends nothing, and a startup clears a folder pause", () => {
    login();
    setProjectState(repo, "on");
    setPaused(repo, true, "s1");
    expect(handleHook(payload("Stop"), ENV, NOW).event).toBeNull();
    // session id falls back to the env var
    const noId = { hook_event_name: "Stop", cwd: repo };
    expect(
      handleHook(noId, { ...ENV, CLAUDE_CODE_SESSION_ID: "s1" }, NOW).event,
    ).toBeNull();
    expect(handleHook(start(), ENV, NOW).event).toBeNull();

    setPaused(repo, true);
    expect(handleHook(start("resume"), { ...ENV }, NOW).event).toBeNull();
    const s2 = payload("SessionStart", { source: "startup", session_id: "s2" });
    expect(handleHook(s2, ENV, NOW).event?.sessionId).toBe("s2");
  });

  it("headless session is skipped unless MURMUR_ALLOW_HEADLESS=1", () => {
    login();
    const headless = [
      { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "0" },
      { CLAUDE_CODE_ENTRYPOINT: "sdk-ts" },
      { CLAUDE_CODE_SESSION_ATTENDED: "0" },
    ];
    for (const env of headless) {
      expect(handleHook(start(), env, NOW)).toEqual({
        stdout: "",
        event: null,
      });
      expect(projectState(repo)).toBeUndefined();
    }
    setProjectState(repo, "on");
    for (const env of headless) {
      expect(handleHook(start(), env, NOW)).toEqual({
        stdout: "",
        event: null,
      });
      expect(handleHook(payload("Stop"), env, NOW).event).toBeNull();
      const allowed = { ...env, MURMUR_ALLOW_HEADLESS: "1" };
      expect(handleHook(start(), allowed, NOW).stdout).toContain("Murmur is");
      expect(handleHook(payload("Stop"), allowed, NOW).event?.hook).toBe(
        "Stop",
      );
    }
  });

  it("an unknown entrypoint such as claude-vscode is interactive", () => {
    login();
    setProjectState(repo, "on");
    const env = { CLAUDE_CODE_ENTRYPOINT: "claude-vscode" };
    expect(handleHook(start(), env, NOW).stdout).toContain("Murmur is");
    expect(handleHook(payload("Stop"), env, NOW).event?.hook).toBe("Stop");
  });

  it("events are scrubbed before enqueue", () => {
    login();
    setProjectState(repo, "on");
    const key = `sk-ant-${"a".repeat(30)}`;
    const huge = "x".repeat(6 * 1024 * 1024);
    const r = handleHook(
      payload("PostToolUse", {
        tool_input: { command: `echo ${key}` },
        tool_response: { stdout: huge },
      }),
      ENV,
      NOW,
    );
    const json = JSON.stringify(r.event);
    expect(json).not.toContain(key);
    expect(json).toContain("[redacted]");
    expect(json.length).toBeLessThan(MAX_STRING + 1000);
    expect(r.event?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("unknown hooks and payloads without cwd are ignored", () => {
    login();
    setProjectState(repo, "on");
    expect(handleHook(payload("Bogus"), ENV, NOW).event).toBeNull();
    expect(
      handleHook({ hook_event_name: "Stop", session_id: "s1" }, ENV, NOW).event,
    ).toBeNull();
  });
});
