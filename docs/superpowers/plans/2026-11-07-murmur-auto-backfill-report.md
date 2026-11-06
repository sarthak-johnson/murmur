# Murmur auto-backfill: build report

Branch `feat/auto-backfill`, 7 Nov 2026.
Brief: `2026-11-07-murmur-auto-backfill.md`.

## What was built

- `plugin/src/backfill.ts` (new): `readBackfill` maps a transcript and its `subagents/agent-*.jsonl` (+ `.meta.json`) to MurmurEvents older than the cutoff, scrubbed, sorted, capped at 5,000 events and 20 MB with the newest kept.
  `runBackfill` runs in the detached child: pending to running, enqueue, done, then `flush` with a 50 s budget.
  `stableId` gives the shared deterministic ids (see below).
- `plugin/src/hook.ts`: the first event of a session with no state file, in an on, logged-in, not revoked, not paused, attended project, writes `backfill: "pending"`, `cutoff` (the event's own `ts`), `transcriptPath`, `cwd`, and returns `backfill: <id>`; `main` then spawns `hook.cjs --backfill <id>` detached (that child also flushes the live event).
  A startup SessionStart, or a payload without `transcript_path`, marks `done`.
  `--backfill` gets a 60 s exit timer instead of 5 s.
  UserPromptSubmit prints the `NARRATION_INSTRUCTION` as UserPromptSubmit `additionalContext` once when `instructed` is false; SessionStart sets `instructed`.
  UserPromptSubmit joins SessionStart and Stop as a synchronous hook whose upload is a detached `--flush`.
- `plugin/src/local.ts`: the narration file became `SessionState` (`readSession`, `writeSession`, `updateSession`, `isNewSession`); a new prompt resets only the narration fields.
- `plugin/hooks/hooks.json`: UserPromptSubmit no longer `async`.
- `biome.json`: ignores `plugin/test/fixtures` (transcripts stay one JSON object per line, like `e2e/fixtures`).
- Fixture: `plugin/test/fixtures/backfill/` hand-made in the real format with neutral content: human prompts with `origin.kind: "human"`, a meta system-reminder entry, an interrupted text entry, Read, Edit with `structuredPatch`, a failing Bash, an Agent call, malformed lines, entries without timestamp, a finished subagent with meta and a still-running one.
- `plugin/dist` rebuilt.

## Deviations from the brief, and why

1. **Shared ids for live and backfilled events.**
   I checked the brief's assumption that the cutoff alone prevents double sends with a real `claude -p` run and a timestamping capture hook.
   Claude Code writes the entry before the hook runs: the prompt entry was 60 ms older than the UserPromptSubmit hook, the tool_use entry 59 ms older than PreToolUse (the tool_result came 5 ms after PostToolUse).
   So the event that triggers the backfill is always also in the imported history, and parallel tool calls race the same way.
   The same run showed the hook's `prompt_id` equals the transcript's `promptId`.
   Fix: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart and SubagentStop get a version-5-layout UUID from SHA-1 of `murmur:<session>:<hook>:<prompt_id | tool_use_id | agent_id>`, both live and in the backfill, and the server's `(user, id)` dedupe keeps one copy.
   Other entries fall back to the brief's `murmur-backfill:<session>:<entry uuid>:<index>:<hook>` key; other live hooks keep random ids.
2. **SubagentStop only when the meta says `finished: true`.**
   A running subagent's meta has no `finished` key (checked on a live one), so the brief's "last entry is the stop" would end it early, and with the shared id the real live stop would then be dropped.
3. **"Seen" means a session state file exists.**
   A session that was already live before this version has a narration file, so it is not re-imported on upgrade (its live events had random ids and would duplicate).
4. **SessionEnd no longer deletes the session file**, so resuming an ended session does not import it again.
   The narration part resets on the next prompt as before.
5. **A paused session with no state is marked done**, so a later resume never imports what happened during the pause.
6. UserPromptSubmit backfill events also carry `prompt_id` (needed for the shared id; the live payload has it too).

## TDD evidence

- RED `test/backfill.test.ts`: suite failed, `Cannot find module ../src/backfill.js` (no tests ran).
- RED `test/hook.test.ts`: 8 failed / 19 passed (backfill marking, startup done, state kept over prompts and SessionEnd, gates, shared live ids, UserPromptSubmit instruction once, UserPromptSubmit synchronous in hooks.json).
- RED `test/dist.test.ts` "UserPromptSubmit answers fast with the instruction while the server hangs": `expected 3084 to be less than 1500`.
- GREEN: plugin 78/78.
  Final run: `pnpm build:plugin` 0, `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (163 + 78 + 89 + 94 tests across the four packages, all passing), each exit status checked separately.

## End-to-end result

Against the running local server at `http://localhost:8787`, with a temp `MURMUR_HOME` and dev user `backfill-test`, logged in through the real device flow (start, approve with cookie + Origin, poll) and `bin/murmur on` for a temp git repo.
The fixture was copied with a fresh session id, its cwd rewritten to the temp repo and its times shifted so the last prompt entry sat 50 ms before now, as in a real session.
The UserPromptSubmit hook was run through its `hooks.json` command (`sh node.sh dist/hook.cjs`) with `prompt_id: "p-2"` for that same last prompt.

- Hook exited 0 in 126 ms and printed the UserPromptSubmit `additionalContext` instruction.
- State afterwards: `backfill: "done"`, `instructed: true`; queue empty.
- `GET /api/sessions/:id/events`: 17 events, the full history in order, with "Now add a README" stored once although both the live hook and the backfill sent it.
- `reduce` over those events: title "Add a greet function with a test", 2 requests, request 1 has `greet.js +2 -1`, subagent `a1b2c3` done ("Look around") and `d4e5f6` running.
- The web app (`/s/<id>`) showed both requests, Files touched `greet.js +2 -1`, and the running helper.
- The test user's session was deleted afterwards (`DELETE /api/sessions/:id` 200, list empty).

## Concerns

- The backfill reads each transcript whole into memory; a very large transcript (hundreds of MB) costs memory and time in the detached child.
  It never blocks Claude, but streaming line by line would be the upgrade.
- The local queue's 7-day cap drops backfilled events older than 7 days before they are sent, so a resumed old session shows only its last week.
- Entries whose `cwd` is a project that is not on are dropped by `flush`, the same as live events from that folder.
- A crash between `running` and `done` leaves the session marked running and it is never retried.
- Two hooks firing in the same few ms on an unseen session can both spawn a backfill; the shared ids make the second harmless.
- On upgrade, sessions already running get the instruction a second time on their next prompt (their old state file has no `instructed`).
- The session title comes from the first prompt that reached the server; if a live prompt arrives before the backfill lands, the newer prompt can stay as the title.
- Session state files are no longer deleted at SessionEnd, so `MURMUR_HOME/sessions` grows by one small file per session.
- UI nit seen in the E2E: a helper with no description shows "Agent 2 ·" with a dangling separator.
  It only shows when the Agent call is missing, which the fixture set up on purpose, so I left it.
- Not pushed or merged.

## Review fixes (round 2)

Each fix began with a failing test.
RED: plugin 15 failed / 73 passed (backfill mapping, shared prompt ids, tail read, stale retry, prompt trigger, login change, off-project marking, session prune, queue age), web 1 failed (`expected 'Agent 1 · Server endpoint' to be 'Agent 1Server endpoint'`).
GREEN: `pnpm build:plugin` 0, `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (163 + 88 + 89 + 95), each exit status checked separately.

1. **Prompt ids (controller ruling).**
   `stableId` no longer covers UserPromptSubmit, so live prompts have random ids again and backfilled prompts use the entry-uuid key.
   The session state records `trigger`; when it is UserPromptSubmit the backfill drops the newest human prompt in the main transcript before the cutoff.
   Tool events and SubagentStart/Stop keep shared ids.
   Tests: three fixture prompts share `promptId: "p-1"` and stay three events; a prompt-triggered run queues 20 of the 21 events, without the newest prompt.
2. **Slash commands** (`<command-name>` / `<command-message>` / `<command-args>` wrappers) become `/<name> <args>`, trimmed; in the fixture as `/murmur:on now`.
3. **Tail reads.**
   Each transcript and subagent file is read from its last 30 MB (`tailBytes`), dropping the first partial line.
   A `pending` or `running` state older than 10 minutes (from `runningSince`, else the cutoff) is stale: the next hook hands it to a new child with the same cutoff, and the child accepts it.
   Tests: 2,000 synthetic prompts with a small tail give only the last 10; the hook respawns a stale pending or running backfill (not a fresh one, not a done one), and `runBackfill` retries a run older than 10 minutes.
4. **Queue age** is the queue file's mtime, not the event's `ts`.
   I removed the `Date.now` fake from the backfill test.
   Test: an event 30 days old, queued now, is sent; a file queued 8 days ago is dropped.
5. **Off projects**: a new session in an `off` project gets `{backfill: "done"}`, so `/murmur:on` never imports its off time.
   An unset or asked project still imports.
6. **Built-bundle `--backfill` test**: pending state plus the fixture, `node dist/hook.cjs --backfill <id>` against a fake HTTP server; the posted ids match `readBackfill` and the state ends `done`.
   The UserPromptSubmit dist test now pre-marks its session done, so no backfill child lingers against the hung server.
7. **Text and image prompts** with `origin.kind: "human"` join their text blocks into the prompt.
8. **SubagentStop** is also emitted when the main transcript has the result of the meta's `toolUseId` call.
   That result is skipped when its `toolUseResult.status` is `async_launched`: background helpers get that result at once (all 61 Agent results in the sample session were `async_launched`), so counting it would stop them early.
9. **Login change**: `runBackfill` reads the credentials again before flushing and skips the flush when logged out or the token changed (the events stay queued; `flush` already drops other logins' events).
10. **Session state prune**: a startup SessionStart deletes `sessions/*.json` idle (mtime) for over 30 days.
11. **Web**: `Agent <k>` without ` · ` when there is no description, in NowCard, PlanPanel and PartDetail; the map tooltip also drops its `: `.

End to end again on the local server, same setup as before: the hook answered in 142 ms with the instruction, state `done` with trigger `UserPromptSubmit`, and the server had 21 events (20 backfilled plus the live prompt), with "Now add a README" once, the slash command and the text+image prompt as prompts, and `a1b2c3` stopped through its Agent call result.
The test session was deleted afterwards.

Remaining concerns:
- The prompt rule assumes Claude Code writes the prompt entry before the UserPromptSubmit hook (measured at about 60 ms before); if a version ever writes it after, the previous prompt would be dropped instead.
- A SubagentStop inferred from an Agent result uses the helper's last entry time; with a cutoff between that entry and the result, no stop is imported and none comes live, so the helper shows as running for good.
- A session resumed after its state was pruned (idle 30 days) imports again, and its prompts would then duplicate (random live ids).

## Trigger prompt matched by text (round 3)

Controller ruling: the backfill leaves out the newest human prompt before the cutoff only when its text equals the triggering UserPromptSubmit `prompt`, both trimmed, after the same slash-command and text-block normalisation; otherwise it skips nothing.
The session state now keeps `triggerPrompt` (the live payload's `prompt`, set only for a UserPromptSubmit trigger) instead of `trigger`, and `readBackfill` takes `skipPrompt`.
The comparison runs on the text before scrubbing.

RED: 3 failed (newest "b" not skipped for trigger "b", the prompt-triggered run queued 21 instead of 20, the state lacked `triggerPrompt`).
GREEN: `pnpm build:plugin` 0, `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (163 + 90 + 89 + 95), each exit status checked separately.
Tests: trigger "b" with transcript prompts "a", "b" imports "a"; trigger "b" with only "a" written imports "a"; trigger "b" with "b", "a" imports both; whitespace and a slash-command wrapper still match; a resume trigger stores no prompt.

This replaces the round 2 concern about write order: if the entry is written after the hook, nothing is dropped, and the worst case is one duplicate prompt.
Remaining: whether the live `prompt` of a slash command is exactly `/name args` is not verified against a real payload; if it differs, that one prompt shows twice.

## Pre-merge fixes (round 4)

1. `pruneSessions` keeps session state until it has been idle for over 100 days, just past the server's 90-day default `retention_days`, so a session resumed while the server still holds it is never imported twice.
   The hook test now checks that 101 days idle is deleted and 95 days is kept.
2. When the backfill finishes, the session state is rewritten as `done` without `triggerPrompt`, so the raw prompt text does not stay on disk.
   The prompt-trigger test checks that the state has no `triggerPrompt` and that the file no longer contains the prompt text.

RED: 2 failed (`expected 'Now add a README' to be undefined`; the 95-day file was deleted).
GREEN: `pnpm build:plugin` 0, `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (163 + 90 + 89 + 95), each exit status checked separately.
The round 2 concern about pruned sessions now applies only to sessions resumed after 100 idle days, which the server has deleted under the default retention anyway.
A user with a retention setting longer than 100 days could still see one import twice.
