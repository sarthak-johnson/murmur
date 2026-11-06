# Murmur Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Wave 1 of Murmur: a Claude Code plugin that narrates and forwards a session, a hosted server that stores it per account, and a dark web page that shows the live story, plan, map, drill-down and flags.

**Architecture:** The plugin forwards every hook event (scrubbed) to the server and gives Claude two MCP tools, `map` and `narrate`, plus a standing instruction to use them.
The server is a thin, authenticated store of raw events with a live push channel.
All interpretation lives in one pure function, `reduce(events) -> SessionView`, in a shared package that the browser runs.

**Tech Stack:** TypeScript (strict, ESM), Node 22+, pnpm workspaces, Vitest, Zod, Biome.
Plugin: `@modelcontextprotocol/sdk`, esbuild (bundles committed to `plugin/dist`).
Server: Hono with `@hono/node-server`, Drizzle ORM, Postgres (`pg`) in production and PGlite (`@electric-sql/pglite`) for tests and local dev, `arctic` for GitHub OAuth.
Web: React 19, Vite, plain CSS with tokens, Testing Library.
E2E: real `claude -p --plugin-dir`, Playwright for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-06-murmur-design.md` (read it first; this plan argues from it).

## Global Constraints

- Dark theme only; there is no light theme.
- Reading order everywhere: now and why, then plan position, then the map, then details.
- Plain words first; code, diffs and raw tool calls only one click deeper.
- Nothing jumps: fixed section positions, new items fade in (disabled under `prefers-reduced-motion`), existing map nodes never move when parts are added.
- Colours, each with one meaning: now `--now`, done `--done`, subagents `--agent`, stuck or failing `--bad`; everything else grey.
- Our product never calls a model on the user's Claude subscription; all plain-words text comes from Claude through `map` and `narrate`.
- The plugin never reads Claude Code's stored credentials.
- Nothing uploads until the user turns the project on; headless runs (`claude -p`, SDK, CI) never upload unless `MURMUR_ALLOW_HEADLESS=1`.
- Secrets are scrubbed in the plugin before upload.
- v1 is single-user; sessions are deleted after 90 days by default (user-adjustable).
- Supported: Claude Code on macOS and Linux (terminal, IDE extensions, desktop app); Windows best effort.
- Strings longer than 262144 characters inside an event are truncated with the suffix `…[truncated N chars]`.
- Copy rule: never use the em dash character in UI copy or docs.
- Commits: plain messages, no co-author trailers.

## Review Focus

- Claude never calls `map` or `narrate` (ignored instruction, small model, after compaction): the screen still shows a plan from native tasks, files and steps, each labelled "inferred". Pinned in Task 5.
- The laptop is offline or the server is down: hooks never slow Claude, events queue locally and arrive later in order. Pinned in Task 7.
- A huge Write or Bash output: the event is truncated per Global Constraints and batches stay under 5 MB. Pinned in Tasks 2 and 7.
- Malformed narration or narration that names unknown parts or tasks: ignored fields fall back to the request level; nothing throws. Pinned in Task 3.
- Duplicate or out-of-order events (retries, two flushers, clock skew between subagents): the reducer sorts by `ts` then `id` and drops duplicate ids. Pinned in Task 3.

---

## File structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, .github/workflows/ci.yml
.claude-plugin/marketplace.json                 marketplace "murmur", plugin source "./plugin"
packages/core/src/
  events.ts        MurmurEvent envelope + tolerant hook payload readers
  narration.ts     MapInput / NarrateInput Zod schemas (shared by MCP tools and reducer)
  scrub.ts         secret scrubbing + truncation
  view/types.ts    SessionView and friends
  view/reduce.ts   reduce(events) entry point
  view/requests.ts request splitting, map + narrate application
  view/files.ts    file touches from Edit/Write results
  view/agents.ts   subagents
  view/flags.ts    needs-you, stuck, risky, assumptions
  view/infer.ts    fallbacks when Claude did not narrate
  view/catchup.ts  "since you last looked" line
  index.ts
plugin/
  .claude-plugin/plugin.json, hooks/hooks.json, .mcp.json, bin/murmur, commands/{login,logout,on,off,pause,resume,status}.md
  src/local.ts     ~/.config/murmur state
  src/instruction.ts narration instruction text
  src/hook.ts      single hook entry (all events)
  src/upload.ts    queue + flush
  src/mcp.ts       MCP server with map/narrate
  src/cli.ts       login/logout/on/off/pause/resume/status
  dist/{hook,mcp,cli}.cjs  committed bundles
server/src/
  db/schema.ts, db/client.ts, drizzle/ (migrations)
  app.ts           createApp(deps) Hono app
  auth.ts          GitHub OAuth, dev login, cookie sessions
  device.ts        device-code login + ingest tokens
  ingest.ts        POST /api/ingest
  sessions.ts      list, events, assumptions, delete
  stream.ts        SSE + in-process bus
  account.ts       settings, machines, delete account
  retention.ts     runRetention
  index.ts         serve API + web/dist
web/src/
  main.tsx, App.tsx, router.ts, api.ts, theme.css
  useSession.ts, lastLooked.ts
  pages/{Login,Device,Sessions,Session,Settings}.tsx
  live/{RequestList,PhaseStrip,CatchUp,NowCard,PlanPanel,FlagsBar,Assumptions}.tsx
  map/layout.ts, map/MapView.tsx
  part/PartDetail.tsx
e2e/real-session.test.ts, e2e/fixtures/
```

---

### Task 1: Workspace and real hook fixtures

