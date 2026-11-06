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

// Atomic: temp file in the same dir, then rename.
function writeJson(name: string, value: unknown, mode = 0o644): void {
  const dir = murmurDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(
    dir,
    `.${name}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, JSON.stringify(value), { mode });
  fs.renameSync(tmp, path.join(dir, name));
}

function projectKey(cwd: string): string {
  const start = path.resolve(cwd);
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return start;
  }
}

export function readCredentials(): Credentials | null {
  const c = readJson<Partial<Credentials> | null>("credentials.json", null);
  return c?.server && c.token && c.machineId ? (c as Credentials) : null;
}
export function writeCredentials(c: Credentials): void {
  writeJson("credentials.json", c, 0o600);
}
export function clearCredentials(): void {
  fs.rmSync(path.join(murmurDir(), "credentials.json"), { force: true });
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
