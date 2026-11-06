import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MapInput, NarrateInput } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { MID_SESSION_LINE, NARRATION_INSTRUCTION } from "../src/instruction.js";
import {
  clearCredentials,
  clearProjectPause,
  isPaused,
  projectKey,
  projectState,
  readCredentials,
  setPaused,
  setProjectState,
  writeCredentials,
} from "../src/local.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
  process.env.MURMUR_HOME = path.join(home, "murmur");
});

describe("local state", () => {
  it("credentials file is written 0600", () => {
    expect(readCredentials()).toBeNull();
    const c = { server: "http://x", token: "t", machineId: "m" };
    writeCredentials(c);
    const f = path.join(process.env.MURMUR_HOME as string, "credentials.json");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(f)).mode & 0o777).toBe(0o700);
    expect(readCredentials()).toEqual(c);
    clearCredentials();
    expect(readCredentials()).toBeNull();
  });

  it("malformed json is treated as empty", () => {
    fs.mkdirSync(process.env.MURMUR_HOME as string, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.MURMUR_HOME as string, "credentials.json"),
      "{nope",
    );
    expect(readCredentials()).toBeNull();
  });

  it("project state is keyed by git root", () => {
    const root = fs.mkdtempSync(path.join(home, "repo-"));
    fs.mkdirSync(path.join(root, ".git"));
    const sub = path.join(root, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    setProjectState(sub, "on");
    expect(projectState(root)).toBe("on");
    expect(projectState(path.join(root, "a"))).toBe("on");
    const plain = fs.mkdtempSync(path.join(home, "plain-"));
    expect(projectState(plain)).toBeUndefined();
    setProjectState(plain, "asked");
    expect(projectState(plain)).toBe("asked");
  });

  it("a git repo in the home folder is never the project", () => {
    const old = process.env.HOME;
    process.env.HOME = home;
    try {
      fs.mkdirSync(path.join(home, ".git"));
      const sub = path.join(home, "work", "app");
      fs.mkdirSync(sub, { recursive: true });
      setProjectState(sub, "on");
      expect(projectState(sub)).toBe("on");
      expect(projectState(home)).toBeUndefined();
      expect(projectState(path.join(home, "work"))).toBeUndefined();
      expect(projectKey(sub)).toBe(sub);
      expect(projectKey("/")).toBe("/");
    } finally {
      process.env.HOME = old;
    }
  });

  it("a worktree and its subfolders belong to the main repo, a submodule stays its own", () => {
    const main = fs.mkdtempSync(path.join(home, "main-"));
    fs.mkdirSync(path.join(main, ".git", "worktrees", "x"), {
      recursive: true,
    });
    const tree = path.join(main, ".claude", "worktrees", "x");
    fs.mkdirSync(path.join(tree, "src", "deep"), { recursive: true });
    fs.writeFileSync(
      path.join(tree, ".git"),
      `gitdir: ${path.join(main, ".git", "worktrees", "x")}\n`,
    );
    expect(projectKey(tree)).toBe(main);
    expect(projectKey(path.join(tree, "src", "deep"))).toBe(main);
    // A worktree outside the main repo, with a relative gitdir.
    const outside = fs.mkdtempSync(path.join(home, "wt-"));
    fs.writeFileSync(
      path.join(outside, ".git"),
      `gitdir: ${path.relative(outside, path.join(main, ".git", "worktrees", "x"))}\n`,
    );
    expect(projectKey(outside)).toBe(main);
    const sub = path.join(main, "vendor", "lib");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, ".git"),
      "gitdir: ../../.git/modules/lib\n",
    );
    expect(projectKey(path.join(sub))).toBe(sub);
    fs.writeFileSync(path.join(outside, ".git"), "not a gitdir line");
    expect(projectKey(outside)).toBe(outside);
    setProjectState(main, "on");
    expect(projectState(path.join(tree, "src"))).toBe("on");
  });

  it("pause round-trips by folder and by session", () => {
    const root = fs.mkdtempSync(path.join(home, "repo-"));
    fs.mkdirSync(path.join(root, ".git"));
    expect(isPaused(root, "s1")).toBe(false);
    setPaused(root, true, "s1");
    expect(isPaused(root, "s1")).toBe(true);
    expect(isPaused(root, "s2")).toBe(false);
    expect(isPaused(root)).toBe(false);
    setPaused(root, false, "s1");
    expect(isPaused(root, "s1")).toBe(false);
    setPaused(root, true);
    expect(isPaused(root, "s2")).toBe(true);
    clearProjectPause(root);
    expect(isPaused(root, "s2")).toBe(false);
  });

  it("instruction contains no em dash and both tool names", () => {
    expect(NARRATION_INSTRUCTION).not.toContain("—");
    expect(MID_SESSION_LINE).not.toContain("—");
    expect(NARRATION_INSTRUCTION).toContain("`map`");
    expect(NARRATION_INSTRUCTION).toContain("`narrate`");
  });

  it("instruction names every narrate trigger and carries a valid example", () => {
    for (const s of [
      "right after `map`",
      "after each batch of edits",
      "after each test or command result",
      'taskStatus "done"',
      "A task is not done until you narrate it done.",
    ])
      expect(NARRATION_INSTRUCTION).toContain(s);
    const example = (start: string) =>
      JSON.parse(
        NARRATION_INSTRUCTION.split("\n")
          .find((l) => l.trim().startsWith(start))
          ?.trim() ?? "",
      );
    expect(NarrateInput.safeParse(example('{"now"')).success).toBe(true);
    expect(MapInput.safeParse(example('{"kind"')).success).toBe(true);
  });
});
