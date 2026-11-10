import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  HOOK_NAMES,
  type HookName,
  isNotRequest,
  MAP_TOOL,
  type MurmurEvent,
  NARRATE_TOOL,
  scrubEvent,
} from "@murmur/core";
import {
  backfillStale,
  catchUpText,
  runBackfill,
  stableId,
} from "./backfill.js";
import { MID_SESSION_LINE } from "./instruction.js";
import {
  clearProjectPause,
  isHeadless,
  isNewSession,
  isPaused,
  isRevoked,
  markSent,
  NARRATION_INSTRUCTION,
  NO_NARRATION,
  projectKey,
  projectName,
  pruneSessions,
  readCredentials,
  readSession,
  sessionProjectState,
  setProjectState,
  skipText,
  updateSession,
  writeSession,
} from "./local.js";
import { runRefresh } from "./recap.js";
import { runTitlesLive } from "./titles.js";
import { enqueue, flush } from "./upload.js";

const askLine = (cwd: string) =>
  `Murmur: show ${projectName(cwd)} in Murmur? Run /murmur:on to turn it on, or /murmur:off to stop asking.`;
const LOGIN_LINE = "Murmur: run /murmur:login to connect.";
const REVOKED_LINE =
  "Murmur: this machine was disconnected. Run /murmur:login.";
const BLOCK = JSON.stringify({
  decision: "block",
  reason:
    "Murmur: before you finish, call narrate to mark each finished task done and say what you did.",
});

/** `backfill` names a session whose history the caller should import. */
type Result = { stdout: string; event: MurmurEvent | null; backfill?: string };
const NONE: Result = { stdout: "", event: null };
const show = (line: string): Result => ({
  stdout: JSON.stringify({ systemMessage: line }),
  event: null,
});

/** The transcript's size now: where Claude's live text starts. A stat, never a read. */
function textStart(transcriptPath: unknown): { textOffset: number } | object {
  if (typeof transcriptPath !== "string" || !transcriptPath) return {};
  try {
    return { textOffset: fs.statSync(transcriptPath).size };
  } catch {
    return { textOffset: 0 };
  }
}

