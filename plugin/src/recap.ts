/*
 * The recap: what the imported history alone cannot say, the user's own Claude says once.
 * Runs in the detached backfill child, after the import. For each imported request with
 * no valid map, it asks `claude -p` (sonnet, no tools, no hooks, plugins or MCP servers,
 * no saved session, prompt on stdin) for a `RecapInput`, validates it with core's zod
 * schema, and queues it as `map` and `narrate` PostToolUse events marked `recap: true`,
 * with ids from the request id and times just after its prompt, so core draws it on the
 * narrated path. Any failure keeps the inferred view and logs one line. At most the 5
 * newest such requests, newest first, and no new ask after about 150 s; a request is
 * marked in the session file just before it is asked, so it is never asked twice, and
 * one not asked is asked by a later run. Before each ask it checks the project is still
 * on and the session not paused. The last request is left alone when the import started
 * inside it (`lastOpen`), since live narration may still come. `MURMUR_RECAP=0` turns it
 * off; a headless run, or the recap's own run (`MURMUR_RECAP_RUN=1`), never recaps.
 */
import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import {
  briefOf,
  MAP_TOOL,
  type MurmurEvent,
  NARRATE_TOOL,
  type RecapInput as Recap,
  RecapInput,
  type RequestView,
  reduce,
  relPath,
  scrubEvent,
} from "@murmur/core";
import { stableId } from "./backfill.js";
import {
  isHeadless,
  isPaused,
  isRevoked,
  readCredentials,
  readSession,
  sessionProjectState,
  updateSession,
} from "./local.js";
import { enqueue } from "./upload.js";

const MAX_INPUT = 60_000;
const TIMEOUT_MS = 60_000;
const PARALLEL = 3;
const MESSAGE_MAX = 3000;
const MAX_REQUESTS = 5;
// Under the backfill child's 4 minutes: its uploads, then asks that may take 60 s each.
const BUDGET_MS = 150_000;
const TEXT_MAX = 300;

export interface RecapOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** No new ask starts this long after the run began. */
  budgetMs?: number;
  /** The import started inside the last request: leave it to live narration. */
  lastOpen?: boolean;
  log?: (line: string) => void;
}

/**
 * Whether the last imported request may still be going on, from the hook that started
 * the import: only a new prompt, or a session resumed or started, closes it.
 */
export function lastRequestOpen(trigger: string | undefined): boolean {
  return !(
    trigger === "UserPromptSubmit" ||
    (trigger?.startsWith("SessionStart:") && trigger !== "SessionStart:compact")
  );
}

// The `claude` runs going now, killed when this process exits so none outlives it.
const live = new Set<ChildProcess>();
/** Kills every recap run still going. */
export function killRecaps(): void {
  for (const c of live) c.kill("SIGKILL");
}
process.once("exit", killRecaps);

const ARGS = [
  "-p",
  "--model",
  "sonnet",
  "--output-format",
  "json",
  "--tools",
  "",
  "--max-turns",
  "1",
  "--no-session-persistence",
  // No hooks (so no Murmur upload), plugins, MCP servers, CLAUDE.md or slash commands.
  "--safe-mode",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--settings",
  '{"disableAllHooks":true}',
];

const INSTRUCTIONS = `You summarise one finished request from a Claude Code session for Murmur, a page that shows a coding session as a story to the person who asked for it.
Below are the person's request, Claude's own messages to them in order, the helpers Claude started (H1, H2, ... with what each was asked and reported), and the files changed.
Answer with one JSON object and nothing else, in exactly this shape:
{
  "map": {
    "kind": "feature" | "bug" | "refactor" | "question",
    "goal": "the request in a few plain words",
    "phases": [{ "id": "p1", "title": "...", "tasks": [{ "id": "t1", "title": "...", "part": "<part id>" }] }],
    "parts": [{ "id": "<short id>", "title": "...", "phase": "p1", "links": [{ "to": "<part id>", "label": "uses" }] }]
  },
  "parts": [{
    "id": "<part id>",
    "aim": { "aim": "what this part is for", "doneWhen": "how we know it is done" },
    "steps": [{ "text": "what was done", "status": "done" | "failed" | "running" }],
    "choices": [{ "choice": "...", "reason": "...", "assumption": false }],
    "checks": [{ "check": "...", "status": "pass" | "fail" | "untried" }],
    "words": [{ "term": "a word the person may not know", "meaning": "plain meaning" }],
    "files": [{ "path": "<copied exactly from the file list>", "role": "what it does" }],
    "helpers": ["H1"]
  }],
  "tasks": [{ "id": "t1", "status": "done" | "failed" | "running", "ended": "one line on how it ended" }]
}
Rules: a part is one piece of the work (a task, a fix, a screen), not a folder. "map.parts" lists every part, and every task's "part" and every entry of "parts" uses one of those ids. Every task in "map" has one entry in "tasks". Keep the person's own names for things ("Task 1: ..."). Only say what the material shows; leave a field out rather than guess. Plain words, short. Every text at most 300 characters, "ended" at most 200, at most 20 items in any list.`;

