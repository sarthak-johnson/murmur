/*
 * Needs-you, stuck and risky flags, and the assumptions list.
 * - Needs-you (session wide): Notification `permission_prompt` / `elicitation_dialog` /
 *   `idle_prompt` / `agent_needs_input`, or PermissionRequest. A repeat of the same reason
 *   keeps the first. Cleared by UserPromptSubmit, PreToolUse, PostToolUse(Failure) or SessionEnd.
 *   Also "input" at a main-thread Stop that leaves the user something to do: an ask in
 *   Claude's last message (`askIn`), else a task this request narrated blocked on the user
 *   (`waitsOnYou`) and has not narrated since. A Stop that asks nothing drops the ask. It
 *   replaces an idle needs-you (and an idle one never replaces it); a new ask keeps its
 *   `since`. A main-thread AskUserQuestion call is a "question" ask until its result comes.
 *   Only the main thread's tool calls clear it, never a helper's;
 *   a helper's permission prompt meanwhile shows first, and the ask returns once it clears.
 * - Stuck: a run of 3 or more failures, either failed narrate steps on one part (a done or
 *   running step ends the run) or PostToolUseFailure of one tool on one `file_path` or
 *   `command` (a PostToolUse of the same tool and target ends it). One flag per run, text
 *   updated as it grows, `pending` while the run is unbroken. An unbroken run sets its
 *   part's `failures` (narrate runs below 3 count too) and its task's `problem`.
 * - Risky: a PreToolUse Bash command `isRisky` matches; `pending` until its PostToolUse or
 *   PostToolUseFailure by `tool_use_id` (anywhere in the request, so a Post with an
 *   earlier ts still counts), or the next Stop, SessionEnd or prompt (`followed`).
 * - Assumptions: narrate choices with `assumption: true`, first copy per key.
 */
import type { MurmurEvent } from "../events.js";
import { NARRATE_TOOL, NarrateInput } from "../narration.js";
import { askIn, firstSentence } from "./moments.js";
import {
  cut,
  isNotRequest,
  type Named,
  type Trace,
  waitsOnYou,
} from "./requests.js";
import type { Flag, NeedsYou, RequestView } from "./types.js";

const NOTIFY: Record<string, NeedsYou["reason"]> = {
  permission_prompt: "permission",
  elicitation_dialog: "question",
  idle_prompt: "idle",
  agent_needs_input: "input",
};
const CLEARS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SessionEnd",
]);

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export function needsYou(events: MurmurEvent[]): NeedsYou | null {
  // From Claude Code's prompts and notices; a helper's work clears a helper's.
  let out = null as NeedsYou | null;
  // What Claude's last turn left the user to do; only the main thread clears it.
  let ask = null as NeedsYou | null;
  // This request's blocked tasks, by id: the narrate's words.
  const blocked = new Map<string, string>();
  let said = "";
  for (const e of events) {
    const p = e.payload;
    const main = !p.agent_id;
    if (e.hook === "UserPromptSubmit" && !isNotRequest(p.prompt))
      blocked.clear();
    const n =
      e.hook === "PostToolUse" && p.tool_name === NARRATE_TOOL
        ? NarrateInput.safeParse(p.tool_input).data
        : undefined;
    if (n?.task && n.taskStatus === "blocked" && waitsOnYou(n.now))
      blocked.set(n.task, firstSentence(n.now));
    else if (n?.task && n.taskStatus) blocked.delete(n.task);
    if (e.hook === "AssistantText" && main) said = str(p.text) ?? "";
    const reason =
      e.hook === "PermissionRequest"
        ? "permission"
        : e.hook === "Notification"
          ? NOTIFY[str(p.notification_type) ?? ""]
          : undefined;
    if (e.hook === "Stop" && main) {
      // Claude's turn is over: does it leave the user something to do?
      const text =
        askIn(str(p.last_assistant_message) || said) ??
        [...blocked.values()].at(-1);
      ask = text ? { reason: "input", text, since: ask?.since ?? e.ts } : null;
      // Claude Code's idle prompt says less than the ask.
      if (ask && out?.reason === "idle") out = null;
      said = "";
    } else if (CLEARS.has(e.hook)) {
      out = null;
      if (main) {
        ask = null;
        said = "";
        if (e.hook === "PreToolUse" && p.tool_name === "AskUserQuestion")
          ask = { reason: "question", text: questionOf(p), since: e.ts };
      }
    } else if (
      reason &&
      out?.reason !== reason &&
      !(ask && reason === "idle")
    ) {
      const tool = str(p.tool_name);
      const text =
        e.hook === "PermissionRequest"
          ? `Claude needs your permission${tool ? ` to use ${tool}` : ""}`
          : claudeWords(str(p.message) ?? "");
      out = { reason, text, since: e.ts };
    }
  }
  return out ?? ask;
}

/** An AskUserQuestion call's first question. */
function questionOf(p: Record<string, unknown>): string {
  const qs = obj(p.tool_input).questions;
  const q = Array.isArray(qs) ? str(obj(qs[0]).question)?.trim() : undefined;
  return q || "Claude asked you a question";
}

/**
 * A notification can open with the session's own label ("bg needs your input"); it is
 * Claude that needs you. A capitalised name ("Murmur needs...") is left as it is.
 */
export const claudeWords = (message: string): string =>
  message.replace(
    /^[a-z][\w-]*(?= needs your (input|attention|permission)\b)/,
    "Claude",
  );

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function assumptionKey(
  requestId: string,
  part: string | undefined,
  choice: string,
): string {
  return `${requestId}:${part ?? "-"}:${fnv1a(choice)}`;
}

