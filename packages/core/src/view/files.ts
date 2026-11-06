/*
 * Files touched, from successful Edit and Write calls (PostToolUse only).
 * - Counts are the `+` and `-` lines of `tool_response.structuredPatch`; a Write with
 *   `type: "create"` and an empty patch counts its content lines as added.
 * - A touch goes to the part of the latest narrate before it naming the path in `files`,
 *   else the first such narrate after it, else the latest narrate before it, else `looseFiles`.
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
  events.forEach((e, i) => {
    const t = touchOf(e);
    if (!t) return;
    const named = naming.get(t.path) ?? [];
    const by = named.findLast((x) => x.i < i) ?? named.find((x) => x.i > i);
    const partId = by?.part ?? before[i]?.part;
    const part = req.parts.find((p) => p.id === partId);
    const files = part ? part.files : req.looseFiles;
    const file = files.find((f) => f.path === t.path);
    if (!file) files.push(t);
    else {
      file.added += t.added;
      file.removed += t.removed;
      file.isNew ||= t.isNew;
      file.eventIds.push(e.id);
    }
  });
  for (const p of req.parts) p.files = p.files.filter((f) => f.eventIds.length);
}

function touchOf(e: MurmurEvent): Touch | undefined {
  const { tool_name: tool, tool_response: res } = e.payload;
  if (e.hook !== "PostToolUse" || (tool !== "Edit" && tool !== "Write")) return;
  if (!res || typeof res !== "object") return;
  const r = res as Record<string, unknown>;
  if (typeof r.filePath !== "string") return;
  const lines = Array.isArray(r.structuredPatch)
    ? r.structuredPatch.flatMap((h) =>
        Array.isArray(h?.lines) ? (h.lines as unknown[]) : [],
      )
    : [];
  const count = (c: string) =>
    lines.filter((l) => typeof l === "string" && l.startsWith(c)).length;
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
