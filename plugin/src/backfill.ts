import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type HookName, type MurmurEvent, scrubEvent } from "@murmur/core";
import {
  clearRefresh,
  clearTitles,
  isHeadless,
  isPaused,
  isRevoked,
  readCredentials,
  readSession,
  type SessionState,
  sessionProjectState,
  skipText,
  updateSession,
  writeSession,
} from "./local.js";
import { lastRequestOpen, runRecap, runRefresh } from "./recap.js";
import { runTitles, TITLES_TIMEOUT_MS } from "./titles.js";
import { enqueue, type FlushOptions, flush } from "./upload.js";

// A week-long session with whole diffs and Claude's messages is ~19,000 events and
// ~46 MB; the caps leave room for twice that. MAX_BYTES stays at half the queue's cap
// (upload.ts), so a backfill is never cut by the queue, even beside a backlog.
const MAX_EVENTS = 50_000;
const MAX_BYTES = 100_000_000;
// Files are streamed, so this only bounds the time a huge transcript takes. What fits
// is set by MAX_BYTES: all of a few-day session, the last day or so of a longer one.
const TAIL_BYTES = 512_000_000;
const CHUNK = 1 << 20;
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

/** Where a live read starts, and, after it, the end of the last whole line it read. */
interface Window {
  from: number;
  end: number;
}

/**
 * The JSON lines in the last `tailBytes` of `file`, starting at a whole line, read in
 * chunks so the file is never in memory at once (the mapped events still are). With
 * `at`, it reads from `at.from` instead and leaves a last line with no newline (still
 * being written) for the next read, setting `at.end` past the last whole line. With
 * `upTo`, it reads the tail only up to byte `upTo.from`, also leaves a last line with no
 * newline, and sets `upTo.end` past the last whole line.
 */
function* readLines(
  file: string,
  tailBytes: number,
  at?: Window,
  upTo?: Window,
): Generator<Entry> {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return;
  }
  try {
    const size = Math.min(fs.fstatSync(fd).size, upTo?.from ?? Infinity);
    // A transcript shorter than where the last read ended was replaced: read it all.
    let pos = at
      ? at.from <= size
        ? at.from
        : 0
      : Math.max(0, size - tailBytes);
    let end = pos;
    if (upTo) upTo.end = pos;
    const buf = Buffer.alloc(CHUNK);
    // The first line is cut unless the window starts right after a newline.
    let skip = false;
    if (pos > 0 && !at) {
      fs.readSync(fd, buf, 0, 1, pos - 1);
      skip = buf[0] !== 10;
    }
    let rest = Buffer.alloc(0);
    const parse = (line: Buffer): Entry | undefined => {
      try {
        return obj(JSON.parse(line.toString("utf8")));
      } catch {
        return undefined;
      }
    };
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      let data = Buffer.concat([rest, buf.subarray(0, n)]);
      for (let nl = data.indexOf(10); nl !== -1; nl = data.indexOf(10)) {
        const line = data.subarray(0, nl);
        data = data.subarray(nl + 1);
        end += nl + 1;
        if (at) at.end = end;
        if (upTo) upTo.end = end;
        if (skip) skip = false;
        else {
          const e = parse(line);
          if (e) yield e;
        }
      }
      rest = Buffer.from(data);
    }
    if (!at && !upTo && !skip && rest.length) {
      const e = parse(rest);
      if (e) yield e;
    }
  } catch {
    // Best effort: what was read so far stands.
  } finally {
    fs.closeSync(fd);
  }
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

/** One transcript entry's hook event, with the id a backfill and a live read share. */
function entryEvent(
  b: Pick<BackfillInput, "sessionId" | "machineId" | "cwd">,
  e: Entry,
  index: number,
  hook: HookName,
  fields: Record<string, unknown>,
): MurmurEvent {
  const cwd = str(e.cwd) ?? b.cwd;
  const payload = {
    ...fields,
    hook_event_name: hook,
    session_id: b.sessionId,
    cwd,
  };
  return scrubEvent({
    id:
      stableId(b.sessionId, hook, payload) ??
      uuidFrom(`murmur-backfill:${b.sessionId}:${e.uuid}:${index}:${hook}`),
    sessionId: b.sessionId,
    machineId: b.machineId,
    cwd,
    ts: new Date(Date.parse(e.timestamp as string)).toISOString(),
    hook,
    payload,
  });
}