The whole plan rests on real hook payloads, so capture them before writing any parser.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.github/workflows/ci.yml`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `tools/capture-plugin/.claude-plugin/plugin.json`, `tools/capture-plugin/hooks/hooks.json`, `tools/capture-plugin/capture.mjs`
- Create: `e2e/fixtures/*.jsonl`, `docs/hook-facts.md`

**Interfaces:**
- Produces: workspace scripts `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint`; fixture files used by Tasks 3 to 6 and 18.

- [ ] **Step 1: Create the pnpm workspace** with packages `packages/*`, `plugin`, `server`, `web`, root scripts `typecheck`, `test`, `lint` (`biome check .`), Node engine `>=22`, and CI running install, lint, typecheck, test.
- [ ] **Step 2: Write the capture plugin.** `capture.mjs` appends `{"hook": <hook_event_name>, "env": {CLAUDE_CODE_ENTRYPOINT, CLAUDE_SESSION_ID, CLAUDE_PROJECT_DIR}, "payload": <stdin JSON>}` as one line to `$CAPTURE_OUT`. Register it for every event named in spec 5.2 plus `SessionStart` returning `{"systemMessage":"capture: hello"}`.
- [ ] **Step 3: Record fixtures.** In a temp git repo, run `CAPTURE_OUT=e2e/fixtures/feature.jsonl claude -p --plugin-dir tools/capture-plugin --permission-mode acceptEdits --max-budget-usd 1 "<prompt>"` with a prompt that makes Claude create tasks, write a new file, edit it, run a failing then passing shell command, and spawn one subagent. Record a second fixture from a short interactive session (`claude --plugin-dir tools/capture-plugin`, answer one permission prompt, wait for idle) to `interactive.jsonl`.
- [ ] **Step 4: Write `docs/hook-facts.md`** answering, from the fixtures, with one example each: the exact `TaskCreated`/`TaskCompleted` payload fields; `tool_response` shape for Write (`type: "create"|"update"`, `structuredPatch`) and Edit; Agent tool `tool_input` fields; `SubagentStart`/`SubagentStop` fields; `Notification.notification_type` values seen; which env or payload field distinguishes `claude -p` from interactive; whether `systemMessage` from SessionStart was shown in the interactive terminal; whether `CLAUDE_SESSION_ID` is set for `!` command execution.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add workspace and real hook fixtures"
```

---

### Task 2: Core events, narration schemas and scrubbing

**Files:**
- Create: `packages/core/src/events.ts`, `packages/core/src/narration.ts`, `packages/core/src/scrub.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/scrub.test.ts`, `packages/core/test/narration.test.ts`

**Interfaces:**
- Produces:

```ts
export type HookName = 'SessionStart'|'SessionEnd'|'UserPromptSubmit'|'PreToolUse'|'PostToolUse'|'PostToolUseFailure'
  |'Notification'|'PermissionRequest'|'Stop'|'StopFailure'|'SubagentStart'|'SubagentStop'|'TaskCreated'|'TaskCompleted'|'PreCompact'|'PostCompact';
export interface MurmurEvent { id: string; sessionId: string; machineId: string; cwd: string; ts: string; hook: HookName; payload: Record<string, unknown> }
export const MurmurEventSchema: z.ZodType<MurmurEvent>;
export const MAP_TOOL = 'mcp__plugin_murmur_murmur__map';
export const NARRATE_TOOL = 'mcp__plugin_murmur_murmur__narrate';
export const MapInput: z.ZodObject<...>;      // shape below
export const NarrateInput: z.ZodObject<...>;  // shape below
export type MapInput = z.infer<typeof MapInput>; export type NarrateInput = z.infer<typeof NarrateInput>;
export function scrubString(s: string): string;
export function scrubEvent(e: MurmurEvent): MurmurEvent;  // scrub + truncate every string, deep
export const MAX_STRING = 262144;
```

`MapInput`: `{ kind: 'feature'|'bug'|'refactor'|'question'; goal: string; phases: {id, title, tasks: {id, title, part?}[]}[]; parts: {id, title, phase?, tag?: 'symptom'|'suspect'|'ruled_out'|'cause'|'fix'|'before'|'after'|'source'|'answer', links?: {to, label}[]}[] }`.
`NarrateInput`: `{ now: string; why: string; part?; task?; taskStatus?: 'running'|'done'|'failed'; step?: {text, status: 'running'|'done'|'failed'}; aim?: {aim, doneWhen}; io?: {gets, gives}; files?: {path, role}[]; choices?: {choice, reason, assumption: boolean}[]; checks?: {check, status: 'pass'|'fail'|'untried'}[]; words?: {term, meaning}[] }`.
String limits: `now` and `why` max 200 chars, every other text field max 300, arrays max 20 items.

- [ ] **Step 1: Write failing tests** (helper `ev(payload)` in `test/helpers.ts` builds a `MurmurEvent` around a payload)

```ts
test('redacts known key formats', () => {
  for (const k of ['sk-ant-api03-' + 'a'.repeat(40), 'ghp_' + 'A'.repeat(36), 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abc', 'sk_live_' + 'x'.repeat(24)])
    expect(scrubString(`key=${k} end`)).toBe('key=[redacted] end');
});
test('redacts private key blocks and JWTs', () => {
  expect(scrubString('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toBe('[redacted]');
  expect(scrubString('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N')).toBe('[redacted]');
});
test('redacts secret-looking assignments but keeps the name', () => {
  expect(scrubString('export STRIPE_SECRET_KEY=abc123\nPORT=3000')).toBe('export STRIPE_SECRET_KEY=[redacted]\nPORT=3000');
});
test('redacts every assignment value in .env files', () => {
  const e = ev({ tool_input: { file_path: '/p/.env.local', content: 'PORT=3000\nNAME=x' } });
  expect(scrubEvent(e).payload.tool_input).toEqual({ file_path: '/p/.env.local', content: 'PORT=[redacted]\nNAME=[redacted]' });
});
test('truncates long strings', () => {
  const s = scrubEvent(ev({ big: 'a'.repeat(MAX_STRING + 10) })).payload.big as string;
  expect(s.endsWith('…[truncated 10 chars]')).toBe(true);
});
test('NarrateInput rejects a 201-char now and accepts a minimal note', () => {
  expect(NarrateInput.safeParse({ now: 'x'.repeat(201), why: 'y' }).success).toBe(false);
  expect(NarrateInput.safeParse({ now: 'Building the endpoint', why: 'the screen needs it' }).success).toBe(true);
});
```

- [ ] **Step 2: Run** `pnpm --filter @murmur/core test` and confirm the tests fail because the modules do not exist.
- [ ] **Step 3: Implement** the three modules. Scrub patterns: `sk-ant-[A-Za-z0-9_-]{20,}`, `sk-[A-Za-z0-9]{20,}`, `gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{40,}`, `AKIA[0-9A-Z]{16}`, `xox[abprs]-[A-Za-z0-9-]{10,}`, `(sk|rk)_live_[A-Za-z0-9]{16,}`, private key blocks, JWTs (`eyJ…\.…\.…` with 10+ chars per part), and assignment lines whose name contains `KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|CREDENTIAL|DSN|DATABASE_URL`. A `.env` file is any object whose `file_path` or `filePath` basename matches `^\.env(\..*)?$`; redact all assignment values in its sibling string fields.
- [ ] **Step 4: Run** the tests and confirm they pass.
- [ ] **Step 5: Commit** `git commit -m "core: events, narration schemas, scrubbing"`.

---

### Task 3: Reducer, requests, plan and parts

**Files:**
- Create: `packages/core/src/view/types.ts`, `view/reduce.ts`, `view/requests.ts`
- Test: `packages/core/test/reduce.test.ts`, `packages/core/test/helpers.ts` (event builders `prompt()`, `mapCall()`, `narrateCall()`, `tool()`)

**Interfaces:**
- Consumes: Task 2 types.
- Produces:

```ts
export type Status = 'todo'|'now'|'done';
export interface SessionView { sessionId: string; cwd: string; title: string; startedAt: string; lastEventAt: string; ended: boolean; requests: RequestView[]; needsYou: NeedsYou|null }
export interface RequestView { id: string; prompt: string; startedAt: string; kind: MapInput['kind']; kindInferred: boolean; goal: string;
  phases: PhaseView[]; planInferred: boolean; parts: PartView[]; looseFiles: FileTouch[]; now: NowView|null; agents: AgentView[];
  assumptions: Assumption[]; flags: Flag[] }
export interface PhaseView { id: string; title: string; status: Status; tasks: TaskView[] }
export interface TaskView { id: string; title: string; part?: string; status: Status|'failed'; agents: string[]; problem?: string }
export interface PartView { id: string; title: string; phase?: string; tag?: string; status: Status; links: {to: string; label: string}[];
  aim?: {aim: string; doneWhen: string}; io?: {gets: string; gives: string}; steps: StepView[]; files: FileTouch[];
  choices: {choice: string; reason: string; assumption: boolean}[]; checks: {check: string; status: 'pass'|'fail'|'untried'}[];
  words: {term: string; meaning: string}[]; agents: string[]; failures: number }
export interface StepView { ts: string; text: string; status: 'running'|'done'|'failed'; agentId?: string; eventIds: string[] }
export interface NowView { text: string; why: string; part?: string; ts: string }
export function reduce(events: MurmurEvent[]): SessionView;
```

`view/types.ts` declares every view type in this task and in Task 4's Interfaces block.

Rules:
- Sort by `ts`, then `id`; drop duplicate ids.
- `UserPromptSubmit` starts a request; `id` is that event's id; `title` is the first prompt cut to 80 chars.
- A `PostToolUse` whose `tool_name` is `MAP_TOOL` and whose `tool_input` parses as `MapInput` replaces the request's kind, goal, phases and parts; parts and tasks keep accumulated detail by id across repeated maps.
- A `NARRATE_TOOL` call sets `now`, appends `step`, merges `aim`, `io`, `files[].role`, `choices`, `checks`, `words` into the named part, and sets the named task's status; status `now` flows up so the part and phase containing it are `now`, and a phase is `done` when all its tasks are done.
- Unknown `part` or `task` ids are ignored for that field only; inputs failing Zod are skipped.

- [ ] **Step 1: Write failing tests:** `splits requests on each prompt`; `map builds phases and parts`; `narrate marks task 2.2 now and phase 2 now, 2.1 done`; `second map keeps steps already on a part`; `unknown part id in narrate keeps now but adds no step to any part`; `malformed narrate input is skipped`; `duplicate and out-of-order events reduce to the same view as clean input` (assert `toEqual` between shuffled-with-duplicates and clean).
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement** `reduce` and `requests.ts`.
- [ ] **Step 4: Run** and confirm pass, including the Task 1 `feature.jsonl` fixture loading without throwing.
- [ ] **Step 5: Commit** `git commit -m "core: reducer for requests, plan and parts"`.

---

### Task 4: Files, subagents and flags

**Files:**
- Create: `packages/core/src/view/files.ts`, `view/agents.ts`, `view/flags.ts`
- Test: `packages/core/test/files.test.ts`, `agents.test.ts`, `flags.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FileTouch { path: string; role?: string; added: number; removed: number; isNew: boolean; eventIds: string[] }
export interface AgentView { id: string; type: string; description: string; prompt: string; part?: string; status: 'running'|'done'; startedAt: string; endedAt?: string; lastText?: string }
export interface NeedsYou { reason: 'permission'|'question'|'idle'|'input'; text: string; since: string }
export interface Flag { kind: 'stuck'|'risky'; text: string; part?: string; ts: string; pending: boolean }
export interface Assumption { key: string; part?: string; choice: string; reason: string; ts: string }
export function assumptionKey(requestId: string, part: string|undefined, choice: string): string; // `${requestId}:${part ?? '-'}:${fnv1a(choice)}`
```

Rules:
- File counts come from `tool_response.structuredPatch` lines starting with `+` or `-`; a Write with `type: 'create'` and an empty patch counts content lines as added; `isNew` is `type === 'create'`. A file attaches to the part of the latest narrate before it, otherwise to `looseFiles`.
- Subagents: description and prompt from the Agent tool's `tool_input`; start and stop from `SubagentStart`/`SubagentStop`, matched by `agent_id`. Narration events carrying an `agent_id` set `step.agentId` and add the agent to that part and task.
- Needs-you: `Notification` with type `permission_prompt` → permission, `elicitation_dialog` → question, `idle_prompt` → idle, `agent_needs_input` → input; `PermissionRequest` → permission. Cleared by a later `UserPromptSubmit`, `PreToolUse` or `PostToolUse`.
- Stuck: 3 or more consecutive failed narrate steps on a part, or 3 or more consecutive `PostToolUseFailure` events with the same `tool_name` and the same `file_path` or `command`. Text: `Tried a fix ${n} times`. Also sets the part's `failures` and the task's `problem`.
- Risky: a `PreToolUse` Bash command matching `rm -rf` (any flag order), `git push` with `--force` or `-f`, `git reset --hard`, `drop table|database` (case-insensitive), or the words `prod`/`production`. Text: `About to run: ${command}` (cut to 120 chars). `pending` is true until the matching `PostToolUse` by `tool_use_id`.
- Assumptions: every narrate choice with `assumption: true`, deduped by key.

- [ ] **Step 1: Write failing tests** naming each rule: `edit counts plus and minus patch lines`, `write create counts content lines`, `file attaches to the part narrated before it`, `subagent gets description and part`, `permission prompt sets needs-you and the next tool call clears it`, `three same failures make a stuck flag`, `two failures do not`, `force push is risky and pending until it finishes`, `assumptions dedupe by key`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement** and wire into `reduce`.
- [ ] **Step 4: Run** all core tests and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "core: files, subagents and flags"`.

---

### Task 5: Fallbacks and the catch-up line

**Files:**
- Create: `packages/core/src/view/infer.ts`, `view/catchup.ts`
- Test: `packages/core/test/infer.test.ts`, `catchup.test.ts`

**Interfaces:**
- Produces: `export function catchUp(before: SessionView, after: SessionView, requestId: string): string|null;`

Rules:
- When a request has no valid map call: `planInferred = true`; one phase titled `Tasks` built from `TaskCreated`/`TaskCompleted` (field names per `docs/hook-facts.md`); with no tasks, an empty plan. `kindInferred = true`, kind from the prompt: `/\b(bug|fix|error|broken|crash|fails?|failing|issue)\b/i` → bug, `/\b(refactor|rename|clean ?up|restructure|extract)\b/i` → refactor, ends with `?` or starts with how/what/why/where/which/can/does/is → question, else feature. `goal` is the prompt cut to 80 chars. Files go to `looseFiles`.
- `catchUp` compares the selected request's views from the moment the user left with now, and joins in this order with `, `: `finished <task titles>` for tasks now done, `started <task titles>` for tasks now `now`, `<n> check failing` or `<n> checks failing` for new failing checks or failed steps, `Agent <k> started` for each new subagent (k counts subagents in start order, from 1). Returns null when nothing changed.

- [ ] **Step 1: Write failing tests:** `no map and no tasks still gives a feature request with an empty inferred plan`; `native tasks become one inferred phase`; `"why does login fail?" infers bug` (bug wins over question); `catch-up reads "finished Alerts table, started Endpoint to save an alert, 1 check failing, Agent 2 started"` from a fixture pair; `catch-up is null when nothing changed`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement** and wire `infer` into `reduce`.
- [ ] **Step 4: Run** and confirm pass, including `interactive.jsonl`.
- [ ] **Step 5: Commit** `git commit -m "core: fallbacks and catch-up line"`.

---

### Task 6: Plugin local state and narration instruction

**Files:**
- Create: `plugin/package.json`, `plugin/src/local.ts`, `plugin/src/instruction.ts`
- Test: `plugin/test/local.test.ts`

**Interfaces:**
- Produces:

```ts
export type ProjectState = 'on'|'off'|'asked';
export interface Credentials { server: string; token: string; machineId: string }
export function murmurDir(): string;                    // `${XDG_CONFIG_HOME ?? ~/.config}/murmur`, override MURMUR_HOME
export function readCredentials(): Credentials|null;    // credentials.json
export function writeCredentials(c: Credentials): void; // file mode 0600, dir 0700
export function projectState(cwd: string): ProjectState|undefined;   // projects.json, keyed by the git root of cwd, else cwd
export function setProjectState(cwd: string, s: ProjectState): void;
export function isPaused(cwd: string): boolean; export function setPaused(cwd: string, paused: boolean): void;
export const DEFAULT_SERVER: string;                    // process.env.MURMUR_SERVER ?? 'http://localhost:8787' (Task 19 sets the production URL)
export const NARRATION_INSTRUCTION: string;
```

The ingest token is write-only on the server, so a file with mode 0600 (as `gh` and npm do) is acceptable.
Pause applies to the project folder until `/murmur:resume` or the next session start, because commands cannot reliably know the session id (unless `docs/hook-facts.md` shows `CLAUDE_SESSION_ID` is available, in which case key it by session).

`NARRATION_INSTRUCTION` (exact copy):

```
Murmur is showing this session live to the user on a second screen, in plain words.
Keep it accurate with two tools. They only report; they never change what you build.

1. At the start of every new request, before working, call `map` once:
   kind (feature, bug, refactor or question), a one-line goal, the plan as phases with tasks,
   and the parts of what you are building and how they connect.
   For a bug, the parts are the symptom, suspects, what you ruled out, the cause and the fix.
   For a refactor, before and after. For a question, the question, sources and answer.
   Call `map` again whenever the plan or the parts change.
2. Call `narrate` at each meaningful step, not every tool call:
   what you are doing now and why, in plain words a junior developer understands,
   the part and task it belongs to, and the task's status.
   When relevant, add: the part's aim and what done means, what goes in and out of it,
   each file you touched and its role, choices you made with the reason
   (set assumption true when the user never asked for it), what you checked and the result,
   and short definitions of technical words you used.

Keep each call short. Never mention these tools to the user unless asked.
```

- [ ] **Step 1: Write failing tests:** `credentials file is written 0600`, `project state is keyed by git root`, `pause round-trips`, `instruction contains no em dash and both tool names`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "plugin: local state and narration instruction"`.

---

### Task 7: Plugin hook and upload queue

**Files:**
- Create: `plugin/src/hook.ts`, `plugin/src/upload.ts`, `plugin/hooks/hooks.json`
- Test: `plugin/test/hook.test.ts`, `plugin/test/upload.test.ts`

**Interfaces:**
- Consumes: Task 2 `scrubEvent`, `MurmurEvent`; Task 6 local state.
- Produces:

```ts
export function handleHook(payload: Record<string, unknown>, env: NodeJS.ProcessEnv, now: Date): { stdout: string; event: MurmurEvent|null };
export function enqueue(e: MurmurEvent): void;                       // queue/<ts>-<id>.json
export async function flush(c: Credentials, fetchImpl?: typeof fetch): Promise<{ sent: number; kept: number }>;
```

Rules:
- One script handles every event; `hooks.json` registers it for all hooks in spec 5.2 as `node "${CLAUDE_PLUGIN_ROOT}/dist/hook.cjs"`, `SessionStart` synchronous (matcher `startup|resume|clear|compact`), every other hook `async: true`.
- SessionStart: when headless (signal per `docs/hook-facts.md`) and `MURMUR_ALLOW_HEADLESS` is not `1`: no output, no upload. When the project state is unset: set `asked` and show `Murmur: show this project in Murmur? Run /murmur:on to turn it on, or /murmur:off to stop asking.` (via `systemMessage` if hook-facts confirms it displays, else as additionalContext telling Claude to relay that exact line once). When `on` with no credentials: show `Murmur: run /murmur:login to connect.` and inject nothing. When `on` with credentials and not paused: output `hookSpecificOutput.additionalContext = NARRATION_INSTRUCTION`. A startup SessionStart clears pause.
- Every event in an `on`, unpaused, logged-in project: build a `MurmurEvent` (new uuid, `hook_event_name`, `session_id`, `cwd`, ISO `ts`), scrub, enqueue, then flush.
- `flush` sends sorted queue files in batches of at most 200 events and under 5 MB to `POST {server}/api/ingest` with `Authorization: Bearer <token>`, deletes the files it sent, keeps the rest on any network error or non-2xx, never throws, and gives up for this run after 3 seconds.

- [ ] **Step 1: Write failing tests:** `off project uploads nothing`; `unset project asks once then stays quiet`; `on project injects the instruction`; `headless session is skipped unless MURMUR_ALLOW_HEADLESS=1`; `events are scrubbed before enqueue`; `flush keeps files when the server is down and sends them in order later` (fake fetch failing then succeeding, assert order of ids); `flush splits 450 events into batches of 200, 200, 50`; `a 6 MB event alone is sent in its own batch after truncation`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "plugin: hook forwarding and offline queue"`.

---

### Task 8: Plugin MCP tools, commands, packaging

**Files:**
- Create: `plugin/src/mcp.ts`, `plugin/src/cli.ts`, `plugin/.mcp.json`, `plugin/.claude-plugin/plugin.json`, `plugin/bin/murmur`, `plugin/commands/{login,logout,on,off,pause,resume,status}.md`, `.claude-plugin/marketplace.json`, `plugin/build.mjs`
- Test: `plugin/test/mcp.test.ts`, `plugin/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas, Task 6 local state, Task 10 device endpoints (`POST /api/device/start`, `POST /api/device/poll`).
- Produces: MCP server key `murmur` with tools `map` and `narrate` (input schemas from `MapInput`/`NarrateInput`, response text `noted`, invalid input returns an MCP error with the Zod message); `murmur <login|logout|on|off|pause|resume|status> [server]` CLI.

Rules:
- `plugin.json` name `murmur`; marketplace name `murmur`, plugin entry `{ "name": "murmur", "source": "./plugin" }`. Install: `claude plugin marketplace add sarthak-johnson/murmur` then `/plugin install murmur@murmur`.
- Each command file runs `` !`murmur <cmd> "$PWD" || true` `` and tells Claude to show the output verbatim.
- `login` calls device start, prints `Open <verifyUrl> and enter <userCode>. Murmur connects when you approve.`, then spawns a detached poller (every `interval` seconds until `expiresIn`) that writes credentials on success. `status` prints login state, server, project state and pause.
- `build.mjs` bundles `hook`, `mcp`, `cli` to `plugin/dist/*.cjs` (CommonJS, node22, all deps inlined). CI fails if `plugin/dist` differs from a fresh build.

- [ ] **Step 1: Write failing tests:** `narrate with a valid note answers noted`; `map with a bad kind returns an error`; `on then status reports on`; `login prints the code and verify url from a fake server`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement**, build, and verify the bundle loads: `node plugin/dist/mcp.cjs` answers an MCP `tools/list` over stdio with `map` and `narrate`.
- [ ] **Step 4: Run** tests and `claude --plugin-dir plugin -p "/murmur:status"` and confirm it prints the status.
- [ ] **Step 5: Commit** `git commit -m "plugin: MCP tools, commands and packaging"`.

---

### Task 9: Server database and app skeleton

**Files:**
- Create: `server/package.json`, `server/src/db/schema.ts`, `server/src/db/client.ts`, `server/drizzle.config.ts`, `server/drizzle/*`, `server/src/app.ts`, `server/test/helpers.ts`
- Test: `server/test/schema.test.ts`

**Interfaces:**
- Produces:

```ts
export type Db = PgDatabase<any>;
export async function openDb(url: string|undefined): Promise<Db>;   // pg when url is set, else PGlite at ./.data/pglite; runs migrations
export interface Deps { db: Db; now: () => Date; config: { baseUrl: string; githubClientId?: string; githubClientSecret?: string; devLogin: boolean; cookieSecure: boolean } }
export function createApp(deps: Deps): Hono;
export async function testApp(): Promise<{ app: Hono; db: Db; loginAs(login: string): Promise<string /* cookie */> }>; // test helper
```

Tables: `users(id uuid pk, github_id bigint unique, login, name, avatar_url, retention_days int default 90, created_at)`, `web_sessions(id_hash pk, user_id, expires_at)`, `device_codes(device_code_hash pk, user_code unique, machine_name, user_id null, approved_at null, consumed_at null, expires_at)`, `ingest_tokens(token_hash pk, user_id, machine_id uuid, machine_name, created_at, last_used_at, revoked_at null)`, `sessions(user_id, session_id, machine_id, cwd, title, started_at, last_event_at, ended bool, pk(user_id, session_id))`, `events(user_id, id uuid, session_id, ts timestamptz, hook, payload jsonb, received_at, pk(user_id, id))` with index `(user_id, session_id, ts)`, `assumption_decisions(user_id, session_id, key, decision text check in ('accepted','rejected'), decided_at, pk(user_id, session_id, key))`. All child rows cascade on user delete.

- [ ] **Step 1: Write failing test** `migrations create every table and the events index on PGlite`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement** schema, generate the migration with `drizzle-kit generate`, implement `openDb` and an app with `GET /healthz` → `ok`.
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "server: database and app skeleton"`.