const time = (ts: string) => ts.slice(11, 16);

/** The material for one request, capped at about 60,000 characters. */
export function recapInput(
  req: RequestView,
  cwd: string,
  calls: MurmurEvent[] = [],
): string {
  const used = new Set<string>();
  const helpers = calls.map((c, i) => {
    const input = (c.payload.tool_input ?? {}) as Record<string, unknown>;
    const description = String(input.description ?? "");
    const prompt = String(input.prompt ?? "");
    const agent = req.agents.find(
      (a) =>
        !used.has(a.id) && a.description === description && a.prompt === prompt,
    );
    if (agent) used.add(agent.id);
    const brief = agent?.brief ?? briefOf(prompt);
    const report = agent?.report;
    return [
      `H${i + 1}: ${description}`,
      brief ? `  Asked: ${brief}` : "",
      report?.verdict ? `  Verdict: ${report.verdict}` : "",
      report?.summary ? `  Summary: ${report.summary}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const files = [...req.parts.flatMap((p) => p.files), ...req.looseFiles].map(
    (f) => `${f.path} (+${f.added} -${f.removed}${f.isNew ? ", new" : ""})`,
  );
  const head = [
    INSTRUCTIONS,
    `\nProject folder: ${cwd}`,
    `\n## Request (${req.startedAt})\n${req.prompt.slice(0, 4000)}`,
    `\n## Helpers\n${helpers.join("\n") || "none"}`,
    `\n## Files changed\n${[...new Set(files)].join("\n") || "none"}`,
    "\n## Claude's messages, in order\n",
  ].join("\n");
  let out = head.slice(0, MAX_INPUT);
  for (const m of req.messages ?? []) {
    const text =
      m.text.length > MESSAGE_MAX ? `${m.text.slice(0, MESSAGE_MAX)}…` : m.text;
    const line = `[${time(m.ts)}] ${text}\n`;
    if (out.length + line.length > MAX_INPUT) {
      out += "[later messages left out]\n";
      break;
    }
    out += line;
  }
  return out;
}

type Answer =
  | { ok: true; recap: Recap; cost?: number }
  | { ok: false; why: string };
type Ask = Answer & { ms: number };

/** Runs the user's `claude -p` once with `input` on stdin. Never throws. */
function ask(
  input: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<Ask> {
  const t0 = Date.now();
  const done = (r: Answer): Ask => ({ ...r, ms: Date.now() - t0 });
  // Its own hooks must never upload. `-p` rewrites only an inherited `cli` entry point to
  // `sdk-cli` (an IDE's stays, attended), so it is made headless here and marked as the
  // recap's run, which the hook refuses outright; and no MURMUR_ALLOW_HEADLESS.
  const { MURMUR_ALLOW_HEADLESS: _, ...rest } = env;
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (r: Ask) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn("claude", ARGS, {
      cwd: os.tmpdir(),
      env: {
        ...rest,
        CLAUDE_CODE_ENTRYPOINT: "sdk-cli",
        CLAUDE_CODE_SESSION_ATTENDED: "0",
        MURMUR_RECAP_RUN: "1",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    live.add(child);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(done({ ok: false, why: `timed out after ${timeoutMs} ms` }));
    }, timeoutMs);
    child.on("error", (e) => {
      live.delete(child);
      finish(done({ ok: false, why: e.message }));
    });
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    // Killed (timeout, or this process exiting): done now, not when its own children
    // let go of the pipe.
    child.on("exit", (_code, signal) => {
      if (signal) finish(done({ ok: false, why: `killed (${signal})` }));
    });
    child.on("close", (code) => {
      live.delete(child);
      if (code !== 0)
        return finish(done({ ok: false, why: `exit code ${code}` }));
      finish(done(parse(out)));
    });
  });
}

/** `claude -p --output-format json` output (one result, or every message with it) as a recap. */
function parse(stdout: string): Answer {
  let res: Record<string, unknown> | undefined;
  try {
    const all: unknown = JSON.parse(stdout);
    const list = Array.isArray(all) ? all : [all];
    res = list.findLast(
      (m) =>
        m &&
        typeof m === "object" &&
        (m as { type?: unknown }).type === "result",
    ) as Record<string, unknown> | undefined;
  } catch {
    return { ok: false, why: "output is not JSON" };
  }
  if (!res || res.is_error === true || typeof res.result !== "string")
    return { ok: false, why: "no result" };
  const text = res.result.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, why: "the answer is not JSON" };
  }
  const recap = RecapInput.safeParse(json);
  if (!recap.success)
    return {
      ok: false,
      why: `the answer is not a recap (${recap.error.issues[0]?.path.join(".")})`,
    };
  const cost =
    typeof res.total_cost_usd === "number" ? res.total_cost_usd : undefined;
  return {
    ok: true,
    recap: recap.data,
    ...(cost === undefined ? {} : { cost }),
  };
}