export function handleHook(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  now: Date,
): Result {
  const hook = payload.hook_event_name;
  const cwd = payload.cwd;
  // AssistantText is Murmur's own, read from the transcript; no hook sends it.
  if (
    typeof hook !== "string" ||
    hook === "AssistantText" ||
    !(HOOK_NAMES as readonly string[]).includes(hook)
  )
    return NONE;
  const sessionId =
    typeof payload.session_id === "string" && payload.session_id
      ? payload.session_id
      : env.CLAUDE_CODE_SESSION_ID;
  // Whatever Claude wrote while Murmur sends nothing is never sent later either.
  const quiet = (r: Result): Result => {
    if (sessionId) skipText(sessionId, payload.transcript_path);
    return r;
  };
  // The recap's own `claude -p` run never uploads, whatever entry point it inherited.
  if (
    env.MURMUR_RECAP_RUN === "1" ||
    (isHeadless(env) && env.MURMUR_ALLOW_HEADLESS !== "1")
  )
    return quiet(NONE);
  if (typeof cwd !== "string" || !cwd) return NONE;
  const start = hook === "SessionStart";

  if (start && payload.source === "startup") {
    clearProjectPause(cwd);
    pruneSessions(now);
  }
  const state = sessionProjectState(cwd, sessionId);
  if (state === undefined) {
    if (!start) return quiet(NONE);
    setProjectState(cwd, "asked");
    return quiet(show(askLine(cwd)));
  }
  if (state === "off") {
    // A session seen while its project is off is never imported after /murmur:on.
    if (sessionId && isNewSession(sessionId))
      updateSession(sessionId, { backfill: "done" });
    return quiet(NONE);
  }
  if (state !== "on") return quiet(NONE);
  const creds = readCredentials();
  if (!creds) return quiet(start ? show(LOGIN_LINE) : NONE);
  if (isRevoked()) return quiet(start ? show(REVOKED_LINE) : NONE);
  if (!sessionId) return NONE;
  const fresh = isNewSession(sessionId);
  // First seen while its project is on: from now on the session follows that project,
  // so a cd into a worktree or another folder keeps it on.
  const seen = readSession(sessionId);
  const project = seen.project ?? projectKey(cwd);
  // A session file that could not be read is rewritten as already imported. A seen
  // session with no transcript on record (first seen while off, or before Murmur read
  // Claude's text) has its live text start now.
  const transcript = payload.transcript_path;
  const noTranscript =
    !fresh &&
    !seen.transcriptPath &&
    typeof transcript === "string" &&
    !!transcript;
  if (!seen.project || (!fresh && !seen.backfill) || noTranscript)
    updateSession(sessionId, {
      project,
      ...(fresh ? {} : { backfill: seen.backfill ?? "done" }),
      ...(noTranscript
        ? { transcriptPath: transcript, cwd, ...textStart(transcript) }
        : {}),
    });
  if (isPaused(cwd, sessionId) || isPaused(project)) {
    // What happens while paused is never shown, not even by a later backfill.
    if (fresh) updateSession(sessionId, { backfill: "done" });
    return quiet(NONE);
  }

  const ts = now.toISOString();
  const event = scrubEvent({
    id: stableId(sessionId, hook, payload) ?? randomUUID(),
    sessionId,
    machineId: creds.machineId,
    cwd,
    ts,
    hook: hook as HookName,
    payload,
  });
  // The first event of a session Murmur has not seen: import what came before it,
  // unless it is a brand new session.
  let backfill: string | undefined;
  if (fresh) {
    const transcriptPath = payload.transcript_path;
    const isNew = start && payload.source === "startup";
    if (!isNew && typeof transcriptPath === "string" && transcriptPath) {
      updateSession(sessionId, {
        backfill: "pending",
        cutoff: ts,
        // Whether the last imported request is over: see lastRequestOpen.
        triggerHook: start ? `SessionStart:${String(payload.source)}` : hook,
        ...(hook === "UserPromptSubmit" && typeof payload.prompt === "string"
          ? { triggerPrompt: payload.prompt }
          : {}),
        transcriptPath,
        cwd,
      });
      backfill = sessionId;
    } else
      updateSession(sessionId, {
        backfill: "done",
        ...(typeof transcriptPath === "string" && transcriptPath
          ? { transcriptPath, cwd, ...textStart(transcriptPath) }
          : {}),
      });
  } else if (backfillStale(readSession(sessionId), now.getTime())) {
    // Its child died: hand the same cutoff to a new one.
    updateSession(sessionId, { backfill: "pending", runningSince: ts });
    backfill = sessionId;
  }
  // A prompt that is not a request (a task notification, /murmur:*) stays part of the
  // request before, as core reads it: no narration reset, no instruction.
  const prompt = hook === "UserPromptSubmit" && !isNotRequest(payload.prompt);
  // Only a request sent here (or imported) may be named by a titles run later.
  if (prompt) markSent(sessionId, payload.prompt_id);
  let stdout = trackNarration(sessionId, hook, payload, prompt);
  // SessionStart injects for every source, so the instruction survives compaction. A
  // session that started before Murmur was on gets it once, with its next prompt, and
  // maps the work already under way.
  if (start || (prompt && !readSession(sessionId).instructed)) {
    updateSession(sessionId, { instructed: true });
    stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: hook,
        additionalContext: start
          ? NARRATION_INSTRUCTION
          : `${MID_SESSION_LINE}\n${NARRATION_INSTRUCTION}`,
      },
    });
  }
  return backfill ? { stdout, event, backfill } : { stdout, event };
}