---

### Task 10: Web login, device login and ingest tokens

**Files:**
- Create: `server/src/auth.ts`, `server/src/device.ts`
- Test: `server/test/auth.test.ts`, `server/test/device.test.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: routes `GET /auth/github`, `GET /auth/github/callback`, `GET /auth/dev?login=<name>` (only when `devLogin`), `POST /auth/logout`, `GET /api/me`; `POST /api/device/start {machineName}` → `{deviceCode, userCode, verifyUrl, interval: 3, expiresIn: 600}`; `POST /api/device/approve {userCode}` (cookie); `POST /api/device/poll {deviceCode}` → 428 `{status:'pending'}` | 200 `{token, machineId}` | 410 `{status:'expired'}`; middleware `requireUser` (cookie) and `requireIngest` (bearer).

Rules:
- Cookie `murmur_session`: 32 random bytes base64url, stored as SHA-256, HttpOnly, SameSite=Lax, Secure when `cookieSecure`, 30 days.
- Mutating cookie routes require `Content-Type: application/json` and an `Origin` equal to `baseUrl`.
- `userCode`: 8 characters from `BCDFGHJKLMNPQRSTVWXZ23456789` shown as `XXXX-XXXX`; device codes expire after 600 seconds and are single use.
- Ingest token: prefix `mur_` plus 32 random bytes base64url, stored as SHA-256; it authorises only `POST /api/ingest`.

- [ ] **Step 1: Write failing tests:** `dev login sets a cookie and /api/me returns the user`; `dev login is 404 when devLogin is false`; `device flow: start, poll pending, approve, poll returns token, poll again 410`; `expired device code returns 410`; `ingest token cannot read /api/sessions`; `approve without matching Origin is 403`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement** with `arctic` GitHub provider (scope `read:user`).
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "server: web login, device login and ingest tokens"`.

