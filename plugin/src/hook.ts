import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  HOOK_NAMES,
  type HookName,
  MAP_TOOL,
  type MurmurEvent,
  NARRATE_TOOL,
  scrubEvent,
} from "@murmur/core";
import {
  clearNarration,
  clearProjectPause,
  isPaused,
  isRevoked,
  NARRATION_INSTRUCTION,
  NO_NARRATION,
  projectName,
  projectState,
  readCredentials,
  readNarration,
  setProjectState,
  writeNarration,
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

type Result = { stdout: string; event: MurmurEvent | null };
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

  if (start && payload.source === "startup") clearProjectPause(cwd);
  const state = projectState(cwd);
  if (state === undefined) {
    if (!start) return NONE;
    setProjectState(cwd, "asked");
    return show(askLine(cwd));
  }
  if (state !== "on") return NONE;
  const creds = readCredentials();
  if (!creds) return start ? show(LOGIN_LINE) : NONE;
  if (isRevoked()) return start ? show(REVOKED_LINE) : NONE;
  if (!sessionId || isPaused(cwd, sessionId)) return NONE;

  const event = scrubEvent({
    id: randomUUID(),
    sessionId,
    machineId: creds.machineId,
    cwd,
    ts: now.toISOString(),
    hook: hook as HookName,
    payload,
  });
  // Injected for every source, so the instruction survives compaction.
  const stdout = start
    ? JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: NARRATION_INSTRUCTION,
        },
      })
    : trackNarration(sessionId, hook, payload);
  return { stdout, event };
}

// ponytail: async PostToolUse hooks read-modify-write this file without a lock, so two
// narrate calls landing in the same few ms can lose one; worst case is one extra Stop block.
/** Records map and narrate calls; on Stop, asks once per request for the missing narration. */
function trackNarration(
  sessionId: string,
  hook: string,
  p: Record<string, unknown>,
): string {
  if (hook === "UserPromptSubmit") writeNarration(sessionId, NO_NARRATION);
  if (hook === "SessionEnd") clearNarration(sessionId);
  const tool = hook === "PostToolUse" ? p.tool_name : undefined;
  if (tool !== MAP_TOOL && tool !== NARRATE_TOOL && hook !== "Stop") return "";
  const n = readNarration(sessionId);
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
  writeNarration(sessionId, n);
  return out;
}

async function main(): Promise<void> {
  const creds = readCredentials();
  if (process.argv.includes("--flush")) {
    if (creds) await flush(creds);
    return;
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const payload: unknown = JSON.parse(input);
  if (!payload || typeof payload !== "object") return;
  const { stdout, event } = handleHook(
    payload as Record<string, unknown>,
    process.env,
    new Date(),
  );
  if (stdout)
    await new Promise<void>((r) => process.stdout.write(stdout, () => r()));
  if (!event || !creds) return;
  enqueue(event);
  if (event.hook === "SessionStart" || event.hook === "Stop") {
    // These two are synchronous hooks, so their upload runs in a detached process.
    spawn(process.execPath, [process.argv[1] as string, "--flush"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } else {
    await flush(creds);
  }
}

// Never block or fail Claude: always exit 0, and within 5 s whatever happens.
if (/[\\/]hook\.(c?js|ts)$/.test(process.argv[1] ?? "")) {
  const done = () => process.exit(0);
  process.on("uncaughtException", done);
  process.stdout.on("error", () => {});
  setTimeout(done, 5000).unref();
  main().then(done, done);
}