/** Claude's own words in a main-thread entry: its non-empty text blocks, by index. */
function textBlocks(e: Entry): { i: number; text: string }[] {
  const content = obj(e.message)?.content;
  if (
    e.type !== "assistant" ||
    e.isSidechain === true ||
    !Array.isArray(content)
  )
    return [];
  return content.flatMap((raw: unknown, i) => {
    const block = obj(raw);
    const text = block?.type === "text" ? str(block.text) : undefined;
    return text?.trim() ? [{ i, text }] : [];
  });
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
  /**
   * Read the main transcript only up to byte `textUntil.from`, also keep Claude's text
   * from the cutoff on, and set `textUntil.end` past the last whole line read, where the
   * live read starts.
   */
  textUntil?: Window | undefined;
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
    textUntil,
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
    out.push(entryEvent(b, e, index, hook, fields));
  };
  // Entries that can become events: with a uuid and a time before the cutoff.
  const usable = (e: Entry) => {
    const ts = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    return Boolean(str(e.uuid)) && ts < cutoff;
  };

  // Agent calls whose result says the helper finished (not just launched it).
  const ended = new Set<string>();
  let newest: { at: number; text: string } | undefined;
  // Maps the usable entries of `list`; returns the first and last of them.
  const mapEntries = (
    list: Iterable<Entry>,
    agent: Record<string, unknown>,
  ) => {
    const uses = new Map<string, Block>();
    let first: Entry | undefined;
    let last: Entry | undefined;
    for (const e of list) {
      // Claude's words after the cutoff, before the live read's start.
      if (textUntil !== undefined && !agent.agent_id && !usable(e)) {
        if (str(e.uuid) && Date.parse(e.timestamp as string) >= cutoff)
          for (const { i, text } of textBlocks(e))
            emit(e, i, "AssistantText", { text });
        continue;
      }
      if (!usable(e)) continue;
      first ??= e;
      last = e;
      const content = obj(e.message)?.content;
      // A helper's report comes as a task notification, which the live hook sends as a
      // prompt too; core keeps it out of requests.
      const kind = obj(e.origin)?.kind;
      if (
        e.type === "user" &&
        (kind === "human" || kind === "task-notification") &&
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
      if (!agent.agent_id)
        for (const { i, text } of textBlocks(e))
          emit(e, i, "AssistantText", { text });
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
    return { first, last };
  };

  mapEntries(readLines(b.transcriptPath, tailBytes, undefined, textUntil), {});
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
    const at = out.length;
    const { first, last } = mapEntries(
      readLines(path.join(dir, name), tailBytes),
      agent,
    );
    if (!first || !last) continue;
    // The start goes before the helper's own events, which can share its time.
    emit(first, 0, "SubagentStart", agent);
    out.splice(at, 0, out.pop() as MurmurEvent);
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
  {
    env = process.env,
    ...opts
  }: FlushOptions & { env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  // A little under the child's 4-minute exit timer (hook.ts).
  const deadline = Date.now() + 230_000;
  const creds = readCredentials();
  const s = readSession(sessionId);
  if (!creds || !(s.backfill === "pending" || backfillStale(s, Date.now())))
    return 0;
  updateSession(sessionId, {
    backfill: "running",
    runningSince: new Date().toISOString(),
  });
  // An import (a re-import deletes the session first) gives the server no refresh
  // events, so what the refresh said before is forgotten and may be said again.
  // ponytail: a backfill retried after its child died forgets them too, so a request
  // may be asked once more; key the reset on a real re-import if that ever costs much.
  clearRefresh(sessionId);
  clearTitles(sessionId);
  let events: MurmurEvent[] = [];
  // The live read starts where this read ends; Claude's text from the cutoff to here is
  // in this import, so nothing is read twice or missed.
  let upTo: Window | undefined;
  try {
    const size = s.transcriptPath ? fs.statSync(s.transcriptPath).size : NaN;
    if (size >= 0) upTo = { from: size, end: 0 };
  } catch {}
  if (s.cutoff && s.transcriptPath && s.cwd)
    events = readBackfill(
      {
        sessionId,
        machineId: creds.machineId,
        cwd: s.cwd,
        transcriptPath: s.transcriptPath,
        cutoff: s.cutoff,
      },
      { skipPrompt: s.triggerPrompt, textUntil: upTo },
    );
  for (const e of events) enqueue(e);
  // The raw prompt text is only needed for this run.
  const { triggerPrompt: _prompt, ...rest } = readSession(sessionId);
  writeSession(sessionId, {
    ...rest,
    backfill: "done",
    ...(upTo ? { textOffset: upTo.end } : {}),
  });
  // A logout or new login while this ran must not send with the old token.
  const same = () => readCredentials()?.token === creds.token;
  if (same()) await flush(creds, { budgetMs: 50_000, ...opts });
  // What the history alone cannot say, the user's own Claude says, then that goes too.
  // All of it inside the child's 4 minutes: no ask starts unless it can end (60 s) with
  // time left to send.
  const left = () => deadline - Date.now();
  const recap = await runRecap(sessionId, events, {
    env,
    lastOpen: lastRequestOpen(s.triggerHook),
    budgetMs: Math.min(150_000, left() - 70_000),
  });
  if (recap.ok && same())
    await flush(creds, { budgetMs: Math.max(1000, left()), ...opts });
  // Then the whole history is named and grouped into storylines, when its ask can end
  // with time left to send; else the next Stop's child does it.
  if (
    left() > TITLES_TIMEOUT_MS + 15_000 &&
    (
      await runTitles(sessionId, events, {
        env,
        lastOpen: lastRequestOpen(s.triggerHook),
      })
    ).ok &&
    same()
  )
    await flush(creds, { budgetMs: Math.max(1000, left()), ...opts });
  // Then one refresh pass, under the same caps, so a stale plan Claude drew in the
  // history is caught up too; only when its ask (60 s) can end with time left to send.
  if (left() > 75_000 && (await runRefresh(sessionId, { env })).ok && same())
    await flush(creds, { budgetMs: Math.max(1000, left()), ...opts });
  return events.length;
}

/**
 * Runs in the detached child a hook Claude waits on spawns, and in the hooks Claude
 * never waits on (a tool's, a helper's), never in a hook Claude waits on: queues the main-thread
 * text Claude wrote since the last read (`textOffset`) as `AssistantText`, with the
 * backfill's ids, and stores where it stopped. A last line still being written waits for
 * the next read. With no `textOffset` on record (a session imported before Murmur read
 * Claude's text) it starts at the transcript's end. Whenever Murmur would send nothing
 * (headless, the recap's own run, logged out, disconnected, off, paused) it only moves
 * the offset, so that text is never sent. Returns how many it queued.
 */
export function catchUpText(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const s = readSession(sessionId);
  if (s.backfill !== "done" || !s.transcriptPath || !s.cwd) return 0;
  const creds = readCredentials();
  if (
    s.textOffset === undefined ||
    env.MURMUR_RECAP_RUN === "1" ||
    (isHeadless(env) && env.MURMUR_ALLOW_HEADLESS !== "1") ||
    !creds ||
    isRevoked() ||
    sessionProjectState(s.cwd, sessionId) !== "on" ||
    isPaused(s.cwd, sessionId) ||
    (s.project !== undefined && isPaused(s.project))
  ) {
    skipText(sessionId);
    return 0;
  }
  const at = { from: s.textOffset, end: s.textOffset };
  const b = { sessionId, machineId: creds.machineId, cwd: s.cwd };
  let n = 0;
  for (const e of readLines(s.transcriptPath, 0, at)) {
    if (!str(e.uuid)) continue;
    for (const { i, text } of textBlocks(e)) {
      enqueue(entryEvent(b, e, i, "AssistantText", { text }));
      n++;
    }
  }
  updateSession(sessionId, { textOffset: at.end });
  return n;
}