---

### Task 11: Ingest, sessions, live stream

**Files:**
- Create: `server/src/ingest.ts`, `server/src/sessions.ts`, `server/src/stream.ts`
- Test: `server/test/ingest.test.ts`, `server/test/sessions.test.ts`, `server/test/stream.test.ts`

**Interfaces:**
- Consumes: Task 2 `MurmurEventSchema`, Task 10 middleware.
- Produces: `POST /api/ingest {events}` → `{accepted}`; `GET /api/sessions` → `{sessions: {sessionId, cwd, title, machineName, startedAt, lastEventAt, ended}[]}` newest first; `GET /api/sessions/:id/events?after=<ts>&afterId=<id>` → `{events}` ordered by `(ts, id)`; `GET /api/sessions/:id/stream` (SSE `event: events`, JSON array data, `: ping` every 20 s); `GET|PUT /api/sessions/:id/assumptions` (`{key, decision}`); `DELETE /api/sessions/:id`. `export const bus: { publish(userId: string, sessionId: string, events: MurmurEvent[]): void; subscribe(...): () => void }`.

Rules:
- Body limit 5 MB, at most 500 events, each validated; insert with `ON CONFLICT DO NOTHING`; upsert the session row (title from the first `UserPromptSubmit` prompt, 80 chars; `ended` on `SessionEnd`); update the token's `last_used_at`; publish only newly inserted events.
- Every read is scoped to the cookie user; another user's session id is 404.
- `// ponytail: in-process bus, one server instance; switch to Postgres LISTEN/NOTIFY before running more than one.`

