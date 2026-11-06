import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  HOOK_NAMES,
  type HookName,
  isNotRequest,
  MAP_TOOL,
  type MurmurEvent,
  NARRATE_TOOL,
  scrubEvent,
} from "@murmur/core";
import { backfillStale, runBackfill, stableId } from "./backfill.js";
import { MID_SESSION_LINE } from "./instruction.js";
import {
  clearProjectPause,
  isNewSession,
  isPaused,
  isRevoked,
  NARRATION_INSTRUCTION,
  NO_NARRATION,
  projectKey,
  projectName,
  pruneSessions,
  readCredentials,
  readSession,
  sessionProjectState,
  setProjectState,
  updateSession,
  writeSession,
} from "./local.js";
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

// docs/hook-facts.md section 6. Other entrypoints (cli, IDE extensions, desktop)
// are interactive and must upload.
function isHeadless(env: NodeJS.ProcessEnv): boolean {
  return (
    (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk") ||
    env.CLAUDE_CODE_SESSION_ATTENDED === "0"
  );
}

export function handleHook(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  now: Date,
): Result {
  const hook = payload.hook_event_name;
  const cwd = payload.cwd;
  if (
    typeof hook !== "string" ||
    !(HOOK_NAMES as readonly string[]).includes(hook)
  )
    return NONE;
  if (isHeadless(env) && env.MURMUR_ALLOW_HEADLESS !== "1") return NONE;
  if (typeof cwd !== "string" || !cwd) return NONE;
  const sessionId =
    typeof payload.session_id === "string" && payload.session_id
      ? payload.session_id
      : env.CLAUDE_CODE_SESSION_ID;
  const start = hook === "SessionStart";

  if (start && payload.source === "startup") {
    clearProjectPause(cwd);
    pruneSessions(now);
  }
  const state = sessionProjectState(cwd, sessionId);
  if (state === undefined) {
    if (!start) return NONE;
    setProjectState(cwd, "asked");
    return show(askLine(cwd));
  }
  if (state === "off") {
    // A session seen while its project is off is never imported after /murmur:on.
    if (sessionId && isNewSession(sessionId))
      updateSession(sessionId, { backfill: "done" });
    return NONE;
  }
  if (state !== "on") return NONE;
  const creds = readCredentials();
  if (!creds) return start ? show(LOGIN_LINE) : NONE;
  if (isRevoked()) return start ? show(REVOKED_LINE) : NONE;
  if (!sessionId) return NONE;
  const fresh = isNewSession(sessionId);
  // First seen while its project is on: from now on the session follows that project,
  // so a cd into a worktree or another folder keeps it on.
  const seen = readSession(sessionId);
  const project = seen.project ?? projectKey(cwd);
  // A session file that could not be read is rewritten as already imported.
  if (!seen.project || (!fresh && !seen.backfill))
    updateSession(sessionId, {
      project,
      ...(fresh ? {} : { backfill: seen.backfill ?? "done" }),
    });
  if (isPaused(cwd, sessionId) || isPaused(project)) {
    // What happens while paused is never shown, not even by a later backfill.
    if (fresh) updateSession(sessionId, { backfill: "done" });
    return NONE;
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
        ...(hook === "UserPromptSubmit" && typeof payload.prompt === "string"
          ? { triggerPrompt: payload.prompt }
          : {}),
        transcriptPath,
        cwd,
      });
      backfill = sessionId;
    } else updateSession(sessionId, { backfill: "done" });
  } else if (backfillStale(readSession(sessionId), now.getTime())) {
    // Its child died: hand the same cutoff to a new one.
    updateSession(sessionId, { backfill: "pending", runningSince: ts });
    backfill = sessionId;
  }
  // A prompt that is not a request (a task notification, /murmur:*) stays part of the
  // request before, as core reads it: no narration reset, no instruction.
  const prompt = hook === "UserPromptSubmit" && !isNotRequest(payload.prompt);
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

async function main(): Promise<void> {
  const creds = readCredentials();
  if (process.argv.includes("--flush")) {
    if (creds) await flush(creds);
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
    const args = backfill ? ["--backfill", backfill] : ["--flush"];
    spawn(process.execPath, [process.argv[1] as string, ...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } else {
    await flush(creds);
  }
}
const SYNC_HOOKS = new Set(["SessionStart", "Stop", "UserPromptSubmit"]);

// Never block or fail Claude: always exit 0, and within 5 s whatever happens. A
// backfill runs detached, so it gets a minute.
if (/[\\/]hook\.(c?js|ts)$/.test(process.argv[1] ?? "")) {
  const done = () => process.exit(0);
  process.on("uncaughtException", done);
  process.stdout.on("error", () => {});
  setTimeout(done, BACKFILL >= 0 ? 60_000 : 5000).unref();
  main().then(done, done);
}
