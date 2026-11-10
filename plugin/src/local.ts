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

// docs/hook-facts.md section 6. Other entrypoints (cli, IDE extensions, desktop)
// are interactive and must upload.
export function isHeadless(env: NodeJS.ProcessEnv): boolean {
  return (
    (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk") ||
    env.CLAUDE_CODE_SESSION_ATTENDED === "0"
  );
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
    if (d !== home && fs.existsSync(path.join(d, ".git")))
      return worktreeMain(d) ?? d;
  return start;
}

/**
 * The main repo of the git worktree at `root`, whose .git file points into
 * <main>/.git/worktrees/<name>. A submodule's .git file points elsewhere: undefined.
 */
function worktreeMain(root: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, ".git"), "utf8");
  } catch {
    return undefined; // a .git folder
  }
  const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (!gitdir) return undefined;
  const worktrees = path.dirname(path.resolve(root, gitdir));
  const dotGit = path.dirname(worktrees);
  const main = path.dirname(dotGit);
  const home = path.resolve(os.homedir());
  if (
    path.basename(worktrees) !== "worktrees" ||
    path.basename(dotGit) !== ".git" ||
    main === home ||
    path.dirname(main) === main ||
    !isDir(dotGit)
  )
    return undefined;
  // Git writes the real path; keep the spelling `on` would store when run at the main
  // root through a symlink (macOS /var is /private/var).
  const real = realpath(main);
  if (real === realpath(home)) return undefined; // home reached through a symlink
  for (let d = root; path.dirname(d) !== d; d = path.dirname(d))
    if (realpath(d) === real) return d;
  // ponytail: a worktree outside its repo, reached through a symlink, keeps git's real
  // spelling; a session that starts there asks once. Map via realpath of both if it bites.
  return main;
}
function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
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

const projects = () =>
  readJson<Record<string, ProjectState>>("projects.json", {});
export function projectState(cwd: string): ProjectState | undefined {
  return projects()[projectKey(cwd)];
}
/**
 * What decides whether an event of `sessionId` at `cwd` goes: the state of the project
 * at `cwd` when it has one (asked, on or off); in a folder with no state, once the
 * session is bound to a project, that project's state.
 */