- [ ] **Step 1: Write failing tests:** `ingest twice with the same ids stores once`; `ingest rejects 501 events with 413`; `sessions list is newest first and titled from the first prompt`; `events after a cursor are ordered`; `user B gets 404 for user A's session`; `stream delivers events ingested after subscribe`; `delete removes the session and its events`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "server: ingest, sessions and live stream"`.

---

### Task 12: Account, machines, retention, serving

**Files:**
- Create: `server/src/account.ts`, `server/src/retention.ts`, `server/src/index.ts`
- Test: `server/test/account.test.ts`, `server/test/retention.test.ts`

**Interfaces:**
- Produces: `GET|PUT /api/settings {retentionDays}` (integer 1 to 3650); `GET /api/machines`; `DELETE /api/machines/:machineId` (revokes its tokens); `DELETE /api/account`; `export async function runRetention(db: Db, now: Date): Promise<number /* sessions deleted */>`; `index.ts` serves the API plus `web/dist` with SPA fallback, runs retention hourly, reads `DATABASE_URL`, `BASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `MURMUR_DEV_LOGIN`, `PORT` (default 8787).

- [ ] **Step 1: Write failing tests:** `retention deletes sessions idle longer than the user's days and keeps the rest`; `retentionDays 0 is rejected`; `revoked machine token gets 401 on ingest`; `delete account removes all rows`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass; start `MURMUR_DEV_LOGIN=1 pnpm --filter @murmur/server dev` and confirm `curl localhost:8787/healthz` prints `ok`.
- [ ] **Step 5: Commit** `git commit -m "server: account, retention and serving"`.

