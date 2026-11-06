import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type HookName, type MurmurEvent, scrubEvent } from "@murmur/core";
import { readCredentials, readSession, updateSession } from "./local.js";
import { enqueue, type FlushOptions, flush } from "./upload.js";

const MAX_EVENTS = 5000;
const MAX_BYTES = 20_000_000;

/** A UUID in version 5 layout from the SHA-1 of `key`. */
function uuidFrom(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  const variant = ((Number.parseInt(h[16] as string, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const TOOL_HOOKS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

/**
 * The id for an event both the live hook and the backfill can send. Claude Code writes a
 * prompt or tool call to the transcript before its hook runs, so the event that starts a
 * backfill is also in the history; sharing the id lets the server keep one copy.
 */
export function stableId(
  sessionId: string,
  hook: string,
  p: Record<string, unknown>,
): string | undefined {
  const key =
    hook === "UserPromptSubmit"
      ? p.prompt_id
      : TOOL_HOOKS.has(hook)
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

function readLines(file: string): Entry[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
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

/**
 * The session's history before `cutoff`, as the hook events Claude Code would have sent,
 * scrubbed and capped to the most recent events. Unreadable parts are skipped.
 */
export function readBackfill(
  b: BackfillInput,
  { maxEvents = MAX_EVENTS, maxBytes = MAX_BYTES } = {},
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

  const mapEntries = (list: Entry[], agent: Record<string, unknown>) => {
    const uses = new Map<string, Block>();
    for (const e of list) {
      const content = obj(e.message)?.content;
      if (e.type === "user" && typeof content === "string") {
        if (obj(e.origin)?.kind === "human" && !agent.agent_id)
          emit(e, 0, "UserPromptSubmit", {
            prompt: content,
            ...(str(e.promptId) ? { prompt_id: e.promptId } : {}),
          });
        continue;
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
          if (!use) return;
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

  mapEntries(usable(readLines(b.transcriptPath)), {});

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
    const list = usable(readLines(path.join(dir, name)));
    const first = list[0];
    const last = list.at(-1);
    if (!first || !last) continue;
    emit(first, 0, "SubagentStart", agent);
    mapEntries(list, agent);
    // A running subagent's meta has no `finished`; its stop comes live later.
    if (meta.finished === true) emit(last, 0, "SubagentStop", agent);
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
 * Runs in the detached `hook.cjs --backfill <sessionId>` child: queues the pending history
 * once, then flushes. Returns how many events it queued.
 */
export async function runBackfill(
  sessionId: string,
  opts: FlushOptions = {},
): Promise<number> {
  const creds = readCredentials();
  const s = readSession(sessionId);
  if (!creds || s.backfill !== "pending") return 0;
  updateSession(sessionId, { backfill: "running" });
  let events: MurmurEvent[] = [];
  if (s.cutoff && s.transcriptPath && s.cwd)
    events = readBackfill({
      sessionId,
      machineId: creds.machineId,
      cwd: s.cwd,
      transcriptPath: s.transcriptPath,
      cutoff: s.cutoff,
    });
  for (const e of events) enqueue(e);
  updateSession(sessionId, { backfill: "done" });
  await flush(creds, { budgetMs: 50_000, ...opts });
  return events.length;
}
