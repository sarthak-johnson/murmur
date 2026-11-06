import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export { NARRATION_INSTRUCTION } from "./instruction.js";

export type ProjectState = "on" | "off" | "asked";
export interface Credentials {
  server: string;
  token: string;
  machineId: string;
}
interface Paused {
  sessions: string[];
  projects: string[];
}

export const DEFAULT_SERVER: string =
  process.env.MURMUR_SERVER ?? "http://localhost:8787";

export function murmurDir(): string {
  if (process.env.MURMUR_HOME) return process.env.MURMUR_HOME;
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "murmur");
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const v: unknown = JSON.parse(
      fs.readFileSync(path.join(murmurDir(), name), "utf8"),
    );
    return v !== null && typeof v === "object" ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

// Atomic: temp file in the same dir, then rename. `name` may hold one subfolder.
function writeJson(name: string, value: unknown, mode = 0o644): void {
  const file = path.join(murmurDir(), name);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, JSON.stringify(value), { mode });
  fs.renameSync(tmp, file);
}

/**
 * The git root above `cwd`, or `cwd` itself. Never the home folder or `/`, so a
 * dotfiles repo in ~ cannot turn on every project under it.
 */
export function projectKey(cwd: string): string {
  const start = path.resolve(cwd);
  const home = path.resolve(os.homedir());
  for (let d = start; path.dirname(d) !== d; d = path.dirname(d))
    if (d !== home && fs.existsSync(path.join(d, ".git"))) return d;
  return start;
}

/** The project folder as people read it: home shown as ~. */
export function projectName(cwd: string): string {
  const key = projectKey(cwd);
  const home = path.resolve(os.homedir());
  return key.startsWith(`${home}${path.sep}`)
    ? `~${key.slice(home.length)}`
    : key;
}

export function readCredentials(): Credentials | null {
  const c = readJson<Partial<Credentials> | null>("credentials.json", null);
  return c?.server && c.token && c.machineId ? (c as Credentials) : null;
}
export function writeCredentials(c: Credentials): void {
  writeJson("credentials.json", c, 0o600);
  setRevoked(false);
}
export function clearCredentials(): void {
  fs.rmSync(path.join(murmurDir(), "credentials.json"), { force: true });
  setRevoked(false);
}

// Written when the server answers 401: the token was revoked, so nothing is queued
// or sent until the next login.
const revokedFile = () => path.join(murmurDir(), "revoked");
export function isRevoked(): boolean {
  return fs.existsSync(revokedFile());
}
export function setRevoked(on: boolean): void {
  if (!on) {
    fs.rmSync(revokedFile(), { force: true });
    return;
  }
  fs.mkdirSync(murmurDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(revokedFile(), "");
}

export const queueDir = (): string => path.join(murmurDir(), "queue");
export function clearQueue(): void {
  fs.rmSync(queueDir(), { recursive: true, force: true });
}
/** Deletes queued events whose cwd belongs to the project at `cwd`. */
export function dropQueued(cwd: string): void {
  const key = projectKey(cwd);
  let names: string[] = [];
  try {
    names = fs.readdirSync(queueDir());
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(queueDir(), name);
    try {
      const e = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof e?.cwd === "string" && projectKey(e.cwd) === key)
        fs.rmSync(file, { force: true });
    } catch {}
  }
}

export function projectState(cwd: string): ProjectState | undefined {
  return readJson<Record<string, ProjectState>>("projects.json", {})[
    projectKey(cwd)
  ];
}
export function setProjectState(cwd: string, s: ProjectState): void {
  const all = readJson<Record<string, ProjectState>>("projects.json", {});
  all[projectKey(cwd)] = s;
  writeJson("projects.json", all);
}

function readPaused(): Paused {
  const p = readJson<Partial<Paused>>("paused.json", {});
  return {
    sessions: Array.isArray(p.sessions) ? p.sessions : [],
    projects: Array.isArray(p.projects) ? p.projects : [],
  };
}
export function isPaused(cwd: string, sessionId?: string): boolean {
  const p = readPaused();
  return (
    p.projects.includes(projectKey(cwd)) ||
    (!!sessionId && p.sessions.includes(sessionId))
  );
}
export function setPaused(
  cwd: string,
  paused: boolean,
  sessionId?: string,
): void {
  const p = readPaused();
  const list = sessionId ? p.sessions : p.projects;
  const key = sessionId ?? projectKey(cwd);
  const next = list.filter((k) => k !== key);
  if (paused) next.push(key);
  if (sessionId) p.sessions = next;
  else p.projects = next;
  writeJson("paused.json", p);
}
export function clearProjectPause(cwd: string): void {
  setPaused(cwd, false);
}

/** What the current request has reported so far, for the Stop hook. */
export interface Narration {
  mapped: boolean;
  /** Task ids the latest map declared. */
  tasks: string[];
  narrates: number;
  /** Task ids named by narrate, and those whose latest narrate said done. */
  named: string[];
  done: string[];
  /** The Stop block went out for this request. */
  blocked: boolean;
}
const narrationFile = (sessionId: string) =>
  path.join("sessions", `${sessionId.replace(/[^\w-]/g, "_")}.json`);
export const NO_NARRATION: Narration = {
  mapped: false,
  tasks: [],
  narrates: 0,
  named: [],
  done: [],
  blocked: false,
};
export function readNarration(sessionId: string): Narration {
  return {
    ...NO_NARRATION,
    ...readJson<Partial<Narration>>(narrationFile(sessionId), {}),
  };
}
export function writeNarration(sessionId: string, n: Narration): void {
  writeJson(narrationFile(sessionId), n);
}
export function clearNarration(sessionId: string): void {
  fs.rmSync(path.join(murmurDir(), narrationFile(sessionId)), { force: true });
}