/**
 * The recap as hook events: the map, each part's detail, its steps, its helpers (a
 * narrate per helper, as if the helper said it, so it joins the part), each task's end
 * as a step on its part, then one narrate with no part, so later file changes no recap
 * part names stay in Files touched.
 */
export function recapEvents(
  req: RequestView,
  recap: Recap,
  helperIds: (string | undefined)[],
  base: MurmurEvent,
  paths: Map<string, string> = new Map(),
): MurmurEvent[] {
  const out: MurmurEvent[] = [];
  const at = Date.parse(req.startedAt);
  const add = (
    tool: string,
    input: unknown,
    extra: Record<string, unknown> = {},
  ) => {
    const k = out.length + 1;
    const payload = {
      hook_event_name: "PostToolUse",
      session_id: base.sessionId,
      cwd: base.cwd,
      tool_name: tool,
      tool_input: input,
      tool_use_id: `murmur-recap:${req.id}:${k}`,
      recap: true,
      ...extra,
    };
    out.push(
      scrubEvent({
        id: stableId(base.sessionId, "PostToolUse", payload) as string,
        sessionId: base.sessionId,
        machineId: base.machineId,
        cwd: base.cwd,
        // A millisecond apart just after the prompt, in order, before what Claude did.
        ts: new Date(at + k).toISOString(),
        hook: "PostToolUse",
        payload,
      }),
    );
  };
  const cut = (s: string) => s.slice(0, 200);
  add(MAP_TOOL, recap.map);
  const tasks = recap.map.phases.flatMap((ph) => ph.tasks);
  for (const p of recap.parts) {
    const title = recap.map.parts.find((x) => x.id === p.id)?.title ?? p.id;
    const { id, steps, helpers, files, ...detail } = p;
    add(NARRATE_TOOL, {
      now: cut(title),
      why: "",
      part: id,
      ...detail,
      // Named by the path it was changed at, so it matches whatever cwd reads it.
      ...(files
        ? {
            files: files.map((f) => {
              // Too long for narrate's 300: the shown path, so the detail still holds.
              const full = paths.get(f.path);
              return {
                ...f,
                path: full && full.length <= TEXT_MAX ? full : f.path,
              };
            }),
          }
        : {}),
    });
    for (const step of steps ?? [])
      add(NARRATE_TOOL, { now: cut(step.text), why: "", part: id, step });
    for (const h of helpers ?? []) {
      const agentId = helperIds[Number(/^H(\d+)$/.exec(h)?.[1]) - 1];
      if (agentId)
        add(
          NARRATE_TOOL,
          { now: cut(title), why: "", part: id },
          { agent_id: agentId },
        );
    }
  }
  for (const t of recap.tasks) {
    const task = tasks.find((x) => x.id === t.id);
    if (!task) continue;
    add(NARRATE_TOOL, {
      now: t.ended,
      why: "",
      task: t.id,
      taskStatus: t.status,
      ...(task.part ? { step: { text: t.ended, status: t.status } } : {}),
    });
  }
  add(NARRATE_TOOL, { now: cut(recap.map.goal), why: "" });
  return out;
}

