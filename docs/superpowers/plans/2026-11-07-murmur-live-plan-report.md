# Report: a live plan that stays true (item 1)

Brief: [2026-11-07-murmur-live-plan-and-timeline.md](2026-11-07-murmur-live-plan-and-timeline.md), item 1 only (plugin and core).
Branch `fix/live-plan-and-timeline`, not pushed.
Items 2 and 3 (web) were built by another builder in the same tree; nothing in `web/` was touched here.

## Commits

- `269ed03` feat(core): the refresh's answer: task statuses and part detail by the map's ids
- `546c16d` feat(plugin): a live plan that stays true
- `00bb4d3` fix(plugin): a refresh that leaves a task out keeps what the plan knew of it (found on the author's session, see below)

## What changed

### Core (`packages/core`)

- `src/narration.ts`: `RefreshInput` (`tasks: { id, status, ended }[]`, `parts: { id, aim, choices, checks, words, files }[]`, ids unique).
  It shares `PartDetail` and `TaskEnd` with `RecapInput`, which is otherwise unchanged.
- `src/index.ts`: exports `parseNotification`, so the plugin counts helper reports the way core reads them.

### Plugin (`plugin`)

- `src/hook.ts`: a Stop that lets Claude finish (no Stop block) spawns its usual detached child as `--flush <id> --refresh`.
  The hook process itself only adds the flag; it never reads the transcript.
  A child with `--refresh` gets the 4-minute exit timer the backfill child has.
  After its usual text catch-up and flush, the child calls `runRefresh` and flushes again when it queued anything.
- `src/recap.ts`, `runRefresh(sessionId, { env, now, timeoutMs, log })`:
  - Same switches as the recap: `MURMUR_RECAP=0`, a headless env and the recap's own run (`MURMUR_RECAP_RUN=1`) do nothing; logged in, project on and not paused, checked the same way (`sending`, now shared by both).
  - At most one look per 5 minutes per session (`refresh.checked`, written before the transcript is read), so one refresh runs at a time.
  - Reads the transcript with `readBackfill` (cutoff now), reduces it, and takes the latest request; only a request whose map Claude drew (`planInferred` false, not a recap).
  - `planState` walks the request's events: each task's status from narrate, overlaid with the last refresh's statuses at that refresh's time; when a status last changed (else when the map came); helper reports since then (non-interim task notifications and foreground Agent results).
  - Stale: a task not done, and 3 or more reports or 20 minutes since that change.
    At most once every 30 minutes per request (`refresh.tried`, marked before the ask, whatever comes back).
  - The input is the recap's `recapInput` with the refresh instructions, the plan as it stands (`{ goal, phases: [{ id, title, tasks: [{ id, title, part, status }] }], parts: [{ id, title }] }`) and the request's helper reports (newest kept, 1,500 characters each, about 25,000 in all) in front.
  - The ask is the recap's `ask` (same flags, env, 60 s timeout, kill on exit); the answer is checked with `RefreshInput`, then every task and part id must be in the current map, else one log line and nothing queued.
  - Events (`refreshEvents`, through the recap's shared `emitter` and `detailNarrate`): PostToolUse `narrate`, `recap: true`, one millisecond apart from the refresh time, ids from `murmur-refresh:<request id>:<refresh time>:<n>`.
    One per part detail (an aim only where the part has none), one per task with its status (its line as a step on its part only when the status is news), then Claude's latest narrate again, so what is happening now stays Claude's.
    No `map` event: the request keeps the map Claude drew.
  - On success the session file keeps `refresh: { checked, request, tried, at, tasks }`, `tasks` being every task status the plan had then.
- `src/recap.ts`, shared rather than forked: `recapInput` takes the instructions as a parameter, `parse` returns the answer's JSON and each caller validates its own schema, the event builder is `emitter`, part detail is `detailNarrate`.
  The recap's events and ids are unchanged (its tests pass untouched).
- `src/local.ts`: `SessionState.refresh` and `RefreshState`.
- `dist/hook.cjs`, `dist/mcp.cjs`: rebuilt in each plugin commit.

## Tests, RED then GREEN

| Suite | RED | GREEN |
| --- | --- | --- |
| plugin `refresh.test.ts` (12 tests) | the suite failed (`runRefresh` missing); with a stub that does nothing, 8 failed on their assertions and 4 guards passed by design (fresh plan and all-done plan, headless / `MURMUR_RECAP=0` / the run's marker, project off or paused, no narrated map) | 12 passed |
| plugin `refresh.test.ts`, a later answer that leaves a task out (1 test) | failed: the third ask showed t1 as not started | passed |
| plugin `dist.test.ts`, Stop's child refreshes and that run sends nothing (1 test) | written before the code, but first run after it was built; checked with two mutations: without the `--refresh` flag it times out with nothing posted, and with the run given `MURMUR_ALLOW_HEADLESS=1` and no headless markers the run's own session (`refresh-run`) reaches the server | passed |

`refresh.test.ts` covers: a refresh on 3 reports since the last task change, keeping the phase, task and part ids and the narrated map; the same refresh twice gives the same ids; 20 minutes with no change; not when fresh, not after a task change resets the count, not when every task is done; not again within 30 minutes and no outcome said twice; refusal of an unknown task, an unknown part, or a new plan, with no retry within 30 minutes; one at a time; never headless, never the run itself, never with `MURMUR_RECAP=0`; never while off or paused; never without a narrated map.
The dist test runs the built Stop hook through `hooks.json` with a fake `claude` that runs the built hook with the env it was given, under an attended `claude-vscode` parent with `MURMUR_ALLOW_HEADLESS=1`: the Stop answers in under 1.5 s, its child posts only refresh narrates, and nothing from the run's own session.

Totals: core 243, plugin 176 (162 before), server 92, web 272, all passing.

## Checks

Each run on its own after the last commit:

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 0 |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 |
| `pnpm -s build:plugin` | 0 (no diff in `plugin/dist`) |
| `pnpm --filter @murmur/web -s build` | 0 |

## The author's request, through the API

Read as "Sarthak" (`~/.murmur-local/jar2`) with every page of `GET /api/sessions/27a000a1-.../events`, reduced with core; request `6a4a8307-...` "continue with the work".

| | Before (7 Nov 09:57Z) | After (8 Nov 00:19Z) |
| --- | --- | --- |
| Tasks done | 0 of 5 | 4 of 5 |
| t0 Bring the latest staging into the redesign branch | todo | done |
| t1 Read the agent page prototypes and today's agent page | now | done |
| t2 Write the Phase 2 task list into the plan | todo | done |
| t3 Add Phase 2 tasks to the live tracker | todo | done |
| t4 Dispatch the first builder and review its work | now | now (running) |
| Phases | todo, now, now | done, done, now |
| Parts with an aim | 0 of 5 | 5 of 5 |

t4 staying running is right: the transcript shows Phase 2 still being built (the last answer: "Builders and reviewers have worked through Tasks 17 to 34; the Task 35 F&O page build failed on an API error, and Task 34 still needs fixes.").
Each done part has its outcome as a step, for example t2: "Phase 2 plan written: 21 tasks, 14 for Sonnet builders and 6 for Opus, each reviewed by a fresh Opus reviewer."

### The live session refreshed itself first

The installed plugin runs this repo's `plugin/dist`, so once it was built the author's own Stops ran the refresh: at 10:05:35, 11:08:23, 11:55:37 and 12:26:35Z on 7 Nov, each at least 30 minutes after the last, all for this request, all through the real Stop path.
No session other than his reached the server (the events hold only `27a000a1-...`, and the session list has no new session).
Those runs' cost lines went to the detached child's ignored stderr, so they are not known.

The 11:55 answer named only t4, so the stored statuses lost t0 to t3, and the 12:26 refresh said their outcomes again: each done part shows two outcome steps on the server.
`00bb4d3` fixes the cause (the refresh now stores every status the plan had); the duplicate steps already on the server stay unless the session is deleted and imported again, which was not done.

### The real run

After `00bb4d3`, 12 hours past the last refresh, run once by hand through the child path, restarting nothing:

```sh
CLAUDE_CODE_ENTRYPOINT=cli CLAUDE_CODE_SESSION_ATTENDED=1 \
  node plugin/dist/hook.cjs --flush 27a000a1-7dbc-4dd1-ab83-961149fc03ae --refresh
```

It logged `murmur refresh: 6a4a8307-cae9-5162-bbd0-473bc5db1168 ok (14.0 s, $0.1246)`, exited 0 after 19 s in all (transcript read, ask, uploads), and queued 11 events that reached the server; the queue was empty after.
It wrote only that session's file (`refresh`, and the text catch-up's `textOffset`) and, for the upload, transient files in `~/.config/murmur/queue`, as every Stop does.
No new outcome steps were added: every status matched what the plan already had.

## Left or uncertain

- Cost: one Sonnet call of about $0.12 per refresh (as `claude -p` reports it; this account uses Claude Code's own login, so notional).
  A long task that stays running (like t4) is asked again every 30 to 60 minutes while reports keep coming, since a refresh that changes nothing does not reset the 20 minutes; about $0.25 an hour at most per session.
- The refresh reads the whole transcript in the child (about 2 s for his 67 MB one), at most once per 5 minutes per session.
- The refreshed statuses live in the session file and on the server, not in the transcript; if the session file is lost, the next refresh sees only Claude's own narrates and may say an outcome again.
- The hook's Stop block (`trackNarration`) does not see refresh narrates, so it can still ask Claude once per request to narrate tasks the refresh already marked done.
- The restored "now" narrate carries the refresh's time, so an idle session's "now" shows Claude's last narrate as of the refresh.
- The 4 automatic refreshes and the test builds overlapped in time: two mutation builds were live in `plugin/dist` for a few seconds each; even then the run has hooks off (`disableAllHooks`, `--safe-mode`), and nothing from it reached the server.

## Review fixes

From an Opus review of the refresh.
Each fix has a test that failed first for the reason named.
No real refresh was run again.

### Commits

- `6ebe9ab` fix(core): a refresh's narrate never moves now
- `3317996` fix(plugin): review fixes for the live plan refresh
- `ecc84bd` fix(web): a run label wider than estimated is cut with an ellipsis

### What changed

1. A task stays done.
   Once Claude or a refresh has set a task done, nothing the refresh hears moves it back.
   Only open tasks go in the plan the model sees (done ones are listed by title under `done`, with "say nothing of them"); an answer about a done task is dropped.
   An answer is kept only when it moves a status forward (none, running, failed, done), and only then is its line a step, so a task never gains a step for being said again.
2. The newest of Claude's messages are kept.
   `recapInput` takes a `newest` flag: the refresh keeps messages newest-first up to the 60,000 characters and says `[earlier messages left out]`; the recap still keeps the oldest.
3. Pausing, turning off or logging out during the ask stops the upload.
   Right before anything is queued, the refresh and the recap check `sending()` again and that the login is the one they started with (`stillSending`); otherwise they log one line and queue nothing.
   The child's second flush reads the credentials again.
4. One ask per 30 minutes per session, whatever the request (`tried` is per session now).
5. No ask without something new: a report, a message or a narrate after the last ask.
   `failed` is settled, like `done`: a plan whose open tasks are all failed is not asked about.
6. The refresh state lives in `sessions/<id>.refresh.json` (`readRefresh`, `writeRefresh`), so the hook's whole-file rewrites of the session file cannot drop it.
   A `refresh` field left in a session file by the first version is read when there is no file yet, so the author's session keeps what its refreshes said.
7. Smaller items:
   - Claude's last narrate is no longer sent again. Instead every refresh narrate carries `refresh: true`, and core applies it (statuses, steps, detail) without making it the latest narrate, so "now" and the part later changes go to stay where Claude put them, with Claude's own time.
   - Claude's `blocked` reads as `failed`, so an answer of `failed` is no news and adds no step.
8. `.run-label` gets `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` (one rule in `web/src/theme.css`).
   A label inside its bar is a flex item, so it is now cut at the bar's width.
   A label placed beside its bar (`.run.out`) is absolutely positioned with no width limit, so this rule does not cut it; its room is still only what the layout estimated.

### Tests, RED then GREEN

| Suite | RED | GREEN |
| --- | --- | --- |
| core `infer.test.ts`, a refresh's narrate (2 tests) | 2 failed: "now" was the refresh's text, and a later edit went to the refresh's part | passed |
| plugin `refresh.test.ts`, review fixes (12 tests) | with `readRefresh` stubbed to the old location, all 12 failed on their assertions: t1 asked about and moved back, a plan of done and failed asked about, a step for blocked then failed, the newest message missing, 3 events queued after pause, logout and off, a recap queued after pause, a second request asked within 30 minutes, an ask with nothing new, the state lost to a rewrite, "now" moved to the refresh | 12 passed |
| plugin `refresh.test.ts`, existing tests changed for the new rules (3 tests) | failed: t1 still in the plan after it was done, and no `.refresh.json` file | passed |
| web `runLabel.test.ts` (1 test) | failed: no `.run-label` rule | passed |

The existing tests that changed: "at most once every 30 minutes" and "a later answer that leaves a task out" now expect t1 out of the plan once it is done, and the second of them adds a report between asks (asking needs something new); "the same refresh twice" deletes the `.refresh.json` file to start again.
jsdom has no layout, so the CSS test checks the rule itself.

Totals: core 245, plugin 188, server 92, web 273, all passing.

### Checks

Each run on its own after the last code commit:

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 0 |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 |
| `pnpm -s build:plugin` | 0 (no diff in `plugin/dist`) |
| `pnpm --filter @murmur/web -s build` | 0 |

### Cost now

At most 2 asks an hour per session.
At the measured $0.1246 per ask, 5 sessions cost at most about $1.25 an hour ($1.40 at the dearest ask seen so far, $0.14), and less whenever nothing new comes or every open task is settled.
The one-time recap of an imported session is apart from this.

### Left

- A task with no part has no step to carry its outcome line, and the refresh no longer sets "now", so for such a task only its status shows.
- The duplicate outcome steps already on the author's session (from the 12:26 refresh) are still there.
