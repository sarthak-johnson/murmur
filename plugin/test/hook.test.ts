import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAP_TOOL, MAX_STRING, NARRATE_TOOL } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { handleHook } from "../src/hook.js";
import { MID_SESSION_LINE } from "../src/instruction.js";
import {
  murmurDir,
  NARRATION_INSTRUCTION,
  projectState,
  readSession,
  setPaused,
  setProjectState,
  setRevoked,
  writeCredentials,
} from "../src/local.js";

const ask = (folder: string) =>
  `Murmur: show ${folder} in Murmur? Run /murmur:on to turn it on, or /murmur:off to stop asking.`;
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
    expect(JSON.parse(first.stdout)).toEqual({ systemMessage: ask(repo) });
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

  it("a disconnected machine queues nothing and says so at start", () => {
    login();
    setProjectState(repo, "on");
    setRevoked(true);
    expect(JSON.parse(handleHook(start(), ENV, NOW).stdout)).toEqual({
      systemMessage:
        "Murmur: this machine was disconnected. Run /murmur:login.",
    });
    expect(handleHook(start(), ENV, NOW).event).toBeNull();
    expect(handleHook(payload("Stop"), ENV, NOW)).toEqual({
      stdout: "",
      event: null,
    });
  });

  it("the ask line names the folder with home shown as ~", () => {
    const old = process.env.HOME;
    process.env.HOME = path.dirname(repo);
    try {
      const r = handleHook(start(), ENV, NOW);
      expect(JSON.parse(r.stdout).systemMessage).toBe(ask("~/repo"));
    } finally {
      process.env.HOME = old;
    }
  });

  it("unknown hooks and payloads without cwd are ignored", () => {
    login();
    setProjectState(repo, "on");
    expect(handleHook(payload("Bogus"), ENV, NOW).event).toBeNull();
    expect(
      handleHook({ hook_event_name: "Stop", session_id: "s1" }, ENV, NOW).event,
    ).toBeNull();
  });

  describe("Stop asks for the missing narration once per request", () => {
    const BLOCK = {
      decision: "block",
      reason:
        "Murmur: before you finish, call narrate to mark each finished task done and say what you did.",
    };
    const post = (tool: string, input: Record<string, unknown>) =>
      payload("PostToolUse", { tool_name: tool, tool_input: input });
    const map = () => post(MAP_TOOL, { kind: "feature", goal: "g" });
    const narrate = (task?: string, taskStatus?: string) =>
      post(NARRATE_TOOL, { now: "n", why: "w", task, taskStatus });
    const stop = (active = false) =>
      payload("Stop", { stop_hook_active: active });
    const run = (...ps: Record<string, unknown>[]) =>
      ps.map((p) => handleHook(p, ENV, NOW));
    beforeEach(() => {
      login();
      setProjectState(repo, "on");
    });

    it("blocks once when a mapped request never narrated, again after a new prompt", () => {
      const [, , first, second] = run(
        payload("UserPromptSubmit"),
        map(),
        stop(),
        stop(),
      );
      expect(JSON.parse(first?.stdout ?? "")).toEqual(BLOCK);
      expect(first?.event?.hook).toBe("Stop");
      expect(second?.stdout).toBe("");
      const [, , again] = run(payload("UserPromptSubmit"), map(), stop());
      expect(JSON.parse(again?.stdout ?? "")).toEqual(BLOCK);
    });

    it("blocks when a narrated task is not narrated done", () => {
      const [, , , r] = run(
        payload("UserPromptSubmit"),
        map(),
        narrate("t1", "running"),
        stop(),
      );
      expect(JSON.parse(r?.stdout ?? "")).toEqual(BLOCK);
    });

    it("stays quiet when narrate marked its tasks done", () => {
      const [, , , , , r] = run(
        payload("UserPromptSubmit"),
        map(),
        narrate("t1", "running"),
        narrate("t2", "done"),
        narrate("t1", "done"),
        stop(),
      );
      expect(r?.stdout).toBe("");
      const [, , , plain] = run(
        payload("UserPromptSubmit"),
        map(),
        narrate(),
        stop(),
      );
      expect(plain?.stdout).toBe("");
    });

    const mapTasks = (...ids: string[]) =>
      post(MAP_TOOL, {
        kind: "feature",
        goal: "g",
        phases: [
          { id: "p1", title: "P", tasks: ids.map((id) => ({ id, title: id })) },
        ],
      });

    it("blocks when a task declared by map is never narrated done", () => {
      const [, , , r] = run(
        payload("UserPromptSubmit"),
        mapTasks("t1", "t2"),
        narrate("t2", "done"),
        stop(),
      );
      expect(JSON.parse(r?.stdout ?? "")).toEqual(BLOCK);
    });

    it("stays quiet when every mapped task is narrated done, and a new map replaces the list", () => {
      const [, , , , r] = run(
        payload("UserPromptSubmit"),
        mapTasks("t1", "t2"),
        narrate("t1", "done"),
        narrate("t2", "done"),
        stop(),
      );
      expect(r?.stdout).toBe("");
      const [, , , , remapped] = run(
        payload("UserPromptSubmit"),
        mapTasks("t1", "t2"),
        mapTasks("t3"),
        narrate("t3", "done"),
        stop(),
      );
      expect(remapped?.stdout).toBe("");
    });

    it("stays quiet when stop_hook_active, with no map, or for other sessions", () => {
      const [, , active] = run(payload("UserPromptSubmit"), map(), stop(true));
      expect(active?.stdout).toBe("");
      const [, noMap] = run(payload("UserPromptSubmit"), stop());
      expect(noMap?.stdout).toBe("");
      run(payload("UserPromptSubmit"), map());
      const other = handleHook(payload("Stop", { session_id: "s2" }), ENV, NOW);
      expect(other.stdout).toBe("");
    });

    it("headless runs only gate when MURMUR_ALLOW_HEADLESS=1", () => {
      const headless = { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" };
      for (const p of [payload("UserPromptSubmit"), map()])
        handleHook(p, headless, NOW);
      expect(handleHook(stop(), headless, NOW).stdout).toBe("");
      const allowed = { ...headless, MURMUR_ALLOW_HEADLESS: "1" };
      for (const p of [payload("UserPromptSubmit"), map()])
        handleHook(p, allowed, NOW);
      expect(JSON.parse(handleHook(stop(), allowed, NOW).stdout)).toEqual(
        BLOCK,
      );
    });
  });

  describe("backfill of a session Murmur has not seen", () => {
    const TP = "/t/s1.jsonl";
    const prompt = (extra = {}) =>
      payload("UserPromptSubmit", {
        prompt: "hi",
        transcript_path: TP,
        ...extra,
      });

    it("the first event marks it pending with its own time as the cutoff, once", () => {
      login();
      setProjectState(repo, "on");
      const r = handleHook(prompt(), ENV, NOW);
      expect(r.backfill).toBe("s1");
      expect(r.event?.ts).toBe(NOW.toISOString());
      expect(readSession("s1")).toMatchObject({
        backfill: "pending",
        cutoff: NOW.toISOString(),
        transcriptPath: TP,
        cwd: repo,
        triggerPrompt: "hi",
      });
      const tool = payload("PreToolUse", { transcript_path: TP });
      expect(handleHook(tool, ENV, NOW).backfill).toBeUndefined();
      expect(handleHook(prompt(), ENV, NOW).backfill).toBeUndefined();
      expect(readSession("s1").backfill).toBe("pending");
      // Any first hook triggers it, here a resume, which names no prompt.
      const resume = payload("SessionStart", {
        source: "resume",
        session_id: "s2",
        transcript_path: TP,
      });
      expect(handleHook(resume, ENV, NOW).backfill).toBe("s2");
      expect(readSession("s2").triggerPrompt).toBeUndefined();
    });

    it("a startup SessionStart is a new session with nothing to import", () => {
      login();
      setProjectState(repo, "on");
      expect(handleHook(start(), ENV, NOW).backfill).toBeUndefined();
      expect(readSession("s1").backfill).toBe("done");
      expect(handleHook(prompt(), ENV, NOW).backfill).toBeUndefined();
    });

    it("a new prompt keeps the backfill state", () => {
      login();
      setProjectState(repo, "on");
      handleHook(prompt(), ENV, NOW);
      handleHook(payload("Stop"), ENV, NOW);
      handleHook(payload("SessionEnd"), ENV, NOW);
      expect(readSession("s1").backfill).toBe("pending");
      expect(handleHook(prompt(), ENV, NOW).backfill).toBeUndefined();
    });

    it("off, unset, logged-out, revoked, paused and headless sessions never backfill", () => {
      const none = () => handleHook(prompt(), ENV, NOW).backfill;
      expect(none()).toBeUndefined();
      setProjectState(repo, "off");
      login();
      expect(none()).toBeUndefined();
      setProjectState(repo, "on");
      setRevoked(true);
      expect(none()).toBeUndefined();
      setRevoked(false);
      setPaused(repo, true, "s1");
      expect(none()).toBeUndefined();
      // History from a paused stretch is never imported later either.
      setPaused(repo, false, "s1");
      expect(none()).toBeUndefined();
      const headless = { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" };
      const s3 = prompt({ session_id: "s3" });
      expect(handleHook(s3, headless, NOW).backfill).toBeUndefined();
      expect(
        handleHook(s3, { ...headless, MURMUR_ALLOW_HEADLESS: "1" }, NOW)
          .backfill,
      ).toBe("s3");
    });

    it("logged out sends nothing and leaves the session unseen", () => {
      setProjectState(repo, "on");
      expect(handleHook(prompt(), ENV, NOW).backfill).toBeUndefined();
      login();
      expect(handleHook(prompt(), ENV, NOW).backfill).toBe("s1");
    });

    it("live tool and subagent events get the ids the backfill gives them, prompts do not", () => {
      login();
      setProjectState(repo, "on");
      // prompt_id is shared by many prompts in a real session.
      const a = handleHook(prompt({ prompt_id: "p1" }), ENV, NOW).event?.id;
      const b = handleHook(prompt({ prompt_id: "p1" }), ENV, NOW).event?.id;
      expect(a).not.toBe(b);
      const pre = (id: string) =>
        handleHook(payload("PreToolUse", { tool_use_id: id }), ENV, NOW).event
          ?.id;
      expect(pre("toolu_1")).toBe(pre("toolu_1"));
      expect(pre("toolu_1")).not.toBe(pre("toolu_2"));
      const stop = () => handleHook(payload("Stop"), ENV, NOW).event?.id;
      expect(stop()).not.toBe(stop());
    });
  });

  describe("backfill edge cases", () => {
    const TP = "/t/s1.jsonl";
    const prompt = (extra = {}) =>
      payload("UserPromptSubmit", {
        prompt: "hi",
        transcript_path: TP,
        ...extra,
      });

    it("a session seen while its project was off is never imported, one never asked about is", () => {
      login();
      setProjectState(repo, "off");
      expect(handleHook(prompt(), ENV, NOW).event).toBeNull();
      expect(readSession("s1").backfill).toBe("done");
      setProjectState(repo, "on");
      expect(handleHook(prompt(), ENV, NOW).backfill).toBeUndefined();

      const other = path.join(path.dirname(repo), "other");
      fs.mkdirSync(path.join(other, ".git"), { recursive: true });
      const s2 = { ...prompt(), session_id: "s2", cwd: other };
      expect(handleHook(s2, ENV, NOW).event).toBeNull();
      setProjectState(other, "on");
      expect(handleHook(s2, ENV, NOW).backfill).toBe("s2");
    });

    it("a backfill stuck for over 10 minutes starts again", () => {
      login();
      setProjectState(repo, "on");
      handleHook(prompt(), ENV, NOW);
      const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
      const tool = payload("PreToolUse");
      // Pending, and its child never ran.
      expect(handleHook(tool, ENV, later(5)).backfill).toBeUndefined();
      expect(handleHook(tool, ENV, later(11)).backfill).toBe("s1");
      const s = readSession("s1");
      fs.writeFileSync(
        path.join(murmurDir(), "sessions", "s1.json"),
        JSON.stringify({
          ...s,
          backfill: "running",
          runningSince: later(20).toISOString(),
        }),
      );
      expect(handleHook(tool, ENV, later(25)).backfill).toBeUndefined();
      expect(handleHook(tool, ENV, later(31)).backfill).toBe("s1");
      fs.writeFileSync(
        path.join(murmurDir(), "sessions", "s1.json"),
        JSON.stringify({ ...s, backfill: "done" }),
      );
      expect(handleHook(tool, ENV, later(60)).backfill).toBeUndefined();
    });

    it("a startup SessionStart deletes session state idle for over 100 days, past server retention", () => {
      login();
      setProjectState(repo, "on");
      for (const id of ["old", "recent"])
        handleHook(payload("Stop", { session_id: id }), ENV, NOW);
      const file = (id: string) =>
        path.join(murmurDir(), "sessions", `${id}.json`);
      const day = 24 * 3600 * 1000;
      const at = (d: number) => new Date(NOW.getTime() - d * day);
      fs.utimesSync(file("old"), at(101), at(101));
      fs.utimesSync(file("recent"), at(95), at(95));
      handleHook(start("resume"), ENV, NOW);
      expect(fs.existsSync(file("old"))).toBe(true);
      handleHook(start(), ENV, NOW);
      expect(fs.existsSync(file("old"))).toBe(false);
      expect(fs.existsSync(file("recent"))).toBe(true);
      expect(fs.existsSync(file("s1"))).toBe(true);
    });
  });

  describe("narration instruction from the next prompt", () => {
    const UPS_INSTRUCTION = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `${MID_SESSION_LINE}\n${NARRATION_INSTRUCTION}`,
      },
    };

    it("a session that missed SessionStart gets it once on its next prompt", () => {
      login();
      setProjectState(repo, "on");
      const first = handleHook(payload("UserPromptSubmit"), ENV, NOW);
      expect(JSON.parse(first.stdout)).toEqual(UPS_INSTRUCTION);
      expect(first.event?.hook).toBe("UserPromptSubmit");
      expect(handleHook(payload("UserPromptSubmit"), ENV, NOW).stdout).toBe("");
      expect(readSession("s1").instructed).toBe(true);
    });

    it("never after SessionStart injected it, never for off projects", () => {
      login();
      setProjectState(repo, "on");
      handleHook(start("resume"), ENV, NOW);
      expect(handleHook(payload("UserPromptSubmit"), ENV, NOW).stdout).toBe("");
      setProjectState(repo, "off");
      const other = payload("UserPromptSubmit", { session_id: "s2" });
      expect(handleHook(other, ENV, NOW)).toEqual({ stdout: "", event: null });
    });
  });

  describe("on and off follow the session", () => {
    let tree: string;
    let plain: string;
    let other: string;
    beforeEach(() => {
      // The author's layout: a worktree inside the main repo, its .git a file.
      const gitdir = path.join(repo, ".git", "worktrees", "lit-plate");
      fs.mkdirSync(gitdir, { recursive: true });
      tree = path.join(repo, ".claude", "worktrees", "lit-plate");
      fs.mkdirSync(path.join(tree, "src"), { recursive: true });
      fs.writeFileSync(path.join(tree, ".git"), `gitdir: ${gitdir}\n`);
      plain = path.join(path.dirname(repo), "scratch");
      fs.mkdirSync(plain);
      other = path.join(path.dirname(repo), "other");
      fs.mkdirSync(path.join(other, ".git"), { recursive: true });
      login();
      setProjectState(repo, "on");
      setProjectState(other, "off");
    });
    const tool = (cwd: string, extra = {}) =>
      handleHook(payload("PreToolUse", { cwd, ...extra }), ENV, NOW).event;

    it("a session seen in an on project keeps sending from its worktree and other folders, not from an off project", () => {
      expect(
        handleHook(payload("UserPromptSubmit", { prompt: "hi" }), ENV, NOW)
          .event,
      ).not.toBeNull();
      expect(readSession("s1").project).toBe(repo);
      expect(tool(tree)?.cwd).toBe(tree);
      expect(tool(path.join(tree, "src"))?.hook).toBe("PreToolUse");
      expect(tool(plain)?.cwd).toBe(plain);
      expect(tool(other)).toBeNull();
      expect(projectState(plain)).toBeUndefined();
      // Another session never seen in an on project keeps today's rule.
      expect(tool(plain, { session_id: "s2" })).toBeNull();
      expect(readSession("s1").project).toBe(repo);
    });

    it("turning the project off later stops the rest of the session", () => {
      handleHook(payload("UserPromptSubmit", { prompt: "hi" }), ENV, NOW);
      expect(tool(tree)).not.toBeNull();
      setProjectState(tree, "off");
      expect(projectState(repo)).toBe("off");
      expect(tool(tree)).toBeNull();
      expect(tool(plain)).toBeNull();
      expect(tool(repo)).toBeNull();
    });

    it("a session first seen in an unset folder asks once and sends nothing", () => {
      const first = payload("SessionStart", { source: "startup", cwd: plain });
      expect(JSON.parse(handleHook(first, ENV, NOW).stdout)).toEqual({
        systemMessage: ask(plain),
      });
      expect(tool(plain)).toBeNull();
      expect(readSession("s1").project).toBeUndefined();
    });

    it("a session already imported is bound but not imported again", () => {
      fs.mkdirSync(path.join(murmurDir(), "sessions"), { recursive: true });
      fs.writeFileSync(
        path.join(murmurDir(), "sessions", "s1.json"),
        JSON.stringify({
          backfill: "done",
          cutoff: NOW.toISOString(),
          instructed: true,
        }),
      );
      const r = handleHook(
        payload("PreToolUse", { cwd: tree, transcript_path: "/t/s1.jsonl" }),
        ENV,
        NOW,
      );
      expect(r.event?.cwd).toBe(tree);
      expect(r.backfill).toBeUndefined();
      expect(readSession("s1")).toMatchObject({
        backfill: "done",
        project: repo,
      });
    });

    it("the instruction on a prompt mid-session asks for a map first, SessionStart's does not", () => {
      const ups = handleHook(payload("UserPromptSubmit"), ENV, NOW);
      const text = JSON.parse(ups.stdout).hookSpecificOutput.additionalContext;
      expect(text).toBe(`${MID_SESSION_LINE}\n${NARRATION_INSTRUCTION}`);
      expect(MID_SESSION_LINE).toBe(
        "This session was already under way. Call `map` now for the work in progress, then narrate as below.",
      );
      const s = handleHook(start("resume"), ENV, NOW);
      expect(JSON.parse(s.stdout).hookSpecificOutput.additionalContext).toBe(
        NARRATION_INSTRUCTION,
      );
    });
  });

  it("Stop and UserPromptSubmit are synchronous hooks so their output reaches Claude", () => {
    const hooks = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, "../hooks/hooks.json"),
        "utf8",
      ),
    ).hooks;
    for (const name of ["Stop", "UserPromptSubmit"]) {
      expect(hooks[name]).toHaveLength(1);
      expect(hooks[name][0].matcher).toBeUndefined();
      expect(hooks[name][0].hooks).toEqual([
        { type: "command", command: hooks.SessionStart[0].hooks[0].command },
      ]);
    }
  });
});