/** Recaps each imported request of `events` with no valid map, once. Returns how many it asked and how many came back valid. */
export async function runRecap(
  sessionId: string,
  events: MurmurEvent[],
  {
    env = process.env,
    timeoutMs = TIMEOUT_MS,
    budgetMs = BUDGET_MS,
    lastOpen = false,
    log = (l) => process.stderr.write(`${l}\n`),
  }: RecapOptions = {},
): Promise<{ ran: number; ok: number }> {
  if (
    env.MURMUR_RECAP === "0" ||
    env.MURMUR_RECAP_RUN === "1" ||
    isHeadless(env)
  )
    return { ran: 0, ok: 0 };
  const t0 = Date.now();
  const view = reduce(events);
  const done = new Set(readSession(sessionId).recapped ?? []);
  const last = view.requests.at(-1);
  // The 5 newest unmapped requests at most, newest first; older ones never.
  const queue = view.requests
    .filter((r) => r.planInferred && !(lastOpen && r === last))
    .reverse()
    .slice(0, MAX_REQUESTS)
    .filter((r) => !done.has(r.id));
  // Asked only while Murmur would send: logged in, on, not paused.
  const sending = () => {
    const s = readSession(sessionId);
    const cwd = s.cwd ?? view.cwd;
    return (
      readCredentials() !== null &&
      !isRevoked() &&
      sessionProjectState(cwd, sessionId) === "on" &&
      !isPaused(cwd, sessionId) &&
      !(s.project !== undefined && isPaused(s.project))
    );
  };
  const byId = new Map(events.map((e) => [e.id, e]));
  const calls = callsByRequest(events, new Set(view.requests.map((r) => r.id)));
  const paths = changedPaths(events);
  let ok = 0;
  let ran = 0;
  const worker = async () => {
    for (let req = queue.shift(); req; req = queue.shift()) {
      if (Date.now() - t0 > budgetMs || !sending()) return;
      // Marked just before it is asked: a run that dies here never asks it again.
      const s = readSession(sessionId);
      updateSession(sessionId, { recapped: [...(s.recapped ?? []), req.id] });
      ran++;
      const mine = calls.get(req.id) ?? [];
      const r = await ask(recapInput(req, view.cwd, mine), env, timeoutMs);
      const secs = (r.ms / 1000).toFixed(1);
      if (!r.ok) {
        log(
          `murmur recap: ${req.id} kept the inferred view: ${r.why} (${secs} s)`,
        );
        continue;
      }
      const helperIds = mine.map((c) => {
        const input = (c.payload.tool_input ?? {}) as Record<string, unknown>;
        return req.agents.find(
          (a) =>
            a.description === input.description && a.prompt === input.prompt,
        )?.id;
      });
      for (const e of recapEvents(
        req,
        r.recap,
        helperIds,
        byId.get(req.id) as MurmurEvent,
        paths,
      ))
        enqueue(e);
      ok++;
      log(
        `murmur recap: ${req.id} ok (${secs} s${r.cost === undefined ? "" : `, $${r.cost.toFixed(4)}`})`,
      );
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { ran, ok };
}

/** Each request's Agent calls, by request id (its prompt event's id). */
function callsByRequest(events: MurmurEvent[], ids: Set<string>) {
  const out = new Map<string, MurmurEvent[]>();
  let current: MurmurEvent[] | undefined;
  for (const e of [...events].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  )) {
    if (ids.has(e.id)) {
      current = [];
      out.set(e.id, current);
    }
    // Helpers Claude started, not ones a helper started.
    else if (
      current &&
      e.hook === "PreToolUse" &&
      e.payload.tool_name === "Agent" &&
      !e.payload.agent_id
    )
      current.push(e);
  }
  return out;
}

/**
 * Each changed file's path as the view shows it here, to the path it was changed at. A
 * helper in a worktree has the worktree as its cwd here, but the server gives every
 * event the session's cwd, so only the full path names the file the same way in both.
 */
// ponytail: one relative path changed both in a worktree and in the main tree maps to the
// last full path seen; key by (helper, path) if recaps ever name the wrong copy.
function changedPaths(events: MurmurEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  const add = (abs: unknown, cwd: string) => {
    if (typeof abs === "string") out.set(relPath(abs, cwd), abs);
  };
  for (const e of events) {
    if (e.hook !== "PostToolUse") continue;
    const res = (e.payload.tool_response ?? {}) as Record<string, unknown>;
    add(res.filePath, e.cwd);
    const diff = res.bashEditDiff as { files?: unknown } | undefined;
    for (const f of Array.isArray(diff?.files) ? diff.files : [])
      add((f as Record<string, unknown> | null)?.filePath, e.cwd);
  }
  return out;
}
