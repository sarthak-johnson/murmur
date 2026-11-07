# Report: Claude's own words in Murmur (data layer and recap)

Brief: [2026-11-07-murmur-claude-words.md](2026-11-07-murmur-claude-words.md).
Branch `fix/backfill-whole-transcript`, not pushed.

## Commits

- `23e3523` feat(core): contract for Claude's words, helper reports and the recap (types only, sent to the screens builder first)
- `7d839bd` docs: the inferred history report keeps per-request counts only
- `7fff790` fix(core): files changed through Bash commands count, their diff is sent whole
- `3f53079` feat(core): helper reports and briefs, Claude's messages per request
- `4abce2c` feat(plugin): Claude's messages and helper reports from the transcript
- `854dc70` feat(plugin): the recap: Claude fills what the history alone cannot
- `aa81542` fix(plugin): a recap names files by the path they were changed at
- `eb02e7a` fix: a recap that names parts its map lacks is refused
- `b949076` fix(core): a helper's file change goes to the part it narrated

The last three came from running the recap on the author's real session (see "Found on the real session").

## What changed, by file

### Core (`packages/core`)

- `src/events.ts`: `AssistantText` in `HOOK_NAMES`, and `AssistantTextPayload` (`text`, `session_id`, `cwd`, `hook_event_name`).
- `src/view/types.ts`: `RequestView.messages` and `recap`, `MessageView`, `AgentView.brief` and `report`, `AgentReport` (`status`, `summary`, `text`, `verdict`, `ts`, `interim`).
  All new fields are optional and commented.
- `src/view/words.ts` (new): `parseNotification`, `applyWords` (reports, briefs, messages), `subjectsOf`, `briefOf`.
  - A task notification attaches to the helper its Agent call started (by `<tool-use-id>`, through the existing `started` map), HTML entities unescaped, `<result>` read to its last closing tag; a later notification replaces an earlier one, across requests.
  - Interim when the summary or note says the helper is waiting on its own background work.
  - A foreground helper's report is its Agent PostToolUse `tool_response.content` text, without the `<tools-used-before-summary>` block; a background launch is not a report.
  - `verdict` from a first line `Status: DONE` (also `**Status:** DONE_WITH_CONCERNS`); an all-caps word only, so `**Status:** All five fixed` gives none.
  - Messages: every `AssistantText` of the request in time order. `task` when every subject the message names ("Task 1", "Tasks 4 and 5", "Tasks 4-5", "B7", "bug B1", "bug 1") is covered by exactly one task, the same one; a range part covers its numbers ("Task 5" links to "Tasks 4-5"). With no subject named, a narrated request links a message that contains exactly one task title, or one part title whose part has one task. Otherwise unset.
  - `agent`: the helper whose report came before the message, until a Stop, a prompt, a new Agent call or another report.
  - Brief: the paragraph under `## Context`, else the first paragraph left after dropping headings, pointer sentences ("Read the brief first: /path", "Task brief: /path"), rule sentences ("Read-only: ...", "Never ...", "Do not ...") and lead-ins ending in a colon; plain text, at most 600 characters, cut at a sentence end.
- `src/view/files.ts`: `touchesOf` replaces `touchOf`; a Bash result's `bashEditDiff` counts per file (`+`/`-` hunk lines, new when its only hunk starts at 0 of 0 lines).
  On a narrated or recapped request, a helper's touch goes to the part that helper narrated (`b949076`).
