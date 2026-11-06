import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NARRATION_INSTRUCTION } from "../src/instruction.js";
import {
  clearCredentials,
  clearProjectPause,
  isPaused,
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
    expect(NARRATION_INSTRUCTION).toContain("`map`");
    expect(NARRATION_INSTRUCTION).toContain("`narrate`");
  });
});
