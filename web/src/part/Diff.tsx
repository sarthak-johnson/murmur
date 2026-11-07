import type { FileTouch, MurmurEvent } from "@murmur/core";
import { useState } from "react";

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const hunkList = (v: unknown): Hunk[] =>
  Array.isArray(v)
    ? v.filter((h): h is Hunk => Array.isArray(obj(h).lines))
    : [];

/** A whole text as one hunk of added lines. */
export const created = (content: string): Hunk => {
  const lines = content.replace(/\n$/, "").split("\n");
  return {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: lines.map((l) => `+${l}`),
  };
};

/** One file's change in one event: an Edit or Write patch, a create, or a command's bashEditDiff. */
export function hunksOfEvent(
  e: MurmurEvent | undefined,
  path?: string,
): Hunk[] {
  const res = obj(e?.payload.tool_response);
  const bash = obj(res.bashEditDiff).files;
  if (Array.isArray(bash)) {
    const files = bash.map(obj);
    const mine = path
      ? files.filter((f) => {
          const p = String(f.filePath ?? "");
          return p === path || p.endsWith(`/${path}`);
        })
      : files;
    return mine.flatMap((f) => hunkList(f.hunks));
  }
  const hunks = hunkList(res.structuredPatch);
  if (hunks.length) return hunks;
  if (res.type === "create" && typeof res.content === "string")
    return [created(res.content)];
  return [];
}

export function hunksOf(file: FileTouch, byId: Map<string, MurmurEvent>) {
  return file.eventIds.flatMap((id) => hunksOfEvent(byId.get(id), file.path));
}

interface Row {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  old?: number;
  new?: number;
}

function rowsOf(hunks: Hunk[]): Row[] {
  const out: Row[] = [];
  for (const h of hunks) {
    const last = h.newStart + Math.max(0, h.newLines - 1);
    out.push({
      kind: "hunk",
      text:
        h.newLines > 1
          ? `Lines ${h.newStart} to ${last}`
          : `Line ${h.newStart}`,
    });
    let o = h.oldStart;
    let n = h.newStart;
    for (const l of h.lines) {
      if (l.startsWith("\\")) continue; // "\ No newline at end of file"
      if (l.startsWith("+"))
        out.push({ kind: "add", text: l.slice(1), new: n++ });
      else if (l.startsWith("-"))
        out.push({ kind: "del", text: l.slice(1), old: o++ });
      else out.push({ kind: "ctx", text: l.slice(1), old: o++, new: n++ });
    }
  }
  return out;
}

const SHOWN = 60;
const FOLD_OVER = 80;
const SIGN = { add: "+", del: "−", ctx: "", hunk: "" } as const;

/** A diff with line numbers, tinted added and removed lines, and a gap between hunks. */
export function DiffView({ hunks }: { hunks: Hunk[] }) {
  const [all, setAll] = useState(false);
  const rows = rowsOf(hunks);
  const lines = rows.filter((r) => r.kind !== "hunk").length;
  if (!lines)
    return <p className="muted small">No line changes were recorded.</p>;
  const folded = !all && rows.length > FOLD_OVER;
  const shown = folded ? rows.slice(0, SHOWN) : rows;
  return (
    <div className="diff">
      <div className="diff-scroll">
        <div className="diff-rows">
          {shown.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed diff
            <div key={i} className={`dl ${r.kind}`}>
              {r.kind === "hunk" ? (
                <span className="hunk-label">{r.text}</span>
              ) : (
                <>
                  <span className="ln">{r.old ?? ""}</span>
                  <span className="ln">{r.new ?? ""}</span>
                  <span className="sign" aria-hidden="true">
                    {SIGN[r.kind]}
                  </span>
                  <span className="dl-text">{r.text}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      {rows.length > FOLD_OVER && (
        <button
          type="button"
          className="link diff-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer lines" : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  );
}
