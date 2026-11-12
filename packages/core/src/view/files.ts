/*
 * Files touched, from successful Edit and Write calls, and Bash calls whose result has a
 * `bashEditDiff` (a command that changed files: `sed -i`, `python3 -`, `cp`), PostToolUse only.
 * - Counts are the `+` and `-` lines of `tool_response.structuredPatch`; a Write with
 *   `type: "create"` and an empty patch counts its content lines as added. A Bash diff
 *   counts each file's hunk lines the same way; a file whose only hunk starts at line 0
 *   of 0 lines is new.
 * - A helper's touch goes to the part that helper narrated latest before it, else first
 *   after it (the recap narrates for each helper it puts on a part), else the helper's own
 *   part (`AgentView.part`), else the part of a narrate naming the path (as below), else
 *   `looseFiles`: never to the part the main thread narrated last. The helper lists the
 *   path in its `files` too.
 * - Any other touch goes to the part of the latest narrate before it naming the path in
 *   `files`, else the first such narrate after it, else the latest narrate before it, else
 *   `looseFiles`.
 * - One entry per path per part: counts add up, `isNew` if any touch created the file.
 * - Narrate's role-only entries take a touch's counts, and are dropped if none arrives.
 * - A Bash diff is the whole working tree's change while the command ran, so a file in
 *   it is the command's own only by `bashCredit`: another's goes to whoever claims it,
 *   one nobody can be sure of goes to the request's `looseFiles`, never to a helper.
 */
import type { MurmurEvent } from "../events.js";
import { addOnce, relPath, type Trace } from "./requests.js";
import type { AgentView, FileTouch, RequestView } from "./types.js";

type Touch = Omit<FileTouch, "role">;

export function applyFiles(
  req: RequestView,
  events: MurmurEvent[],
  { before, narrated }: Trace,
  agents: Map<string, AgentView> = new Map(),
  credit: Credit = bashCredit(events),
): void {
  const naming = new Map<string, Trace["narrated"]>();
  for (const x of narrated)
    for (const f of x.n.files ?? []) {
      const path = relPath(f.path, x.e.cwd);
      naming.set(path, [...(naming.get(path) ?? []), x]);
    }
  const helpers = new Map<string, Trace["narrated"]>();
  for (const x of narrated) {
    const id = x.e.payload.agent_id;
    if (typeof id === "string" && id && x.part)
      helpers.set(id, [...(helpers.get(id) ?? []), x]);
  }
  const near = (list: Trace["narrated"], i: number) =>
    list.findLast((x) => x.i < i) ?? list.find((x) => x.i > i);
  events.forEach((e, i) => {
    for (const t of touchesOf(e)) {
      const c = credit(e, t.path);
      if (c === "loose") addTouch(req.looseFiles, t);
      else if (c === "own") addAt(t, i, String(e.payload.agent_id ?? ""));
    }
  });
  function addAt(t: Touch, i: number, agentId: string) {
    const agent = agentId ? agents.get(agentId) : undefined;
    if (agent) {
      agent.files ??= [];
      addOnce(agent.files, t.path);
      agent.touches ??= [];
      addTouch(agent.touches, t);
    }
    const said = () => near(naming.get(t.path) ?? [], i)?.part;
    // A helper's change never goes where the main thread happened to be.
    const partId = agentId
      ? (near(helpers.get(agentId) ?? [], i)?.part ?? agent?.part ?? said())
      : (said() ?? before[i]?.part);
    const part = req.parts.find((p) => p.id === partId);
    addTouch(part ? part.files : req.looseFiles, t);
  }
  for (const p of req.parts) p.files = p.files.filter((f) => f.eventIds.length);
}

/**
 * Whose a file in a call's change is: "own" (the caller's), "other" (another writer's,
 * who has it from their own call) or "loose" (no one's for sure: the request's).
 */
export type Credit = (
  e: MurmurEvent,
  path: string,
) => "own" | "other" | "loose";

