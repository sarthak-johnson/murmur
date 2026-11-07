/*
 * Files touched, from successful Edit and Write calls, and Bash calls whose result has a
 * `bashEditDiff` (a command that changed files: `sed -i`, `python3 -`, `cp`), PostToolUse only.
 * - Counts are the `+` and `-` lines of `tool_response.structuredPatch`; a Write with
 *   `type: "create"` and an empty patch counts its content lines as added. A Bash diff
 *   counts each file's hunk lines the same way; a file whose only hunk starts at line 0
 *   of 0 lines is new.
 * - A helper's touch goes to the part that helper narrated latest before it, else first
 *   after it (the recap narrates for each helper it puts on a part).
 * - Any other touch goes to the part of the latest narrate before it naming the path in
 *   `files`, else the first such narrate after it, else the latest narrate before it, else
 *   `looseFiles`.
 * - One entry per path per part: counts add up, `isNew` if any touch created the file.
 * - Narrate's role-only entries take a touch's counts, and are dropped if none arrives.
 */
import type { MurmurEvent } from "../events.js";
import { relPath, type Trace } from "./requests.js";
import type { FileTouch, RequestView } from "./types.js";

type Touch = Omit<FileTouch, "role">;

export function applyFiles(
  req: RequestView,
  events: MurmurEvent[],
  { before, narrated }: Trace,
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
    for (const t of touchesOf(e)) addAt(t, i, String(e.payload.agent_id ?? ""));
  });
  function addAt(t: Touch, i: number, agentId: string) {
    const by =
      near(helpers.get(agentId) ?? [], i) ?? near(naming.get(t.path) ?? [], i);
    const partId = by?.part ?? before[i]?.part;
    const part = req.parts.find((p) => p.id === partId);
    addTouch(part ? part.files : req.looseFiles, t);
  }
  for (const p of req.parts) p.files = p.files.filter((f) => f.eventIds.length);
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