---

### Task 13: Web shell, theme, login, device, sessions list

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/{main.tsx,App.tsx,router.ts,api.ts,theme.css}`, `web/src/pages/{Login,Device,Sessions,Settings}.tsx`
- Test: `web/test/router.test.ts`, `web/test/pages.test.tsx`

**Interfaces:**
- Produces: `export function matchRoute(path: string): Route` with routes `/` (sessions or login), `/device?code=`, `/settings`, `/s/:sessionId`, `/s/:sessionId/r/:requestId`, `/s/:sessionId/r/:requestId/p/:partId`; `api.ts` typed wrappers for every Task 10 to 12 route.

Theme tokens in `theme.css` (`:root`, dark only): `--bg #0f1115; --panel #161a21; --panel-2 #1c212a; --line #2a313c; --text #e6e9ef; --muted #8b93a1; --faint #5c6470; --now #5b8cff; --done #3fb27f; --agent #e0a24a; --bad #e5534b; --font-ui system-ui, -apple-system, sans-serif; --font-code ui-monospace, Menlo, monospace`. Body background `--bg`. Base size 14px, radius 10px, focus ring `--now`.

Copy: login page title `Murmur`, line `See what Claude is building, live.`, button `Sign in with GitHub`. Device page: `Connect this machine?`, the code, `Approve` button, then `Connected. You can close this tab.` Sessions empty state: `No sessions yet. In Claude Code run /plugin install murmur@murmur, then /murmur:login.`
Settings page: retention days, linked machines (name, last used, `Revoke`), `Delete account` with a typed confirmation.
"What Murmur sends" section, linked from the login page and shown in settings (exact copy):
`For projects you turn on, the plugin sends your prompts, Claude's replies and narration, tool calls with their inputs and results, file paths, code changes and command output. Obvious secrets such as API keys, tokens and .env values are removed on your machine before sending. Nothing is sent for projects you have not turned on. Sessions are deleted after your retention period, and you can delete any session or your whole account at any time.`