const WRITES = new Set(["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const NAME_CHAR = /[\w.-]/;
/** `s` in `text` as a whole path piece: not inside a longer name (`page.js` in `page.json`). */
function hasPiece(text: string, s: string): boolean {
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) {
    const after = text.slice(i + s.length, i + s.length + 2);
    if (!NAME_CHAR.test(text[i - 1] ?? "") && !/^(?:[\w-]|\.\w)/.test(after))
      return true;
  }
  return false;
}
/** The command names the file by a path of at least its folder and name. */
const namesPath = (cmd: string, path: string) => {
  const parts = path.split("/");
  return parts.length > 1 && hasPiece(cmd, parts.slice(-2).join("/"));
};
const commandOf = (e: MurmurEvent) => {
  const c = (e.payload.tool_input as { command?: unknown } | undefined)
    ?.command;
  return typeof c === "string" ? c : "";
};

/**
 * Whose each file of a Bash diff is. Edit, Write and every other call change only their
 * own files. A Bash diff is the working tree's change while the command ran, helpers'
 * and the main thread's alike, so for each file in it, first match wins:
 * 1. own: the command names it by folder and name (`contracts/screenerPage.js`);
 * 2. own: no other writer (helper or the main thread) had an Edit, Write or Bash call
 *    open meanwhile, so the change was the command's however it made it (`npm run
 *    format`, `biome --write .`, `sed -i` on a glob, a codemod, `git checkout -- .`);
 * 3. own: the caller surely changed it elsewhere: its own Edit or Write of it, or another
 *    of its commands that named it as in 1 and changed it;
 * 4. other: a writer open meanwhile surely changed it so (it has the file from that call);
 * 5. own: the command names its file name alone (`cd contracts; sed -i x page.js`), and no
 *    other file in the diff has that name (`index.ts` in two folders says nothing);
 * 6. loose.
 */
export function bashCredit(events: MurmurEvent[]): Credit {
  const who = (e: MurmurEvent) => String(e.payload.agent_id ?? "");
  const opened = new Map<string, number>();
  const calls: { who: string; from: number; to: number }[] = [];
  // What each writer surely changed: its Edits and Writes, and the files its commands
  // named whose diff had them. Naming alone (a `cat`, a test run) claims nothing.
  const claims = new Map<string, Set<string>>();
  for (const e of events) {
    const tool = e.payload.tool_name;
    if (typeof tool !== "string" || !WRITES.has(tool)) continue;
    const w = who(e);
    const use = String(e.payload.tool_use_id ?? e.id);
    const ms = Date.parse(e.ts);
    if (e.hook === "PreToolUse") opened.set(use, ms);
    else if (e.hook === "PostToolUse" || e.hook === "PostToolUseFailure")
      calls.push({ who: w, from: opened.get(use) ?? ms, to: ms });
    const cmd = commandOf(e);
    for (const t of touchesOf(e))
      if (tool !== "Bash" || namesPath(cmd, t.path)) {
        const c = claims.get(w) ?? new Set();
        claims.set(w, c.add(t.path));
      }
  }
  const claimed = (w: string, path: string) => !!claims.get(w)?.has(path);
  // The other writers with a call open while `e` ran, once per event: calls by start,
  // so only those starting within the longest call's length before it are looked at.
  calls.sort((a, b) => a.from - b.from);
  const longest = calls.reduce((m, c) => Math.max(m, c.to - c.from), 0);
  const seen = new Map<string, Set<string>>();
  const othersOf = (e: MurmurEvent): Set<string> => {
    const known = seen.get(e.id);
    if (known) return known;
    const w = who(e);
    const to = Date.parse(e.ts);
    const from = opened.get(String(e.payload.tool_use_id ?? e.id)) ?? to;
    let hi = calls.length;
    for (let lo = 0; lo < hi; ) {
      const mid = (lo + hi) >> 1;
      if ((calls[mid] as (typeof calls)[number]).from <= to) lo = mid + 1;
      else hi = mid;
    }
    const out = new Set<string>();
    for (let k = hi - 1; k >= 0; k--) {
      const c = calls[k] as (typeof calls)[number];
      if (c.from < from - longest) break;
      if (c.who !== w && c.to >= from) out.add(c.who);
    }
    seen.set(e.id, out);
    return out;
  };
  return (e, path) => {
    if (e.payload.tool_name !== "Bash") return "own";
    const cmd = commandOf(e);
    if (namesPath(cmd, path)) return "own";
    const others = othersOf(e);
    if (!others.size || claimed(who(e), path)) return "own";
    if ([...others].some((o) => claimed(o, path))) return "other";
    const name = path.split("/").pop() ?? path;
    const same = touchesOf(e).filter(
      (t) => t.path.endsWith(`/${name}`) || t.path === name,
    );
    return same.length === 1 && hasPiece(cmd, name) ? "own" : "loose";
  };
}

/** Adds a touch to `files`, summing into the entry for the same path. */
export function addTouch(files: FileTouch[], t: Touch): void {
  const file = files.find((f) => f.path === t.path);
  if (!file) files.push({ ...t, eventIds: [...t.eventIds] });
  else {
    file.added += t.added;
    file.removed += t.removed;
    file.isNew ||= t.isNew;
    file.eventIds.push(...t.eventIds);
  }
}

const hunkLines = (hunks: unknown): unknown[] =>
  Array.isArray(hunks)
    ? hunks.flatMap((h) =>
        Array.isArray(h?.lines) ? (h.lines as unknown[]) : [],
      )
    : [];
const counter = (lines: unknown[]) => (c: string) =>
  lines.filter((l) => typeof l === "string" && l.startsWith(c)).length;

/** Every file a successful call changed, with its counts. */
export function touchesOf(e: MurmurEvent): Touch[] {
  const { tool_name: tool, tool_response: res } = e.payload;
  if (e.hook !== "PostToolUse" || !res || typeof res !== "object") return [];
  const r = res as Record<string, unknown>;
  if (tool === "Edit" || tool === "Write") {
    const t = editTouch(e, r);
    return t ? [t] : [];
  }
  if (tool !== "Bash") return [];
  const diff = r.bashEditDiff as { files?: unknown } | undefined;
  const files = Array.isArray(diff?.files) ? diff.files : [];
  return files.flatMap((f: Record<string, unknown> | null) => {
    if (typeof f?.filePath !== "string") return [];
    const count = counter(hunkLines(f.hunks));
    const hunks = Array.isArray(f.hunks) ? f.hunks : [];
    const isNew =
      hunks.length === 1 &&
      hunks[0]?.oldStart === 0 &&
      hunks[0]?.oldLines === 0;
    return [
      {
        path: relPath(f.filePath, e.cwd),
        added: count("+"),
        removed: count("-"),
        isNew,
        eventIds: [e.id],
      },
    ];
  });
}

function editTouch(
  e: MurmurEvent,
  r: Record<string, unknown>,
): Touch | undefined {
  if (typeof r.filePath !== "string") return;
  const lines = hunkLines(r.structuredPatch);
  const count = counter(lines);
  const isNew = r.type === "create";
  const content = typeof r.content === "string" ? r.content : "";
  const created =
    content === "" ? 0 : content.split("\n").length - +content.endsWith("\n");
  return {
    path: relPath(r.filePath, e.cwd),
    added: isNew && !lines.length ? created : count("+"),
    removed: count("-"),
    isNew,
    eventIds: [e.id],
  };
}

// Prefixes that say nothing to a person: Claude's scratch and temp folders,
// its per-project folder under ~/.claude, then plain temp folders.
const NOISE = [
  /^\/(?:private\/)?tmp\/claude-[^/]+\/-[^/]+\/[0-9a-f-]{36}\//,
  /^\/(?:private\/)?tmp\/claude-[^/]+\//,
  /^\/(?:Users|home)\/[^/]+\/\.claude\/projects\/[^/]+\//,
  /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T\//,
  /^\/(?:private\/)?tmp\//,
];
const WORKTREE = /^\.claude\/worktrees\/[^/]+\//;
const HOME = /^\/(?:Users|home)\/[^/]+\//;

/**
 * A path as a person reads it: relative to the project (a worktree inside it
 * counts as the project), else with temp prefixes dropped, else `~/` for the home
 * `cwd` is in, keeping the last 3 segments of anything longer.
 */
export function displayPath(path: string, cwd: string): string {
  const rel = relPath(path, cwd);
  if (!rel.startsWith("/")) return rel.replace(WORKTREE, "");
  const noise = NOISE.find((re) => re.test(rel));
  if (noise) return rel.replace(noise, "");
  const mine = HOME.exec(`${cwd}/`)?.[0];
  const home = mine && rel.startsWith(mine) ? mine : undefined;
  const rest = rel.slice(home ? home.length : 1).split("/");
  const tail = rest.length > 3 ? `…/${rest.slice(-3).join("/")}` : null;
  return home ? `~/${tail ?? rest.join("/")}` : (tail ?? rel);
}
