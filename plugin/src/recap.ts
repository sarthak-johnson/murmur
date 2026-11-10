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
 *
 * The refresh keeps a plan Claude drew itself true when Claude stops narrating it. In the
 * detached child a Stop spawns, it reads the transcript and, when the latest request has
 * a map from Claude that is stale (a task neither done nor failed, something new since the
 * last ask, and since the last task status change 3 helper reports or 20 minutes), asks the
 * same `claude -p` the same way about the tasks not done, by the map's own ids, and queues
 * the answer as `narrate` events marked `recap: true` and `refresh: true` (core never lets
 * them move "now"). An answer naming an id the map lacks is refused; one that would move a
 * task back (a done one, or failed to running) is dropped. At most one ask every 30
 * minutes per session; a child looks at most every 5 minutes, so one runs at a time. Same
 * switches as the recap, checked again before anything is queued.
 * Earlier requests count too: when the latest is not stale, the newest finished request
 * with a plan Claude drew, an open task and something new since its last ask gets one
 * final refresh, drawn just after its last event, and never another. A history import
 * forgets every refresh (the server has none of them) and runs one pass at its end.
 */
import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import {
  briefOf,
  MAP_TOOL,
  MapInput,
  type MurmurEvent,
  NARRATE_TOOL,
  NarrateInput,
  parseNotification,
  type RecapInput as Recap,
  RecapInput,
  RefreshInput,
  type RequestView,
  reduce,
  relPath,
  scrubEvent,
} from "@murmur/core";
import { readBackfill, stableId } from "./backfill.js";
import {
  isHeadless,
  isPaused,
  isRevoked,
  type RefreshState,
  type RequestRefresh,
  readCredentials,
  readRefresh,
  readSession,
  sessionProjectState,
  updateSession,
  writeRefresh,
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
const MINUTE = 60_000;
// A child looks this often at most per session; longer than a refresh can run.
const CHECK_MS = 5 * MINUTE;
const REFRESH_EVERY_MS = 30 * MINUTE;
const STALE_MS = 20 * MINUTE;
const STALE_REPORTS = 3;

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
    "short": "what the request did in 2 to 5 words, like a title, never the person's own words",
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
  instructions = INSTRUCTIONS,
  /** Keep the newest messages when they do not all fit (the refresh), not the oldest. */
  newest = false,
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
    instructions,
    `\nProject folder: ${cwd}`,
    `\n## Request (${req.startedAt})\n${req.prompt.slice(0, 4000)}`,
    `\n## Helpers\n${helpers.join("\n") || "none"}`,
    `\n## Files changed\n${[...new Set(files)].join("\n") || "none"}`,
    "\n## Claude's messages, in order\n",
  ].join("\n");
  const out = head.slice(0, MAX_INPUT);
  const lines = (req.messages ?? []).map((m) => {
    const text =
      m.text.length > MESSAGE_MAX ? `${m.text.slice(0, MESSAGE_MAX)}…` : m.text;
    return `[${time(m.ts)}] ${text}\n`;
  });
  if (newest) lines.reverse();
  let room = MAX_INPUT - out.length;
  const kept: string[] = [];
  for (const line of lines) {
    if (line.length > room) break;
    kept.push(line);
    room -= line.length;
  }
  if (newest) kept.reverse();
  const cut = kept.length < lines.length;
  return newest
    ? `${out}${cut ? "[earlier messages left out]\n" : ""}${kept.join("")}`
    : `${out}${kept.join("")}${cut ? "[later messages left out]\n" : ""}`;
}

type Answer =
  | { ok: true; json: unknown; cost?: number }
  | { ok: false; why: string };
export type Ask = Answer & { ms: number };

/** Runs the user's `claude -p` once with `input` on stdin. Never throws. */
export function ask(
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

/** `claude -p --output-format json` output (one result, or every message with it) as the answer's JSON. */
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
  const cost =
    typeof res.total_cost_usd === "number" ? res.total_cost_usd : undefined;
  return { ok: true, json, ...(cost === undefined ? {} : { cost }) };
}