- `src/view/history.ts`: uses `touchesOf`, so a helper's Bash file changes land on its inferred part.
- `src/view/requests.ts`: `messages: []` on every request; the latest valid map sets `recap` when its payload has `recap: true`.
- `src/view/reduce.ts`: calls `applyWords` after `inferHistory`.
- `src/scrub.ts`: a Bash `tool_response.bashEditDiff` is walked with the 256K cap; the rest of a Bash result stays cut at 2,000; secrets inside the diff are still redacted.
- `src/narration.ts`: `RecapInput`, built from `MapInput` and `NarrateInput` (`aim`, `choices`, `checks`, `words`, `files`), plus per part `steps` and `helpers` (`H1`...), plus per task `{ id, status, ended }`; refused when a task or a part detail names a part the map lacks.
- `src/index.ts`: exports `briefOf` and `relPath` (the recap uses both).
- Tests: `test/words.test.ts` (new), `test/files.test.ts`, `test/scrub.test.ts`, `test/agents.test.ts` (two pinned agent objects gain `brief`, and the e2e fixture's foreground helper its `report`).

### Plugin (`plugin`)

- `src/backfill.ts`:
  - `readLines` takes an optional live window (`from`, `end`): it reads from a byte offset and leaves a last line with no newline for the next read.
  - `entryEvent` is the one event builder for the backfill and the live read (same deterministic id: entry uuid, block index, hook).
  - The backfill emits `AssistantText` for main-thread, non-sidechain, non-empty text blocks, and `UserPromptSubmit` for `origin.kind: "task-notification"` entries; a notification that set the cutoff is skipped like a prompt.
  - `catchUpText(sessionId, env)`: reads from `textOffset`, queues new text, stores the new offset (see "Review fixes" for what it does when nothing may be sent, or when no offset is on record).
  - `runBackfill` catches up text after the import, flushes, runs the recap, and flushes again when the recap queued anything.
- `src/hook.ts`: the detached flush child gets the session id (`--flush <id>`) and catches up text before it flushes.
  The hook only stats the transcript: a brand new session, or a seen one with no transcript on record (first seen while off), starts its live text at the file's size; a Stop while off or paused moves the offset past what was said.
  The backfill child's exit timer is 4 minutes (it was 1).
- `src/local.ts`: `isHeadless` moved here from `hook.ts`; `SessionState.textOffset` and `recapped`.
- `src/recap.ts` (new): `recapInput`, `recapEvents`, `runRecap`.
  - `claude -p --model sonnet --output-format json --tools "" --max-turns 1 --no-session-persistence --safe-mode --strict-mcp-config --disable-slash-commands --settings '{"disableAllHooks":true}'`, prompt on stdin, cwd the temp folder, env without `MURMUR_ALLOW_HEADLESS` and with `MURMUR_RECAP=0`, killed after 60 s, 3 requests at a time.
  - Input per request: the prompt, the helpers (`H<n>`: description, brief, verdict, summary), the files changed with counts, then Claude's messages with times (each cut at 3,000 characters), all capped at 60,000 characters.
  - Output handling: the `result` of the JSON output (an array of messages in this Claude Code version, a single object accepted too), code fences stripped, validated with `RecapInput`; any failure logs one line to stderr and keeps the inferred view.
  - Emitted as PostToolUse `map` and `narrate` events, `recap: true`, ids from `stableId` over `murmur-recap:<request id>:<n>`, one millisecond apart just after the prompt: the map, each part's detail (files named by their full path), its steps, one narrate per helper with that helper's `agent_id` (so it joins the part), each task's end as a step and its status, and a last narrate with no part.
  - The request ids go into `recapped` before the call, so a request is never asked twice; `MURMUR_RECAP=0` or a headless env asks nothing.
- `vitest.config.ts` and `test/dist.test.ts`: tests run with `MURMUR_RECAP=0`, so no test can reach the real `claude` on PATH.
- Tests: `test/text.test.ts` (new), `test/recap.test.ts` (new), `test/dist.test.ts` (two new tests).
- `dist/hook.cjs`, `dist/mcp.cjs`: rebuilt in every commit that changed core or the plugin.

### Docs

- `docs/superpowers/plans/2026-11-07-murmur-inferred-history-report.md`: the reducer output block with part titles is gone; the per-request counts table stays.

### Not touched

- `web/src` and `web/test`: nothing; the type changes did not break the web typecheck or build.
- The sentence for "What Murmur sends" ("imported history is summarised once by your own Claude, on your machine") belongs in `web/src/pages/WhatMurmurSends.tsx`, which the screens builder owns; it is not added yet.

## Choices worth knowing

- The recap's events are PostToolUse, not PreToolUse as the brief says: core's `applyPlan` reads `map` and `narrate` only from PostToolUse, so PreToolUse events would not draw.
- Live text starts from the cutoff by time rather than a byte position: after a backfill `textOffset` is unset and the first catch-up reads the whole transcript once (2 s for the 62 MB one) keeping text from the cutoff on. Ids are shared, so an overlap is harmless.
- Text is caught up only by the detached children (the Stop, UserPromptSubmit and SessionStart flush, and the backfill), so text from a turn reaches the server at its Stop.
- On a recapped request, file changes by a helper the recap put on a part go to that part; main-thread changes go to the part whose recap detail names the path; the rest stay in Files touched.

## Tests, RED then GREEN

Each new test was run against the code before the change and failed for the reason named, then passed.

| Suite | RED | GREEN |
| --- | --- | --- |
| core `words.test.ts` (30 tests) | 21 failed (no `report`, `messages`, `brief`); 9 guards passed by design (unknown tool use id, background launch, notification not a request, five "unsure" links, pointer-only prompt) | 30 passed |
| core `files.test.ts`, `bashEditDiff` counts and the Task 1 case (2 tests) | 2 failed (no files) | passed |
| core `scrub.test.ts`, `bashEditDiff` whole (1 test) | failed: a 6,000-character diff line was cut at 2,000 | passed |
| core `files.test.ts`, a helper's change on its narrated part (1 test) | failed (the file went to the naming part) | passed |
| core `words.test.ts`, recap marking (1 test) | written after the two lines it covers landed in `3f53079`; a mutation that breaks them fails it | passed |
| plugin `text.test.ts` (11 tests) | 10 failed (`catchUpText` missing, no `AssistantText`, no `textOffset`); 1 guard passed (notification skipped as the trigger) | 11 passed |
| plugin `dist.test.ts`, Stop never reads the transcript, its child sends the text (1 test) | failed: no text posted | passed |
| plugin `recap.test.ts` (12 tests) | suite failed: `src/recap.js` missing | 12 passed |
| plugin `recap.test.ts`, worktree file path (1 test) | failed: no file on the part | passed |
| plugin `recap.test.ts`, parts the map lacks (2 tests) | 2 failed: the recap was accepted | passed |
| plugin `dist.test.ts`, the recap run uploads nothing (1 test) | written with the recap; a mutation that passes `MURMUR_ALLOW_HEADLESS` to `claude` makes it fail with the recap run's own session on the server | passed |

The Stop timing test logs every open and read of the transcript through a `--require` spy in both processes: the hook process has none, its detached child does.
The recap proof uses a fake `claude` that runs the built hook in an "on" project with the env it was given, while the parent has `MURMUR_ALLOW_HEADLESS=1` (and, since the review fixes, a `claude-vscode` attended entry point); the server receives the recap's events and none from that run's session, and the queue is empty after.

Totals: core 241 (206 before), plugin 140 (112 before), server 92, web 110, all passing.

## Checks

Each run on its own, after the last code commit:

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 0 (no warnings) |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 |
| `pnpm -s build:plugin` | 0 (no diff in `plugin/dist`) |
| `pnpm --filter @murmur/web -s build` | 0 |

## The author's session, through the API

The server was restarted (new hook name), the session deleted as "Sarthak" and re-imported as the brief says, with the recap on.
Read back with `GET /api/sessions/27a000a1-.../events` (cookie jar `~/.murmur-local/jar2`) and reduced with core: 7,883 events, 180 `AssistantText`, 171 recap events.

| Request | Messages | Linked to a task | Linked to a helper | Helpers with a report | Recap |
| --- | --- | --- | --- | --- | --- |
| "I love it, let's build it" | 6 | 0 | 0 | 0 of 0 | yes |
| "Yes please go ahead" | 84 | 33 | 37 | 31 of 32 | yes |
| "Please track it in more detailed for each phase as well bro" | 54 | 11 | 18 | 19 of 19 | yes |
| "continue with the work" | 24 | 0 | 9 | 12 of 14 | no (narrated live) |

The helpers with no report were still running or never reported when the import ran.
Before the recap (a dry run of the reducer over the same transcript), the second and third requests linked 32 and 8 messages.

Task 1 ("Task 1: Lit plate tokens", recap part "Design tokens") has 6 files, the same on the recap and the inferred view, shown without the worktree prefix:

- `frontend/src/styles/index.css` +22 -6
- `frontend/tailwind.config.js` +7 -0
- `frontend/src/styles/__tests__/litTokens.test.js` +62 -0
- `frontend/index.html` +1 -2
- `frontend/src/context/ThemeContext.jsx` +7 -7
- `frontend/src/context/__tests__/ThemeContext.test.jsx` +27 -0

The cause of the 0 was both halves of section 4: the helper changed these files only with Bash (`python3 -`, `sed -i`, `cat > file`), and `touchOf` read only Edit and Write; the attribution to the helper's part was already right.

## The recap's cost

Each re-import asks 3 calls (the newest request is narrated, so it is not asked), run 3 at a time.
Durations and costs as `claude -p` reported them (`duration_ms`, `total_cost_usd`):

| Round | "I love it" | "Yes please go ahead" | "Please track it" | Total |
| --- | --- | --- | --- | --- |
| 1 | 15.0 s, $0.0374 | 34.3 s, $0.1390 | 36.7 s, $0.1368 | $0.31 |
| 2 | 15.3 s, $0.0241 | 29.4 s, $0.0493 | 34.9 s, $0.0642 | $0.14 |
| 3 (final) | 13.8 s, $0.0317 | 31.1 s, $0.1308 | 34.0 s, $0.1298 | $0.29 |

Nine Sonnet calls in all, $0.74, plus one Haiku call of $0.00003 to check the flags and the output shape.
Each whole backfill child, import plus recap plus uploads, took 61 to 65 s.
Rounds 2 and 3 were needed because round 1 and round 2 each showed a bug on the real data.

## Found on the real session

- Recap parts showed no files (`aa81542`): a helper in a worktree has the worktree as its cwd in the plugin, but the server gives every event the session's cwd, so the model's relative paths never matched; the recap now names files by their full path.
- Round 2 returned a map for "Yes please go ahead" with twelve tasks pointing at parts and an empty part list, which passed the zod schema and drew no parts (`eb02e7a`): `RecapInput` now refuses it and the prompt says so.
- On the recapped request, `index.css` (changed by ten tasks) landed whole (+279 -187) on one part, because every recap narrate comes before every change and the last part naming a path took them all (`b949076`): a helper's change now goes to the part that helper narrated.
- The live session already ran the new catch-up before the re-import (its session file had a `textOffset`), so the installed plugin runs this repo's `plugin/dist`.

## Left or uncertain

- The backfill cap was 20 MB when this report was first written, which dropped the two oldest style requests of this session (the whole history is 23.2 MB, mostly because a Bash result's `bashEditDiff` is now sent whole). It was raised to 40 MB in `d23a858`, so the whole session fits; the queue cap went to 100 MB in the review fixes so two imports at once fit too.
- "What Murmur sends" needs its sentence in `web/src/pages/WhatMurmurSends.tsx` (screens builder).
- A recap with a timeout of 60 s holds for these three (14 to 37 s); a request with many more parts could pass it and keep its inferred view.
- A recap is never redone: the server keeps the first copy of each id, so changing a recap means deleting and re-importing the session.
- `--max-turns` is not in `claude --help` but is accepted; `--safe-mode` still lists the installed plugins in the init message, so hooks are also off through `disableAllHooks`, and the run is headless either way.
- The costs above are what `claude -p` reports; this account signs in with Claude Code's own login (`apiKeySource: none`), so they are notional rather than billed per call.
- One relative path changed in both a worktree and the main tree maps to the last full path seen (marked `ponytail:` in `recap.ts`).
- Message task links on the narrated "continue with the work" request are 0: its task titles do not appear in Claude's messages and its messages name no task ids from its own plan.

## Review fixes

From an Opus review of the data layer. Each fix has a test that failed first for the reason named, unless noted.

### Commits

- `e7fdc48` fix(plugin): text from times Murmur sends nothing is never sent later (items 1, 2, 11 hook part, 4 hook part)
- `777e8f4` fix(plugin): the upload queue holds 100 MB, two history imports at once (item 10)
- `783af83` fix(plugin): the recap is bounded, headless on purpose and scrubbed (items 3 to 9)
- `174362a` docs(web): What Murmur sends says the recap runs on your machine (item 11 copy)

### What changed

1. Quiet times (critical). `skipText` (in `local.ts`) moves a session's `textOffset` to its transcript's current size, for a session on record, with a stat only.
   `handleHook` calls it on every path that sends nothing: headless, the recap's own run, no project state, off, asked, logged out, disconnected, paused, on any hook, not only Stop.
   `catchUpText` calls it instead of returning in the same cases.
   `murmur on`, `resume` and `login` call it for the session they run in, and the login poller calls it again when the login is approved.
   Tests, one per sequence the reviewer reproduced, with real `handleHook` and `catchUpText` calls: a headless `claude -p --resume` turn, then an interactive Stop; text while logged out and while disconnected, then a login; a paused turn stopped with Esc after its last hook, then `/murmur:resume`; plus `on` and `login`, and the poller.
2. Sessions imported before this branch. A missing `textOffset` now means "start at the transcript's current size": the live read sends nothing and sets it.
   `runBackfill` sets `textOffset` itself: it stats the transcript first, reads the history only up to that byte, keeps Claude's text from the cutoff up to there in the import, and stores the end of the last whole line it read. That replaces the second whole-file read; a line half written at that moment is read live once it is whole.
3. Recap bounds. Only the 5 newest unmapped requests are ever asked, newest first.
   No ask starts after 150 s, or later than 70 s before the backfill child's deadline (230 s of its 240 s), and the second upload gets what time is left.
   A request is marked `recapped` just before it is asked, so one never asked is asked by a later run.
   Live `claude` children are killed when the process exits; a killed run ends at once rather than when its own children let go of the pipe.
   Tests with the fake `claude`: 7 requests asked as the 5 newest in order; a 300 ms budget against 600 ms asks stops after the first 3 and marks only those, a later run asks the other 2; `killRecaps` kills a running fake.
4. The recap's run is headless on purpose. Its env gets `CLAUDE_CODE_ENTRYPOINT=sdk-cli`, `CLAUDE_CODE_SESSION_ATTENDED=0` and `MURMUR_RECAP_RUN=1`, still without `MURMUR_ALLOW_HEADLESS`.
   `MURMUR_RECAP=0` stays the user's switch; `MURMUR_RECAP_RUN=1` is the run's own marker, which the hook, the live read and the recap all refuse outright.
   The dist test's fake `claude` no longer sets a headless env itself: it runs the built hook with exactly the env it was given, under a `claude-vscode`, attended parent with `MURMUR_ALLOW_HEADLESS=1`. Against the old code the recap run's own session reached the server; now nothing from it does.
5. Recap events go through `scrubEvent`; a test puts `token=...` in an aim.
6. A full path longer than narrate's 300 characters falls back to the path the model was shown, so the part's detail still validates.
7. Before each ask the recap checks the session is logged in, its project on and it is not paused; a test turns the project off, then pauses the session, and nothing is asked or marked.
8. The hook records what started an import (`triggerHook`, `SessionStart:<source>` for a start). `lastRequestOpen` says the last request may still be going unless a prompt or a non-compact SessionStart started it; then the recap leaves the last request alone.
9. `RecapInput` refuses duplicate part ids, task ids, part detail ids and task end ids.
10. The upload queue cap is 100 MB (was 50 MB). The test was written after the change; with the value set back to 50 MB it fails (1 of 3 big files kept).
11. `handleHook` refuses `AssistantText` from stdin. "What Murmur sends" gains: "Imported history is summarised once by your own Claude, on your machine, for up to 5 recent requests." It has no test, as `web/test` is not mine to change.

Tests written after the code they cover, each checked with a mutation that makes it fail: the login poller (removing its `skipText`), the half-written line at the end of a backfill (storing the stat size instead of the last whole line), and the queue cap.
One existing test changed: "after a backfill, starts from its cutoff" became "a session imported before Claude's text was read starts at the transcript's end", since that is the rule now.

### Tests, RED then GREEN

| Suite | RED | GREEN |
| --- | --- | --- |
| plugin `text.test.ts`, quiet times, old imports, AssistantText on stdin, the recap marker, the backfill offset (8 tests) | 8 failed | passed |
| plugin `text.test.ts`, the login poller, a half-written last line (2 tests) | after the code; mutations fail them | passed |
| plugin `recap.test.ts`, duplicate ids (2 cases), 5 newest, budget, kill, state re-check, last request, trigger recorded, child env, scrub, long path (11 tests) | 11 failed (`killRecaps` missing for one) | 26 passed in the file |
| plugin `dist.test.ts`, the recap run uploads nothing under a `claude-vscode` parent | failed: the run's own session reached the server | passed |
| plugin `upload.test.ts`, queue cap (1 test) | after the code; fails at 50 MB | passed |

Totals: core 241, plugin 161 (140 before the review), server 92.

### Checks

Each run on its own after the last commit. Web files the screens builder was editing at the same time are named where they fail.

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 1, only for `web/test/zz-prof.test.tsx` (the screens builder's file, being written); `biome check plugin packages server` and the copy file pass |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 1, only `web/test/zz-prof.test.tsx > prof`; core 241, plugin 161, server 92 pass, web 202 of 203 |
| `pnpm -s build:plugin` | 0 (no diff in `plugin/dist`) |
| `pnpm --filter @murmur/web -s build` | 0 |

The first run, a minute earlier, also failed web typecheck (`web/src/part/EventView.tsx`), web lint (`web/src/markdown.tsx`, `web/test/markdown.test.tsx`) and two `web/test/events.test.tsx` tests, all files the screens builder was changing; they passed on the rerun.

The author's session was not re-imported or recapped again.