export function sessionProjectState(
  cwd: string,
  sessionId: string | undefined,
): ProjectState | undefined {
  const here = projectState(cwd);
  const bound = sessionId ? readSession(sessionId).project : undefined;
  return here !== undefined || !bound ? here : projects()[bound];
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
/** Everything Murmur keeps per session, in sessions/<id>.json. */
export interface SessionState extends Narration {
  /** Import of the history from before Murmur first saw the session. */
  backfill?: "pending" | "running" | "done";
  /** Only transcript entries older than this go in the backfill. */
  cutoff?: string;
  /** The hook that set the cutoff (`SessionStart:<source>` for a start). */
  triggerHook?: string;
  /** The prompt, when a UserPromptSubmit set the cutoff. */
  triggerPrompt?: string;
  transcriptPath?: string;
  cwd?: string;
  /** When the backfill last started, or was last handed to a new child. */
  runningSince?: string;
  /**
   * Byte offset in the transcript up to which Claude's text was read live (or skipped,
   * while off or paused). Unset after a backfill: the first read starts at its cutoff.
   */
  textOffset?: number;
  /** Imported requests (by id) the recap already asked about, whatever came back. */
  recapped?: string[];
  /** Where the refresh state was kept before it had its own file (`readRefresh`). */
  refresh?: RefreshState;
  /** The narration instruction reached Claude in this session. */
  instructed?: boolean;
  /**
   * The project key the session was first seen in while it was on, or where /murmur:on
   * ran in it. Its events follow this project's state, wherever the session moves.
   */
  project?: string;
}
/**
 * Where the refresh of a session's live plan stands (recap.ts `runRefresh`), in
 * sessions/<id>.refresh.json, so the hook's whole-file rewrites of the session file
 * never drop it.
 */
export interface RefreshState {
  /** When a child last looked; none looks again within 5 minutes, so one runs at a time. */
  checked: string;
  /** When the session was last asked about (any request, at most once per 30 minutes). */
  tried?: string;
  /** Each request asked about, by request id. */
  requests?: Record<string, RequestRefresh>;
  /** Before per-request state: the one request last asked about, as `RequestRefresh`. */
  request?: string;
  at?: string;
  tasks?: Record<string, string>;
}
/** What the refresh did for one request. */
export interface RequestRefresh {
  /** When it was last asked about. */
  tried?: string;
  /** Asked about once after a later request began: never again. */
  final?: boolean;
  /** When the last answer's events are timed, and every task status then. */
  at?: string;
  tasks?: Record<string, string>;
}
const sessionFile = (sessionId: string) =>
  path.join("sessions", `${sessionId.replace(/[^\w-]/g, "_")}.json`);
const refreshFile = (sessionId: string) =>
  sessionFile(sessionId).replace(/\.json$/, ".refresh.json");
export function readRefresh(sessionId: string): RefreshState | undefined {
  const r = readJson<Partial<RefreshState> | null>(
    refreshFile(sessionId),
    null,
  );
  if (r && typeof r.checked === "string") return r as RefreshState;
  // Kept in the session file before it had its own.
  return readSession(sessionId).refresh;
}
export function writeRefresh(sessionId: string, r: RefreshState): void {
  writeJson(refreshFile(sessionId), r);
}
/** Forgets every refresh of a session: a history import gives the server none of them. */
export function clearRefresh(sessionId: string): void {
  fs.rmSync(path.join(murmurDir(), refreshFile(sessionId)), { force: true });
  const { refresh: _, ...rest } = readSession(sessionId);
  if (_) writeSession(sessionId, rest);
}
/**
 * What the titles runs of a session did (titles.ts `runTitles`), in
 * sessions/<id>.titles.json. Requests by key (core's `requestKeys`).
 */
export interface TitlesState {
  /** When the session was last asked about: at most once every 10 minutes. */
  at?: string;
  /** The requests no run had covered at that ask: a new run needs one not among them. */
  tried?: string[];
  /** What a run said of each request it covered: the next run's context. */
  covered?: Record<string, { short: string; goal: string; thread: string }>;
  /** Every storyline named so far, by id, so the next run keeps their ids. */
  threads?: Record<string, string>;
}
const titlesFile = (sessionId: string) =>
  sessionFile(sessionId).replace(/\.json$/, ".titles.json");
export function readTitles(sessionId: string): TitlesState {
  return readJson<TitlesState>(titlesFile(sessionId), {});
}
export function writeTitles(sessionId: string, t: TitlesState): void {
  writeJson(titlesFile(sessionId), t);
}
/** Forgets every titles run of a session: a history import gives the server none of them. */
export function clearTitles(sessionId: string): void {
  fs.rmSync(path.join(murmurDir(), titlesFile(sessionId)), { force: true });
}
export const NO_NARRATION: Narration = {
  mapped: false,
  tasks: [],
  narrates: 0,
  named: [],
  done: [],
  blocked: false,
};
/**
 * A session no hook has seen yet. /murmur:on may already have bound it to a project;
 * every hook that sees a session sets `backfill`. A file that cannot be read counts as
 * seen: importing again would resend prompts the server cannot dedupe.
 */
export function isNewSession(sessionId: string): boolean {
  if (!fs.existsSync(path.join(murmurDir(), sessionFile(sessionId))))
    return true;
  const s = readJson<Partial<SessionState> | null>(
    sessionFile(sessionId),
    null,
  );
  return s !== null && s.backfill === undefined;
}
export function readSession(sessionId: string): SessionState {
  return {
    ...NO_NARRATION,
    ...readJson<Partial<SessionState>>(sessionFile(sessionId), {}),
  };
}
export function writeSession(sessionId: string, s: SessionState): void {
  writeJson(sessionFile(sessionId), s);
}
// Past the server's 90-day default retention, so a session resumed while the server
// still has it is never imported twice.
const SESSION_DAYS = 100;
/** Deletes the state of sessions idle for over 100 days. */
export function pruneSessions(now: Date): void {
  const dir = path.join(murmurDir(), "sessions");
  const oldest = now.getTime() - SESSION_DAYS * 24 * 3600 * 1000;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < oldest) fs.rmSync(file, { force: true });
    } catch {}
  }
}
/**
 * Moves a session's live text start (`textOffset`) to its transcript's current size, so
 * what Claude wrote up to now is never sent. Called wherever Murmur sends nothing (headless,
 * logged out, disconnected, off, paused) and when that ends (/murmur:on, resume, login).
 * Only for a session on record; a stat, never a read.
 */
export function skipText(sessionId: string, transcriptPath?: unknown): void {
  if (isNewSession(sessionId)) return;
  const s = readSession(sessionId);
  // The transcript the live read uses, else the one this hook names.
  const file =
    s.transcriptPath ??
    (typeof transcriptPath === "string" && transcriptPath
      ? transcriptPath
      : undefined);
  if (!file) return;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (s.textOffset !== size) updateSession(sessionId, { textOffset: size });
}

export function updateSession(
  sessionId: string,
  patch: Partial<SessionState>,
): void {
  writeSession(sessionId, { ...readSession(sessionId), ...patch });
}