// ponytail: async PostToolUse hooks read-modify-write this file without a lock, so two
// narrate calls landing in the same few ms can lose one; worst case is one extra Stop block.
/** Records map and narrate calls; on Stop, asks once per request for the missing narration. */
function trackNarration(
  sessionId: string,
  hook: string,
  p: Record<string, unknown>,
  prompt: boolean,
): string {
  if (prompt) updateSession(sessionId, NO_NARRATION);
  const tool = hook === "PostToolUse" ? p.tool_name : undefined;
  if (tool !== MAP_TOOL && tool !== NARRATE_TOOL && hook !== "Stop") return "";
  const n = readSession(sessionId);
  if (tool === MAP_TOOL) {
    n.mapped = true;
    const phases = (p.tool_input as { phases?: unknown } | undefined)?.phases;
    n.tasks = (Array.isArray(phases) ? phases : []).flatMap((ph) =>
      (Array.isArray(ph?.tasks) ? ph.tasks : []).flatMap(
        (t: { id?: unknown }) =>
          typeof t?.id === "string" && t.id ? [t.id] : [],
      ),
    );
  }
  if (tool === NARRATE_TOOL) {
    const input = (p.tool_input ?? {}) as Record<string, unknown>;
    n.narrates++;
    if (typeof input.task === "string" && input.task) {
      const task = input.task;
      if (!n.named.includes(task)) n.named.push(task);
      n.done = n.done.filter((t) => t !== task);
      if (input.taskStatus === "done") n.done.push(task);
    }
  }
  let out = "";
  if (hook === "Stop") {
    const told =
      n.narrates > 0 &&
      [...n.tasks, ...n.named].every((t) => n.done.includes(t));
    if (p.stop_hook_active === true || !n.mapped || n.blocked || told)
      return "";
    n.blocked = true;
    out = BLOCK;
  }
  writeSession(sessionId, n);
  return out;
}

const BACKFILL = process.argv.indexOf("--backfill");
const REFRESH = process.argv.includes("--refresh");

async function main(): Promise<void> {
  const creds = readCredentials();
  const flushAt = process.argv.indexOf("--flush");
  if (flushAt >= 0) {
    // Claude's text since the last read goes out with the hook's own event.
    const id = process.argv[flushAt + 1];
    if (id) catchUpText(id);
    if (creds) await flush(creds);
    // After a Stop: the latest request's plan, when Claude stopped keeping it true. Sent
    // with the login there is now, not the one this child started with.
    if (id && REFRESH && (await runRefresh(id)).ok) {
      const now = readCredentials();
      if (now) await flush(now, { budgetMs: 30_000 });
    }
    // Then names what no titles run covered yet, at most once every 10 minutes.
    if (id && REFRESH && (await runTitlesLive(id)).ok) {
      const now = readCredentials();
      if (now) await flush(now, { budgetMs: 30_000 });
    }
    return;
  }
  if (BACKFILL >= 0) {
    const id = process.argv[BACKFILL + 1];
    if (id) await runBackfill(id);
    return;
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const payload: unknown = JSON.parse(input);
  if (!payload || typeof payload !== "object") return;
  const { stdout, event, backfill } = handleHook(
    payload as Record<string, unknown>,
    process.env,
    new Date(),
  );
  if (stdout)
    await new Promise<void>((r) => process.stdout.write(stdout, () => r()));
  if (!event || !creds) return;
  enqueue(event);
  // Synchronous hooks never wait on the network: their upload runs in a detached
  // process, as does a backfill, which flushes this event too.
  if (backfill || SYNC_HOOKS.has(event.hook)) {
    // A Stop that lets Claude finish may also refresh the plan; the child decides.
    const args = backfill
      ? ["--backfill", backfill]
      : [
          "--flush",
          event.sessionId,
          ...(event.hook === "Stop" && !stdout ? ["--refresh"] : []),
        ];
    spawn(process.execPath, [process.argv[1] as string, ...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } else {
    // Claude never waits on these hooks, so they read its new text themselves: while it
    // works through tools no Stop comes, and its words would wait for one. The read is
    // synchronous, so the 5 s timer below cannot cut it short: it gets its own 1 s.
    catchUpText(event.sessionId, process.env, 1000);
    await flush(creds);
  }
}
const SYNC_HOOKS = new Set(["SessionStart", "Stop", "UserPromptSubmit"]);

// Never block or fail Claude: always exit 0, and within 5 s whatever happens. A
// backfill or a refresh runs detached, so it gets 4 minutes: its uploads and its asks.
if (/[\\/]hook\.(c?js|ts)$/.test(process.argv[1] ?? "")) {
  const done = () => process.exit(0);
  process.on("uncaughtException", done);
  process.stdout.on("error", () => {});
  setTimeout(done, BACKFILL >= 0 || REFRESH ? 240_000 : 5000).unref();
  main().then(done, done);
}
