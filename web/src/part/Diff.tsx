import type { FileTouch, MurmurEvent } from "@murmur/core";
import { type ReactNode, useMemo, useState } from "react";
import { PathText } from "../files";
import { eventsById, MINUS } from "../format";
import { clock } from "../story";

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  /** A divider drawn before this hunk, such as "Edit 2 · 15:43". */
  label?: string;
  /** Proposed text with no known place in the file: no line numbers. */
  bare?: boolean;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const hunkList = (v: unknown): Hunk[] =>
  Array.isArray(v)
    ? v
        .filter((h): h is Hunk => Array.isArray(obj(h).lines))
        .map((h) => ({
          ...h,
          lines: (h.lines as unknown[]).filter(
            (l): l is string => typeof l === "string",
          ),
        }))
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

/** A file's hunks across its events; each later edit starts with a divider. */
/** A request's events by id, as a diff and a step read them; kept while the events are. */
export const useById = (events: MurmurEvent[]) => eventsById(events);

export function hunksOf(file: FileTouch, byId: Map<string, MurmurEvent>) {
  const out: Hunk[] = [];
  let edits = 0;
  for (const id of file.eventIds) {
    const e = byId.get(id);
    const hunks = hunksOfEvent(e, file.path);
    if (!hunks.length) continue;
    edits++;
    const [first, ...rest] = hunks as [Hunk, ...Hunk[]];
    out.push(
      edits > 1 && e
        ? { ...first, label: `Edit ${edits} · ${clock(e.ts)}` }
        : first,
      ...rest,
    );
  }
  return out;
}

interface Row {
  kind: "add" | "del" | "ctx" | "hunk" | "edit";
  text: string;
  old?: number;
  new?: number;
}

function rowsOf(hunks: Hunk[]): Row[] {
  const out: Row[] = [];
  for (const h of hunks) {
    if (h.label) out.push({ kind: "edit", text: h.label });
    const last = h.newStart + Math.max(0, h.newLines - 1);
    if (!h.bare)
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
      const kind = l.startsWith("+")
        ? "add"
        : l.startsWith("-")
          ? "del"
          : "ctx";
      const row: Row = { kind, text: l.slice(1) };
      if (kind !== "add") {
        if (!h.bare) row.old = o;
        o++;
      }
      if (kind !== "del") {
        if (!h.bare) row.new = n;
        n++;
      }
      out.push(row);
    }
  }
  return out;
}

const SHOWN = 60;
const FOLD_OVER = 80;
const SIGN = { add: "+", del: "−", ctx: "" } as const;
const isLine = (r: Row): r is Row & { kind: keyof typeof SIGN } =>
  r.kind === "add" || r.kind === "del" || r.kind === "ctx";

/** A diff with line numbers, tinted added and removed lines, and a gap between hunks. */
export function DiffView({ hunks }: { hunks: Hunk[] }) {
  const [all, setAll] = useState(false);
  const rows = rowsOf(hunks);
  const lines = rows.filter(isLine).length;
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
              {!isLine(r) ? (
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

/**
 * A changed file as a row: its path, lines added and removed, new or not, its diff one
 * click away. `note` is said inside the row (a role); `children` follow it, under the row.
 */
export function DiffRow(props: {
  file: FileTouch;
  cwd: string;
  strip?: string | undefined;
  byId: Map<string, MurmurEvent>;
  note?: ReactNode;
  children?: ReactNode;
}) {
  const { file, cwd, strip, byId } = props;
  const [open, setOpen] = useState(false);
  return (
    <li className={open ? "file-row open" : "file-row"}>
      <button
        type="button"
        className="pd-file"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <PathText path={file.path} cwd={cwd} {...(strip ? { strip } : {})} />
        {/* Its counts and tags stay on one line together, beside the path. */}
        <span className="pd-facts">
          <span className={file.added ? "pd-add" : "pd-add zero"}>
            +{file.added}
          </span>
          <span className={file.removed ? "pd-del" : "pd-del zero"}>
            {MINUS}
            {file.removed}
          </span>
          {file.isNew && <span className="pd-tag">new</span>}
          {props.note}
        </span>
      </button>
      {props.children}
      {open && <DiffView hunks={hunksOf(file, byId)} />}
    </li>
  );
}