/**
 * Splits on `;`, `&`, `|` and newlines, then on whitespace, and strips quoting so
 * `bash -c "rm -rf x"`, `\rm` and `$(git push -f)` are seen as plain words.
 */
const segments = (cmd: string) =>
  cmd.split(/[;&|\n]+/).map((s) =>
    s
      .trim()
      .split(/\s+/)
      .map((w) =>
        w.replace(/^["'`$(\\]+/, "").replace(/(?<!["'`);])["'`);]+$/, ""),
      ),
  );

const shortFlag = (t: string, c: RegExp) => /^-[a-zA-Z]+$/.test(t) && c.test(t);

export function isRisky(cmd: string): boolean {
  if (/\bdrop\s+(table|database)\b/i.test(cmd)) return true;
  if (/\bprod(uction)?\b/i.test(cmd)) return true;
  return segments(cmd).some((t) => {
    const after = (word: string, from = 0) => {
      const i = t.indexOf(word, from);
      return i < 0 ? undefined : t.slice(i + 1);
    };
    const rm = t.findIndex((w) => w === "rm" || w.endsWith("/rm"));
    if (rm >= 0) {
      const args = t.slice(rm + 1);
      const r = args.some((a) => a === "--recursive" || shortFlag(a, /[rR]/));
      const f = args.some((a) => a === "--force" || shortFlag(a, /f/));
      if (r && f) return true;
    }
    const git = t.indexOf("git");
    if (git < 0) return false;
    const push = after("push", git);
    if (push?.some((a) => a.startsWith("--force") || shortFlag(a, /f/)))
      return true;
    return after("reset", git)?.includes("--hard") ?? false;
  });
}

const NONE: Named = { part: undefined, task: undefined };

interface Run {
  n: number;
  part: string | undefined;
  task: string | undefined;
  flag?: Flag;
  narrate: boolean;
}

export function applyFlags(
  req: RequestView,
  events: MurmurEvent[],
  { before, narrated }: Trace,
  followed = false,
): void {
  const notes = new Map(narrated.map((x) => [x.i, x]));
  const runs = new Map<string, Run>();
  const risky = new Map<string, Flag>();
  const seen = new Set<string>();
  const finished = new Set(
    events
      .filter(
        (e) => e.hook === "PostToolUse" || e.hook === "PostToolUseFailure",
      )
      .map((e) => str(e.payload.tool_use_id)),
  );

  const closeRisky = () => {
    for (const flag of risky.values()) flag.pending = false;
  };
  const fail = (key: string, e: MurmurEvent, at: Named, narrate: boolean) => {
    const run = runs.get(key) ?? { n: 0, ...NONE, narrate };
    runs.set(key, run);
    run.n++;
    run.part = at.part;
    run.task = at.task;
    if (run.n < 3) return;
    if (!run.flag) {
      run.flag = { kind: "stuck", text: "", ts: e.ts, pending: true };
      req.flags.push(run.flag);
    }
    run.flag.text = `Tried a fix ${run.n} times`;
    delete run.flag.part;
    if (at.part) run.flag.part = at.part;
  };
  const end = (key: string) => {
    const flag = runs.get(key)?.flag;
    if (flag) flag.pending = false;
    runs.delete(key);
  };

  events.forEach((e, i) => {
    const note = notes.get(i);
    if (note?.part && note.n.step) {
      const key = `part:${note.part}`;
      if (note.n.step.status === "failed") fail(key, e, note, true);
      else end(key);
    }
    for (const c of note?.n.choices ?? []) {
      const key = assumptionKey(req.id, note?.part, c.choice);
      if (!c.assumption || seen.has(key)) continue;
      seen.add(key);
      req.assumptions.push({
        key,
        ...(note?.part ? { part: note.part } : {}),
        choice: c.choice,
        reason: c.reason,
        ts: e.ts,
      });
    }

    const p = e.payload;
    const useId = str(p.tool_use_id) ?? "";
    const input = obj(p.tool_input);
    const command = str(input.command);
    if (
      e.hook === "PreToolUse" &&
      p.tool_name === "Bash" &&
      command &&
      isRisky(command)
    ) {
      const flag: Flag = {
        kind: "risky",
        text: `About to run: ${cut(command, 120)}`,
        ts: e.ts,
        pending: !finished.has(useId),
      };
      const part = before[i]?.part;
      if (part) flag.part = part;
      risky.set(useId, flag);
      req.flags.push(flag);
    }
    // A denied command never gets a Post event; the turn ending closes it.
    if (e.hook === "Stop" || e.hook === "SessionEnd") closeRisky();
    if (e.hook === "PostToolUse" || e.hook === "PostToolUseFailure") {
      const flag = risky.get(useId);
      if (flag) flag.pending = false;
      const target = str(input.file_path) ?? command;
      if (!target) return;
      const key = `tool:${str(p.tool_name)}:${target}`;
      if (e.hook === "PostToolUse") end(key);
      else fail(key, e, before[i] ?? NONE, false);
    }
  });

  if (followed) closeRisky();

  const tasks = req.phases.flatMap((ph) => ph.tasks);
  for (const run of runs.values()) {
    if (!run.flag && !run.narrate) continue;
    const part = req.parts.find((x) => x.id === run.part);
    if (part) part.failures = Math.max(part.failures, run.n);
    const task = tasks.find((t) => t.id === run.task);
    if (task && run.flag) task.problem = run.flag.text;
  }
}