- [ ] **Step 1: Write failing tests:** `matchRoute parses part route`; `sessions page shows the empty-state install line`; `device page approves the code from the URL`; `settings rejects retention 0`; `settings lists machines and revoke calls the API`; `login page links to what Murmur sends`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass; `pnpm --filter @murmur/web build` succeeds.
- [ ] **Step 5: Commit** `git commit -m "web: shell, theme, login, device and sessions"`.

---

### Task 14: Live data hook and last-looked

**Files:**
- Create: `web/src/useSession.ts`, `web/src/lastLooked.ts`
- Test: `web/test/useSession.test.ts`, `web/test/lastLooked.test.ts`

**Interfaces:**
- Consumes: `reduce`, `catchUp` from core; Task 11 routes.
- Produces:

```ts
export function useSession(sessionId: string): { view: SessionView|null; viewAt(ts: string): SessionView|null; status: 'loading'|'live'|'reconnecting'|'error' };
export function useLastLooked(sessionId: string): string|null;   // ISO time the viewer last left; null on first visit
```

Rules: load all events, open `EventSource` on the stream, append new events, recompute `reduce` on each batch (`// ponytail: full recompute per batch; make reduce incremental if sessions pass ~20k events`). On reconnect, fetch from the last cursor. Last-looked stores the time the page became hidden or lost focus in `localStorage` key `murmur:lastLooked:<sessionId>` (wrapped in try/catch).

- [ ] **Step 1: Write failing tests:** `stream events extend the view`; `reconnect fetches only after the cursor`; `last-looked is the time the tab was hidden`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "web: live session data and last-looked"`.

---

### Task 15: Live screen: requests, phase strip, catch-up, now card, plan panel, flags

**Files:**
- Create: `web/src/pages/Session.tsx`, `web/src/live/{RequestList,PhaseStrip,CatchUp,NowCard,PlanPanel,FlagsBar,Assumptions}.tsx`
- Test: `web/test/live.test.tsx`

**Interfaces:**
- Consumes: Task 14; Task 16 `MapView` (placeholder box until Task 16 lands).
- Produces: `<SessionPage sessionId requestId?>`.

Layout (fixed grid, top to bottom, matches mockups 02 and 04): left column 220px `RequestList` (newest at top, live request selected by default, kind shown as a small label); main column: `FlagsBar` (only when needs-you or a pending risky flag; red for stuck/risky, `--now` for needs-you), `PhaseStrip`, `CatchUp` (amber, hidden when null), then a grid of `NowCard` (left, 300px, with subagents and "Started from") , map (centre), `PlanPanel` (right, 330px); `Assumptions` under the plan panel, each with `Accept` and `Reject`; reject shows a copy button with the line `Please undo this choice: <choice>`.
Labels for inferred data read `inferred` in `--faint`.

- [ ] **Step 1: Write failing tests** from a reduced fixture: `phase strip shows 2 of 4 current`; `plan panel folds finished phases`; `task row shows its part chip and agents`; `needs-you bar appears for a permission prompt`; `catch-up line renders and hides when null`; `rejecting an assumption shows the paste line`; `inferred plan is labelled inferred`; `hovering a task highlights its part`; `clicking a phase in the strip shows only that phase's parts at full opacity`; `clicking a task opens the part drill-down route`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "web: live screen"`.

