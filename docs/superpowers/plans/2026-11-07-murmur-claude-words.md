# Murmur: bring in Claude's own words (data layer)

Asked for by the author on 7 Nov 2026, after an audit of every screen: Murmur shows which files changed, never what happened or why.
Audit and proposal: https://claude.ai/artifact/GwiQJfqjYQvyCv9NeBVqvG (local copy `reports/audit/murmur-audit.html`, not in git).

His session (`27a000a1-7dbc-4dd1-ab83-961149fc03ae`, transcript `/Users/sarprasa/.claude/projects/-Users-sarprasa-tradara-stock-screener/27a000a1-7dbc-4dd1-ab83-961149fc03ae.jsonl`, subagents in the folder of the same name) holds three sources of plain words that Murmur drops today:

- 190 text blocks Claude wrote to him (`type: "assistant"`, content block `type: "text"`), for example "The review found one real problem: the plate's gain and loss colours used the earlier, weaker values instead of the brighter ones the prototype settled on. I'm sending it back to the same builder to fix."
- 60 helper briefs (the `Agent` tool's `tool_input.prompt`, about 2,800 characters each); already in events, shown only folded.
- 90 helper reports: `type: "user"` entries with `origin.kind: "task-notification"`, whose text is `<task-notification><task-id>…</task-id><tool-use-id>toolu_…</tool-use-id><output-file>…</output-file><status>completed</status><summary>Agent "X" finished</summary><note>…</note><result>…report…</result></task-notification>`; live they arrive as a `UserPromptSubmit` whose prompt is that text. A foreground helper's report is the `Agent` PostToolUse `tool_response` instead.

This brief is the data layer only; the screens come in a separate brief after the author approves the mocks.

## 1. Claude's messages as events

- Add `AssistantText` to `HOOK_NAMES` (core `events.ts`); payload `{ text, session_id, cwd, hook_event_name }`, main thread only (subagent chatter stays out).
- **History (backfill):** `readBackfill` emits one `AssistantText` per non-empty main-thread text block before the cutoff, id from the existing deterministic scheme (entry uuid + block index).
- **Live:** the detached child the hook already spawns (flush) first catches up on text: it reads the transcript from the byte offset stored in the session state (`textOffset`, starting at the backfill cutoff's position or the file's size when the session is first seen live), emits `AssistantText` for complete new lines, and stores the new offset.
  Use the streaming reader from `backfill.ts`; never in the hook process itself (hooks stay fast; the existing built-bundle timing test must still pass).
  Same deterministic ids as the backfill, so a backfill and a live catch-up never duplicate.
  Same on/off, paused, logged-out and headless rules as every other event (they already apply in `flush`).
- Text goes through `scrubEvent` like everything else (secrets, the 256K cap).

## 2. Helper reports

- **History:** import `origin.kind === "task-notification"` user entries as `UserPromptSubmit` with their text as `prompt` (exactly what the live hook sends), deterministic id.
- **Core:** parse a notification prompt (`<tool-use-id>`, `<status>`, `<summary>`, `<result>`); attach to the `AgentView` whose Agent call has that tool use id: `report: { status: "completed" | …, summary, text, ts, interim: boolean }` (interim when the note says the agent is waiting on its own background work; a later notification for the same id replaces it).
  A foreground helper's report is the text of its Agent PostToolUse `tool_response` content.
  The first line of a report that looks like `Status: DONE`, `Status: DONE_WITH_CONCERNS`, `Status: BLOCKED` and so on becomes `report.verdict`.
- Notification prompts stay out of requests and titles (already the case in core and the plugin).

## 3. Messages in the view

- `RequestView.messages: { id, ts, text, task?: string, agent?: string }[]`, in time order, every `AssistantText` between the request's prompt and the next request.
- `task`: the part a message is about, when the message names its subject ("Task 1", "Tasks 4 and 5", "Tasks 4-5", "B7", "bug B1") using the same subject ids as the inferred parts (`history.ts`), or, for a narrated request, a part or task title it contains.
  `agent`: the helper whose report arrived just before the message (within the same turn), when there is one.
  Leave both unset when unsure: a wrong link is worse than none.
- `AgentView.brief`: the first paragraph of the prompt that is about the work (skip lines that only point at files to read or give working rules; take the paragraph under a `## Context` heading when there is one), plain text, at most 600 characters, cut at a sentence end.

## 4. Files changed through commands

- On his session, "Task 1: Lit plate tokens" shows 0 files although its helper changed `frontend/src/styles/index.css` and three more. Find out why (subagent file edits not attributed? edits made with Bash?) and fix the attribution.
- A Bash result's `bashEditDiff` (`{ files: [{ filePath, hunks: [{ oldStart, oldLines, newStart, newLines, lines }] }] }`) counts as a file change in `view/files.ts`, like an Edit, and the scrubber keeps `bashEditDiff` whole (it is a diff the view shows) while the rest of a Bash result stays cut at 2,000.

## Tests (test first)

- Backfill on a hand-made transcript in the real shape: text blocks become `AssistantText` with stable ids; notifications become `UserPromptSubmit`; nothing at or after the cutoff.
- Live catch-up: a transcript that grows between two catch-ups emits each text once; a half-written last line waits for the next round; off, paused, logged out and headless send nothing; the hook process never reads the transcript (timing test).
- Core: notification parsing (completed, interim then final, failed), report attached by tool use id, foreground report, verdict line; messages per request; task links for the subject forms above and none when unsure; brief extraction on a real-shaped prompt.
- Files: a `bashEditDiff` result counts; the Task 1 attribution case.
- Scrub: `bashEditDiff` kept whole, a secret inside it still redacted.

## Checks before you report

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`, each exit code checked on its own.
Then re-import his session so the server has the new events, and paste into the report per request: message count, messages linked to a task, helpers with a report, and Task 1's files.
To re-import: as the "Sarthak" account, `curl -s -X DELETE -b ~/.murmur-local/jar2 -H "Origin: http://localhost:8787" -H "Content-Type: application/json" http://localhost:8787/api/sessions/27a000a1-7dbc-4dd1-ab83-961149fc03ae`, then set `backfill: "pending"`, `cutoff` to now and drop `runningSince` in `~/.config/murmur/sessions/27a000a1-7dbc-4dd1-ab83-961149fc03ae.json` (atomic write), then run `node plugin/dist/hook.cjs --backfill 27a000a1-7dbc-4dd1-ab83-961149fc03ae`. This is the one exception to never touching `~/.config/murmur`: that one session file only.
The server must be restarted after a core change it validates (the new hook name): stop the `tsx src/index.ts` process and start it again from `server/` with `MURMUR_DEV_LOGIN=1 nohup npx tsx src/index.ts >> ~/.murmur-local/server.log 2>&1 &`, then check `/healthz`.

## 5. Claude fills what the words alone cannot (recap)

The author's call (7 Nov 2026): what Murmur cannot fill from the history, the user's own Claude fills, in Murmur's own format.

- After a backfill has imported a session, the same detached child runs one recap per imported request that has no valid map: `claude -p` (the user's own Claude Code, so no new login), model `sonnet`, no tools, JSON output, prompt on stdin.
  Find the exact flags with `claude --help` (print mode, output format, model, disabling tools, max turns); never pass the user's credentials anywhere, never read Claude Code's stored credentials.
- Input per request, capped at about 60,000 characters: the prompt, Claude's messages in order with times, each helper's description, brief paragraph, report verdict and summary, and the files changed.
- Ask for exactly the existing `map` tool input (`MapInput`: kind, goal, phases with tasks, parts with links) plus, per part, the fields `narrate` already carries for part detail (aim and done-when, steps, choices with reasons, checks, words), plus one line per task on how it ended.
  Validate the JSON with the existing zod schemas; on any failure, keep the inferred view and log one line, never retry in a loop.
- Emit the result as synthetic `map` and `narrate` PreToolUse events (deterministic ids from the request id, timestamps just after the request's prompt), with `recap: true` in the payload, so core draws them on the narrated path with no new view code; the web labels them "Recap by Claude" where it shows `inferred` today.
- Never recaps a request twice (state in the session file), never from a headless run (the headless rule already stops a `claude -p` run's own hooks from uploading; add a test that proves the recap run itself sends nothing), and `MURMUR_RECAP=0` turns it off.
- Tests with a fake `claude` binary on PATH: success, bad JSON, timeout (60 s), missing binary.
- Add one sentence to "What Murmur sends": imported history is summarised once by your own Claude, on your machine.
