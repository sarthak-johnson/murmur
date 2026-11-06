import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type HookName, type MurmurEvent, scrubEvent } from "@murmur/core";
import {
  readCredentials,
  readSession,
  type SessionState,
  updateSession,
} from "./local.js";
import { enqueue, type FlushOptions, flush } from "./upload.js";

const MAX_EVENTS = 5000;
const MAX_BYTES = 20_000_000;
// Only the newest events are kept, so only the end of each file is read.
const TAIL_BYTES = 30_000_000;
// A backfill pending or running this long died; the next hook starts it again.
const STALE_MS = 10 * 60_000;

/** A UUID in version 5 layout from the SHA-1 of `key`. */
function uuidFrom(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  const variant = ((Number.parseInt(h[16] as string, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const TOOL_HOOKS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

/**
 * The id for a tool or subagent event both the live hook and the backfill can send. Claude
 * Code writes a tool call to the transcript before its hook runs, so the event that starts
 * a backfill is also in the history; sharing the id lets the server keep one copy.
 * Prompts get none: many prompts share one prompt_id. The backfill skips the triggering
 * prompt by its text instead.
 */
export function stableId(
  sessionId: string,
  hook: string,
  p: Record<string, unknown>,
): string | undefined {
  const key = TOOL_HOOKS.has(hook)
    ? p.tool_use_id
    : hook === "SubagentStart" || hook === "SubagentStop"
      ? p.agent_id
      : undefined;
  return typeof key === "string" && key
    ? uuidFrom(`murmur:${sessionId}:${hook}:${key}`)
    : undefined;
}

export interface BackfillInput {
  sessionId: string;
  machineId: string;
  cwd: string;
  transcriptPath: string;
  cutoff: string;
}

type Entry = Record<string, unknown>;
type Block = Record<string, unknown>;
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The JSON lines in the last `tailBytes` of `file`, starting at a whole line. */
function readLines(file: string, tailBytes: number): Entry[] {
  let text: string;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - tailBytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      const e = obj(JSON.parse(line));
      return e ? [e] : [];
    } catch {
      return [];
    }
  });
}

function readMeta(file: string): Record<string, unknown> {
  try {
    return obj(JSON.parse(fs.readFileSync(file, "utf8"))) ?? {};
  } catch {
    return {};
  }
}

const COMMAND = /^\s*<command-(?:name|message)>/;
/** What the user typed: a slash command as `/name args`, text blocks joined. */
function promptText(content: unknown): string | undefined {
  if (typeof content === "string") {
    if (!COMMAND.test(content)) return content;
    const tag = (t: string) =>
      new RegExp(`<command-${t}>([\\s\\S]*?)</command-${t}>`)
        .exec(content)?.[1]
        ?.trim() ?? "";
    const name = tag("name");
    if (!name) return undefined;
    return `${name.startsWith("/") ? name : `/${name}`} ${tag("args")}`.trim();
  }
  if (!Array.isArray(content)) return undefined;
  const text = content
    .flatMap((b) => {
      const block = obj(b);
      return block?.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("\n");
  return text || undefined;
}

/** Whether a pending or running backfill has waited too long and should start again. */
export function backfillStale(s: SessionState, now: number): boolean {
  if (s.backfill !== "pending" && s.backfill !== "running") return false;
  return !(now - Date.parse(s.runningSince ?? s.cutoff ?? "") <= STALE_MS);
}

export interface ReadOptions {
  maxEvents?: number;
  maxBytes?: number;
  tailBytes?: number;
  /**
   * The live prompt that set the cutoff. The newest prompt in the transcript is left out
   * only when it is this same text, so nothing is lost if its entry is not written yet.
   */
  skipPrompt?: string | undefined;
}

/**
 * The session's history before `cutoff`, as the hook events Claude Code would have sent,
 * scrubbed and capped to the most recent events. Unreadable parts are skipped.
 */
export function readBackfill(
  b: BackfillInput,
  {
    maxEvents = MAX_EVENTS,
    maxBytes = MAX_BYTES,
    tailBytes = TAIL_BYTES,
    skipPrompt,
  }: ReadOptions = {},
): MurmurEvent[] {
  const cutoff = Date.parse(b.cutoff);
  const out: MurmurEvent[] = [];
  const emit = (
    e: Entry,
    index: number,
    hook: HookName,
    fields: Record<string, unknown>,
  ) => {
    const cwd = str(e.cwd) ?? b.cwd;
    const payload = {
      ...fields,
      hook_event_name: hook,
      session_id: b.sessionId,
      cwd,
    };
    out.push(
      scrubEvent({
        id:
          stableId(b.sessionId, hook, payload) ??
          uuidFrom(`murmur-backfill:${b.sessionId}:${e.uuid}:${index}:${hook}`),
        sessionId: b.sessionId,
        machineId: b.machineId,
        cwd,
        ts: new Date(Date.parse(e.timestamp as string)).toISOString(),
        hook,
        payload,
      }),
    );
  };
  // Entries that can become events: with a uuid and a time before the cutoff.
  const usable = (list: Entry[]) =>
    list.filter((e) => {
      const ts =
        typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
      return str(e.uuid) && ts < cutoff;
    });

  // Agent calls whose result says the helper finished (not just launched it).
  const ended = new Set<string>();
  let newest: { at: number; text: string } | undefined;
  const mapEntries = (list: Entry[], agent: Record<string, unknown>) => {
    const uses = new Map<string, Block>();
    for (const e of list) {
      const content = obj(e.message)?.content;
      if (
        e.type === "user" &&
        obj(e.origin)?.kind === "human" &&
        !agent.agent_id
      ) {
        const prompt = promptText(content);
        if (prompt) {
          emit(e, 0, "UserPromptSubmit", {
            prompt,
            ...(str(e.promptId) ? { prompt_id: e.promptId } : {}),
          });
          newest = { at: out.length - 1, text: prompt };
        }
      }
      if (!Array.isArray(content)) continue;
      content.forEach((raw: unknown, i) => {
        const block = obj(raw);
        if (!block) return;
        if (e.type === "assistant" && block.type === "tool_use") {
          const id = str(block.id);
          if (!id) return;
          uses.set(id, block);
          emit(e, i, "PreToolUse", {
            ...agent,
            tool_name: block.name,
            tool_input: block.input,
            tool_use_id: id,
          });
        } else if (e.type === "user" && block.type === "tool_result") {
          const id = str(block.tool_use_id);
          const use = id ? uses.get(id) : undefined;
          if (!use || !id) return;
          if (obj(e.toolUseResult)?.status !== "async_launched") ended.add(id);
          emit(
            e,
            i,
            block.is_error === true ? "PostToolUseFailure" : "PostToolUse",
            {
              ...agent,
              tool_name: use.name,
              tool_input: use.input,
              tool_use_id: id,
              tool_response: e.toolUseResult ?? block.content,
            },
          );
        }
      });
    }
  };

  mapEntries(usable(readLines(b.transcriptPath, tailBytes)), {});
  // Compared before scrubbing, the way the user typed both.
  if (
    newest &&
    skipPrompt !== undefined &&
    newest.text.trim() === skipPrompt.trim()
  )
    out.splice(newest.at, 1);

  const dir = path.join(
    path.dirname(b.transcriptPath),
    b.sessionId,
    "subagents",
  );
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /^agent-.+\.jsonl$/.test(n));
  } catch {}
  for (const name of names) {
    const agentId = name.slice("agent-".length, -".jsonl".length);
    const meta = readMeta(path.join(dir, `agent-${agentId}.meta.json`));
    const agent = {
      agent_id: agentId,
      agent_type: typeof meta.agentType === "string" ? meta.agentType : "",
    };
    const list = usable(readLines(path.join(dir, name), tailBytes));
    const first = list[0];
    const last = list.at(-1);
    if (!first || !last) continue;
    emit(first, 0, "SubagentStart", agent);
    mapEntries(list, agent);
    // A running subagent's meta has no `finished` and its Agent call has no result yet;
    // its stop comes live later.
    const call = str(meta.toolUseId);
    if (meta.finished === true || (call && ended.has(call)))
      emit(last, 0, "SubagentStop", agent);
  }

  out.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
  let bytes = 0;
  let from = out.length;
  while (from > 0 && out.length - from < maxEvents) {
    const size = Buffer.byteLength(JSON.stringify(out[from - 1]));
    if (bytes + size > maxBytes) break;
    bytes += size;
    from--;
  }
  return out.slice(from);
}

/**
 * Runs in the detached `hook.cjs --backfill <sessionId>` child: queues the pending (or
 * stale) history once, then flushes. Returns how many events it queued. A retry queues
 * the same ids again, so the server keeps one copy.
 */
export async function runBackfill(
  sessionId: string,
  opts: FlushOptions = {},
): Promise<number> {
  const creds = readCredentials();
  const s = readSession(sessionId);
  if (!creds || !(s.backfill === "pending" || backfillStale(s, Date.now())))
    return 0;
  updateSession(sessionId, {
    backfill: "running",
    runningSince: new Date().toISOString(),
  });
  let events: MurmurEvent[] = [];
  if (s.cutoff && s.transcriptPath && s.cwd)
    events = readBackfill(
      {
        sessionId,
        machineId: creds.machineId,
        cwd: s.cwd,
        transcriptPath: s.transcriptPath,
        cutoff: s.cutoff,
      },
      { skipPrompt: s.triggerPrompt },
    );
  for (const e of events) enqueue(e);
  updateSession(sessionId, { backfill: "done" });
  // A logout or new login while this ran must not send with the old token.
  if (readCredentials()?.token === creds.token)
    await flush(creds, { budgetMs: 50_000, ...opts });
  return events.length;
}