/** What the ask cost, as `claude -p` reported it, for the log line. */
export const costOf = (r: Ask) =>
  r.ok && r.cost !== undefined ? `, $${r.cost.toFixed(4)}` : "";

/** Why a zod check refused the answer, for the one log line. */
export const refused = (
  what: string,
  r: { error?: { issues: { path: PropertyKey[] }[] } } | undefined,
) => `the answer is not ${what} (${r?.error?.issues[0]?.path.join(".")})`;

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
  // A millisecond apart just after the prompt, in order, before what Claude did.
  const { out, add } = emitter(
    base,
    `murmur-recap:${req.id}`,
    Date.parse(req.startedAt),
  );
  add(MAP_TOOL, recap.map);
  const tasks = recap.map.phases.flatMap((ph) => ph.tasks);
  for (const p of recap.parts) {
    const title = recap.map.parts.find((x) => x.id === p.id)?.title ?? p.id;
    const { steps, helpers, ...detail } = p;
    add(NARRATE_TOOL, detailNarrate(title, detail, paths));
    for (const step of steps ?? [])
      add(NARRATE_TOOL, { now: cut(step.text), why: "", part: p.id, step });
    for (const h of helpers ?? []) {
      const agentId = helperIds[Number(/^H(\d+)$/.exec(h)?.[1]) - 1];
      if (agentId)
        add(
          NARRATE_TOOL,
          { now: cut(title), why: "", part: p.id },
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

const cut = (s: string) => s.slice(0, 200);

/**
 * Queues nothing itself: builds hook events for Murmur's own tool calls, marked
 * `recap: true`, a millisecond apart from `at`, ids from `key` and their order.
 */
export function emitter(
  base: MurmurEvent,
  key: string,
  at: number,
  mark: Record<string, unknown> = {},
) {
  const out: MurmurEvent[] = [];
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
      tool_use_id: `${key}:${k}`,
      recap: true,
      ...mark,
      ...extra,
    };
    out.push(
      scrubEvent({
        id: stableId(base.sessionId, "PostToolUse", payload) as string,
        sessionId: base.sessionId,
        machineId: base.machineId,
        cwd: base.cwd,
        ts: new Date(at + k).toISOString(),
        hook: "PostToolUse",
        payload,
      }),
    );
  };
  return { out, add };
}

type Detail = RefreshInput["parts"][number];
/** A part's detail as one narrate, its files named by the path they were changed at. */
function detailNarrate(
  title: string,
  { id, files, ...detail }: Detail,
  paths: Map<string, string>,
) {
  return {
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
  };
}

/** `sending`, and still the login it started with. */
export const stillSending = (sessionId: string, cwd: string, token?: string) =>
  token !== undefined &&
  readCredentials()?.token === token &&
  sending(sessionId, cwd);

/** Whether Murmur would send for this session now: logged in, on, not paused. */
export function sending(sessionId: string, cwd: string): boolean {
  const s = readSession(sessionId);
  const at = s.cwd ?? cwd;
  return (
    readCredentials() !== null &&
    !isRevoked() &&
    sessionProjectState(at, sessionId) === "on" &&
    !isPaused(at, sessionId) &&
    !(s.project !== undefined && isPaused(s.project))
  );
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
  const byId = new Map(events.map((e) => [e.id, e]));
  const token = readCredentials()?.token;
  const calls = callsByRequest(events, new Set(view.requests.map((r) => r.id)));
  const paths = changedPaths(events);
  let ok = 0;
  let ran = 0;
  const worker = async () => {
    for (let req = queue.shift(); req; req = queue.shift()) {
      // Asked only while Murmur would send.
      if (Date.now() - t0 > budgetMs || !sending(sessionId, view.cwd)) return;
      // Marked just before it is asked: a run that dies here never asks it again.
      const s = readSession(sessionId);
      updateSession(sessionId, { recapped: [...(s.recapped ?? []), req.id] });
      ran++;
      const mine = calls.get(req.id) ?? [];
      const r = await ask(recapInput(req, view.cwd, mine), env, timeoutMs);
      const secs = (r.ms / 1000).toFixed(1);
      const recap = r.ok ? RecapInput.safeParse(r.json) : undefined;
      if (!recap?.success) {
        const reason = r.ok ? refused("a recap", recap) : r.why;
        log(
          `murmur recap: ${req.id} kept the inferred view: ${reason} (${secs} s)`,
        );
        continue;
      }
      // Paused, off or logged out while it was asked: the answer is not sent.
      if (!stillSending(sessionId, view.cwd, token)) {
        log(
          `murmur recap: ${req.id} not sent: Murmur stopped sending (${secs} s)`,
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
        recap.data,
        helperIds,
        byId.get(req.id) as MurmurEvent,
        paths,
      ))
        enqueue(e);
      ok++;
      log(`murmur recap: ${req.id} ok (${secs} s${costOf(r)})`);
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

/** Where the plan of a request stands, from its own events and the last refresh's answer. */
interface PlanState {
  /** Each task's status as Murmur last heard it (running, failed or done), or none yet. */
  statuses: Map<string, string>;
  /** When a task's status last changed, else when the map came. */
  changed: number;
  /** Helper reports since then. */
  reports: number;
  /** When the newest report, message or narrate came. */
  latest: number;
}

// Claude's own "blocked" reads as failed; a status only moves forward, and done stays.
const RANK: Record<string, number> = { running: 1, failed: 2, done: 3 };
const settled = (s: string | undefined) => s === "done" || s === "failed";
const forward = (from: string | undefined, to: string) =>
  (RANK[to] ?? 0) > (from === undefined ? 0 : (RANK[from] ?? 0));

/** A helper's final report's text, from a task notification or a foreground result. */
function reportOf(e: MurmurEvent): string | undefined {
  if (e.hook === "UserPromptSubmit") {
    const p = e.payload.prompt;
    const n = typeof p === "string" ? parseNotification(p, e.ts) : undefined;
    return n && !n.report.interim
      ? n.report.text || n.report.summary
      : undefined;
  }
  const res = (e.payload.tool_response ?? {}) as Record<string, unknown>;
  if (
    e.hook !== "PostToolUse" ||
    e.payload.tool_name !== "Agent" ||
    e.payload.agent_id ||
    res.status === "async_launched" ||
    res.isAsync === true
  )
    return undefined;
  const content = Array.isArray(res.content) ? res.content : [];
  return content
    .map((b: { text?: unknown }) => (typeof b?.text === "string" ? b.text : ""))
    .join("\n");
}

/** The request's helper reports, newest kept, each cut, about 25,000 characters in all. */
function reportsInput(events: MurmurEvent[]): string {
  const lines: string[] = [];
  let size = 0;
  for (const e of events.toReversed()) {
    const text = reportOf(e);
    if (text === undefined) continue;
    const line = `[${time(e.ts)}] ${text.length > 1500 ? `${text.slice(0, 1500)}…` : text}`;
    if (size + line.length > 25_000) break;
    lines.unshift(line);
    size += line.length;
  }
  return lines.join("\n") || "none";
}

/** The plan state over a request's events (in time order), with `prior`'s statuses at its time. */
function planState(events: MurmurEvent[], prior?: RequestRefresh): PlanState {
  const st: PlanState = {
    statuses: new Map(),
    changed: NaN,
    reports: 0,
    latest: NaN,
  };
  const set = (task: string, said: string, ts: string) => {
    const status = said === "blocked" ? "failed" : said;
    const was = st.statuses.get(task);
    if (was === status || was === "done") return;
    st.statuses.set(task, status);
    st.changed = Date.parse(ts);
    st.reports = 0;
  };
  let pending = prior?.at && prior.tasks ? prior : undefined;
  const overlay = () => {
    for (const [id, s] of Object.entries(pending?.tasks ?? {}))
      set(id, s, pending?.at as string);
    pending = undefined;
  };
  for (const e of events) {
    if (pending && e.ts > (pending.at as string)) overlay();
    const input = e.hook === "PostToolUse" ? e.payload.tool_input : undefined;
    if (e.payload.tool_name === MAP_TOOL && MapInput.safeParse(input).success) {
      if (Number.isNaN(st.changed)) st.changed = Date.parse(e.ts);
      continue;
    }
    const n =
      e.payload.tool_name === NARRATE_TOOL
        ? NarrateInput.safeParse(input)
        : undefined;
    const report = n?.success ? undefined : reportOf(e);
    if (n?.success || report !== undefined || e.hook === "AssistantText")
      st.latest = Date.parse(e.ts);
    if (n?.success) {
      const { task, taskStatus } = n.data;
      if (task && taskStatus) set(task, taskStatus, e.ts);
    } else if (report !== undefined) st.reports++;
  }
  if (pending) overlay();
  return st;
}

const REFRESH_INSTRUCTIONS = `You bring the plan of one request in a Claude Code session up to date for Murmur, a page that shows a coding session as a story to the person who asked for it.
Claude drew this plan itself at the start, but did not always say when a task moved on. Below is the plan as Murmur shows it now, with each open task's status, then the person's request, what the helpers reported, the helpers Claude started (H1, H2, ... with what each was asked), the files changed, and Claude's own messages in order.
Answer with one JSON object and nothing else, in exactly this shape:
{
  "tasks": [{ "id": "<task id from the plan>", "status": "done" | "failed" | "running", "ended": "one line on how it ended, or where it stands" }],
  "parts": [{
    "id": "<part id from the plan>",
    "aim": { "aim": "what this part is for", "doneWhen": "how we know it is done" },
    "choices": [{ "choice": "...", "reason": "...", "assumption": false }],
    "checks": [{ "check": "...", "status": "pass" | "fail" | "untried" }],
    "words": [{ "term": "a word the person may not know", "meaning": "plain meaning" }],
    "files": [{ "path": "<copied exactly from the file list>", "role": "what it does" }]
  }]
}
Rules: use only the task and part ids in the plan, exactly as written; never add, rename or drop one. The tasks under "done" are finished: say nothing of them. Give one entry in "tasks" for every task in the plan that has started. A task is "done" only when the material shows it finished (a helper reported it done, Claude said so, a commit or review passed); "running" while it is under way; "failed" when it was given up or is blocked. Only say what the material shows; leave a field out rather than guess. Plain words, short. Every text at most 300 characters, "ended" at most 200, at most 20 items in any list.`;

/** Each request's refresh state, reading the one-request state of the first version too. */
function requestsOf(r?: RefreshState): Record<string, RequestRefresh> {
  if (r?.requests) return r.requests;
  if (!r?.request) return {};
  const { tried, at, tasks } = r;
  return {
    [r.request]: {
      ...(tried ? { tried } : {}),
      ...(at ? { at } : {}),
      ...(tasks ? { tasks } : {}),
    },
  };
}

/**
 * The one request to ask about, if any: the latest when it is stale by the live rules
 * (an open task, something new since its last ask, and 3 reports or 20 minutes since its
 * last status change), else the newest finished request with an open task, something
 * new since its last ask and no final refresh yet. Only plans Claude drew count.
 */
function pickRequest(
  requests: RequestView[],
  events: MurmurEvent[],
  per: Record<string, RequestRefresh>,
  t: number,
) {
  for (let i = requests.length - 1; i >= 0; i--) {
    const req = requests[i] as RequestView;
    const next = requests[i + 1];
    const mine = per[req.id];
    if (req.planInferred || req.recap || (next && mine?.final)) continue;
    const own = events.filter(
      (e) => e.ts >= req.startedAt && (!next || e.ts < next.startedAt),
    );
    const st = planState(own, mine);
    const open = req.phases.some((ph) =>
      ph.tasks.some((x) => !settled(st.statuses.get(x.id))),
    );
    const news = !mine?.tried || st.latest > Date.parse(mine.tried);
    const due =
      !!next || st.reports >= STALE_REPORTS || t - st.changed >= STALE_MS;
    if (open && news && due) return { req, own, st, finished: !!next };
  }
  return undefined;
}

export interface RefreshOptions {
  env?: NodeJS.ProcessEnv;
  /** The time it runs at: what "stale" and the refresh's event times count from. */
  now?: Date;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/**
 * In the detached child after a Stop: refreshes the plan of the session's latest request
 * when Claude mapped it, a task is neither done nor failed, something new came since the
 * last ask, and since the last task status change 3 helper reports came or 20 minutes
 * passed. Reads the transcript (never in the hook). Returns whether it asked and whether
 * the answer was queued.
 */
export async function runRefresh(
  sessionId: string,
  {
    env = process.env,
    now = new Date(),
    timeoutMs = TIMEOUT_MS,
    log = (l) => process.stderr.write(`${l}\n`),
  }: RefreshOptions = {},
): Promise<{ ran: number; ok: number }> {
  const none = { ran: 0, ok: 0 };
  if (
    env.MURMUR_RECAP === "0" ||
    env.MURMUR_RECAP_RUN === "1" ||
    isHeadless(env)
  )
    return none;
  const s = readSession(sessionId);
  const creds = readCredentials();
  const t = now.getTime();
  const iso = now.toISOString();
  if (
    s.backfill !== "done" ||
    !s.transcriptPath ||
    !s.cwd ||
    !creds ||
    !sending(sessionId, s.cwd)
  )
    return none;
  const prior = readRefresh(sessionId);
  // One look per 5 minutes per session, marked before the read, so one runs at a time;
  // one ask per 30 minutes per session, whatever the request.
  if (prior && t - Date.parse(prior.checked) < CHECK_MS) return none;
  if (prior?.tried && t - Date.parse(prior.tried) < REFRESH_EVERY_MS)
    return none;
  const per = requestsOf(prior);
  writeRefresh(sessionId, {
    ...(prior?.tried ? { tried: prior.tried } : {}),
    requests: per,
    checked: iso,
  });

  const events = readBackfill({
    sessionId,
    machineId: creds.machineId,
    cwd: s.cwd,
    transcriptPath: s.transcriptPath,
    cutoff: iso,
  });
  const view = reduce(events);
  const pick = pickRequest(view.requests, events, per, t);
  if (!pick) return none;
  const { req, own, st, finished } = pick;
  const mine = per[req.id];
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  // The latest request's answer is timed now; a finished one's just after its last
  // event, so it draws on that request and not on the one after.
  // ponytail: a request whose next prompt came within ~40 ms of its last event would
  // spill refresh events into the next one; never seen, clamp if it ever is.
  const atMs = finished ? Date.parse((own.at(-1) as MurmurEvent).ts) + 1 : t;

  // Marked before it is asked: whatever comes back, not again for 30 minutes, and a
  // finished request never again.
  writeRefresh(sessionId, {
    checked: iso,
    tried: iso,
    requests: {
      ...per,
      [req.id]: { ...mine, tried: iso, ...(finished ? { final: true } : {}) },
    },
  });
  const done = (id: string) => st.statuses.get(id) === "done";
  // Only what is still open is asked about.
  const plan = {
    goal: req.goal,
    done: tasks.filter((x) => done(x.id)).map((x) => x.title),
    phases: req.phases.flatMap((ph) => {
      const open = ph.tasks.filter((x) => !done(x.id));
      return open.length
        ? [
            {
              id: ph.id,
              title: ph.title,
              tasks: open.map((x) => ({
                id: x.id,
                title: x.title,
                part: x.part,
                status: st.statuses.get(x.id) ?? "not started",
              })),
            },
          ]
        : [];
    }),
    parts: req.parts.map((p) => ({ id: p.id, title: p.title })),
  };
  const calls = callsByRequest(events, new Set([req.id])).get(req.id) ?? [];
  const input = recapInput(
    req,
    view.cwd,
    calls,
    `${REFRESH_INSTRUCTIONS}\n\n## The plan now\n${JSON.stringify(plan)}\n\n## Helper reports, in order\n${reportsInput(own)}`,
    true,
  );
  const r = await ask(input, env, timeoutMs);
  const secs = (r.ms / 1000).toFixed(1);
  const answer = r.ok ? RefreshInput.safeParse(r.json) : undefined;
  const ids = new Set([
    ...tasks.map((x) => `task:${x.id}`),
    ...req.parts.map((p) => `part:${p.id}`),
  ]);
  const reason = !r.ok
    ? r.why
    : !answer?.success
      ? refused("a refresh", answer)
      : [
            ...answer.data.tasks.map((x) => `task:${x.id}`),
            ...answer.data.parts.map((p) => `part:${p.id}`),
          ].find((id) => !ids.has(id))
        ? "it names an id the plan does not have"
        : // Paused, off or logged out while it was asked.
          !stillSending(sessionId, s.cwd, creds.token)
          ? "Murmur stopped sending"
          : undefined;
  if (reason || !answer?.success) {
    log(`murmur refresh: ${req.id} kept the plan: ${reason} (${secs} s)`);
    return { ran: 1, ok: 0 };
  }
  // A status only moves forward: what is done stays done, failed never goes back to running.
  const moved = answer.data.tasks.filter((x) =>
    forward(st.statuses.get(x.id), x.status),
  );
  for (const e of refreshEvents(
    req,
    { ...answer.data, tasks: moved },
    events.find((e) => e.id === req.id) as MurmurEvent,
    changedPaths(events),
    atMs,
  ))
    enqueue(e);
  const after = readRefresh(sessionId);
  writeRefresh(sessionId, {
    checked: iso,
    tried: iso,
    requests: {
      ...requestsOf(after),
      [req.id]: {
        tried: iso,
        ...(finished ? { final: true } : {}),
        at: new Date(atMs).toISOString(),
        // Every status the plan has now, not only this answer's, which may leave one out.
        tasks: Object.fromEntries([
          ...st.statuses,
          ...moved.map((x) => [x.id, x.status] as const),
        ]),
      },
    },
  });
  log(`murmur refresh: ${req.id} ok (${secs} s${costOf(r)})`);
  return { ran: 1, ok: 1 };
}

/**
 * A refresh as narrate events at its own time, marked `refresh: true` so they never move
 * "now": each part's detail (an aim only where the part has none, or only one Murmur
 * read from the record), then each task that
 * moved forward, with its line as a step on its part.
 */
function refreshEvents(
  req: RequestView,
  r: RefreshInput,
  base: MurmurEvent,
  paths: Map<string, string>,
  at: number,
): MurmurEvent[] {
  const { out, add } = emitter(
    base,
    `murmur-refresh:${req.id}:${new Date(at).toISOString()}`,
    at,
    { refresh: true },
  );
  for (const p of r.parts) {
    const part = req.parts.find((x) => x.id === p.id);
    const { aim, ...detail } = p;
    add(
      NARRATE_TOOL,
      detailNarrate(
        part?.title ?? p.id,
        {
          ...detail,
          ...(aim && (!part?.aim || part.aim.inferred) ? { aim } : {}),
        },
        paths,
      ),
    );
  }
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  for (const x of r.tasks)
    add(NARRATE_TOOL, {
      now: x.ended,
      why: "",
      task: x.id,
      taskStatus: x.status,
      ...(tasks.find((y) => y.id === x.id)?.part
        ? { step: { text: x.ended, status: x.status } }
        : {}),
    });
  return out;
}