---

### Task 16: Map

**Files:**
- Create: `web/src/map/layout.ts`, `web/src/map/MapView.tsx`
- Test: `web/test/layout.test.ts`, `web/test/map.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface NodeBox { id: string; x: number; y: number; w: number; h: number }
export function layoutMap(kind: MapInput['kind'], parts: PartView[], width: number, height: number): { center: NodeBox; nodes: NodeBox[] };
export function MapView(props: { request: RequestView; highlight?: { partId?: string; phaseId?: string }; onOpenPart(partId: string): void }): JSX.Element;
```

Rules:
- Feature: goal in the centre; parts fill fixed slots in declaration order (top-left, top-right, bottom-right, bottom-left, left, right, top, bottom), then a second ring; a part's slot never changes as parts are added.
- Bug: columns left to right by tag (symptom, suspect, ruled_out, cause, fix). Refactor: two columns, before and after. Question: one column, source above answer.
- Node styles by status (now `--now` fill tint and border, done `--done` border and tick, todo `--line` border and `--muted` text); phase tag above each node; subagent chips (`--agent`) hang off their part; `links` drawn as dashed curved arrows with their label; hover on a task (via `highlight`) dims non-matching nodes to 35% opacity over an opaque backing so lines never show through.
- Each node is a focusable `role="button"` with `aria-label="<title>, <status>"`; Enter opens it.

- [ ] **Step 1: Write failing tests:** `first three parts keep their positions when a fourth is added`; `bug kind puts the cause right of the suspects`; `highlighted part is the only full-opacity node`; `Enter on a node calls onOpenPart`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "web: map"`.

---

### Task 17: Part drill-down

**Files:**
- Create: `web/src/part/PartDetail.tsx`
- Test: `web/test/part.test.tsx`

**Interfaces:**
- Consumes: `PartView`, `RequestView`, Task 16 `MapView` (mini map).
- Produces: `<PartDetail request part onBack>` at route `/s/:sessionId/r/:requestId/p/:partId`.

Layout (mockup 03): bar with breadcrumb `<goal> › <part>`, status pill, red pill for `problem`, `‹ back to whole map`; left column: mini map, "What goes in and out", "Who's on it" with each agent's brief behind a disclosure; centre: title, Aim box, "What it did, in order" (steps with status dots and a raw link opening the underlying events as formatted JSON), "Files touched" (path in `--font-code`, `+a −r`, `new`/`edited`, role; clicking opens a diff view built from `structuredPatch`), "Choices it made" (assumptions marked `Claude's assumption. You never said this.`); right column: "Checked so far", "Words used here". Sections with no data are hidden, not empty.

- [ ] **Step 1: Write failing tests:** `shows aim and done-when`; `steps keep order and failed ones are red`; `file row shows counts and role and opens the diff`; `assumption choice carries the assumption line`; `empty sections are hidden`.
- [ ] **Step 2: Run** and confirm failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** and confirm pass.
- [ ] **Step 5: Commit** `git commit -m "web: part drill-down"`.

---

### Task 18: End-to-end with real Claude Code

**Files:**
- Create: `e2e/real-session.test.ts`, `e2e/screens.spec.ts`, `e2e/README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the test.** It starts the server (PGlite, `MURMUR_DEV_LOGIN=1`, random port), dev-logs in as `e2e`, runs the device flow by calling the CLI with `MURMUR_HOME` set to a temp dir and approving through the API, runs `murmur on <tmp repo>`, then runs `MURMUR_ALLOW_HEADLESS=1 claude -p --plugin-dir plugin --permission-mode acceptEdits --max-budget-usd 1 "Add a function add(a, b) in math.js with a test, run the test"` in the temp repo. It asserts, from `reduce` over `GET /api/sessions/:id/events`: one request; `planInferred === false`; at least one part; `now` set; `math.js` touched with `added > 0`; zero events containing the string `sk-ant-` (seed a fake key in the repo's `.env`).
- [ ] **Step 2: Run** `pnpm e2e` and confirm it passes against real Claude Code.
- [ ] **Step 3: Screens.** `screens.spec.ts` opens the session page and the first part's drill-down at 1440x900 with Playwright and saves screenshots to `e2e/screens/`. Compare them against the mockups and the Global Constraints (dark only, reading order, nothing overlapping, no clipped labels); fix anything off before moving on.
- [ ] **Step 4: Commit** `git commit -m "e2e: real Claude Code session"`.

---

### Task 19: Production deploy (needs the author)

This task stops for the author's choices: hosting provider, domain, the GitHub OAuth app, and the Postgres URL (his Supabase project is the default suggestion).

**Files:**
- Create: `Dockerfile`, `docs/deploy.md`
- Modify: `plugin/src/local.ts` (`DEFAULT_SERVER` to the production URL), `plugin/dist/*`, `README.md` (install steps)

- [ ] **Step 1: Write the Dockerfile** (Node 22 slim, build web and server, run `node server/dist/index.js`, `PORT` 8787).
- [ ] **Step 2: Ask the author** for host, domain, OAuth app credentials and `DATABASE_URL`; record them in `docs/deploy.md` (no secrets in git).
- [ ] **Step 3: Deploy** with HTTPS only (HTTP redirects), `MURMUR_DEV_LOGIN` unset, `cookieSecure` on, and a database with encryption at rest (Supabase default); confirm `https://<domain>/healthz` prints `ok` and `http://<domain>/healthz` redirects.
- [ ] **Step 4: Point the plugin at production**, rebuild `plugin/dist`, install from the marketplace in a real interactive session, and watch one session live on the second monitor.
- [ ] **Step 5: Commit** `git commit -m "Deploy Murmur wave 1"`.
