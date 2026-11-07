# Murmur: a live plan that stays true, a timeline that reads, no serif

From the author on 7 Nov 2026, on his real running request ("continue with the work", task "Inventory of every agent page element", session `27a000a1-…`, request `6a4a8307-cae9-5162-bbd0-473bc5db1168`): "What the fuck is this, also I think some tasks are already done in this, why doesn't it show, also change the serif font bro, its ugly".

## 1. A live plan that stays true (plugin and core)

Claude drew that request's plan once at the start and almost never narrated task changes, so the plan reads 0 of 5 and "In progress" while the work is done (helpers reported DONE, commits exist, Claude's messages say "Task 17 is done").

- In the detached child a hook already spawns (never in the hook), after Stop: refresh the plan of the session's latest request when it has a narrated map and is stale.
  Stale means: at least one task not done, and since the last narrate that changed a task's status either 3 or more helper reports arrived or 20 minutes passed.
  At most once every 30 minutes per request, one refresh at a time per session, state in the session file.
- The refresh is the existing recap path (`plugin/src/recap.ts`, the user's own `claude -p`, same flags, env and safety, `MURMUR_RECAP=0` turns it off), with the request's current map in the input so the model keeps the same phase, task and part ids and returns each task's status and a one-line outcome, plus part detail.
  Validate that every id it returns exists in the current map; refuse otherwise.
  Emit recap narrate events (deterministic ids from the request id and refresh time) that set task statuses and detail; the request keeps its narrated map.
- Tests with the fake `claude`: refresh runs when stale, not when fresh or within 30 minutes, keeps ids, refuses unknown ids, never from a headless run, its own run uploads nothing.
- Then run it once for real on that request (restart nothing; run the backfill child path or a small script that calls the refresh for session `27a000a1-7dbc-4dd1-ab83-961149fc03ae` with `CLAUDE_CODE_SESSION_ATTENDED=1`) and report the plan before and after through the API as the "Sarthak" account (`~/.murmur-local/jar2`).

## 2. A timeline that reads (web)

On that task the one helper ("Agent 2") ran from 03:54 to past 13:00 in many rounds; the lane shows a row of tiny bars with "Bı", "Fixed", "ixe", "xed" overlapping each other.

- Runs closer together than a label's width merge into one bar labelled with what they were ("6 fix rounds", or the first label plus "+5"); a label is drawn only where it fits without touching another, else it is in the bar's tooltip and the step list below.
- A lane that spans hours with long gaps compresses the gaps (a marked break on the axis) so the runs keep a readable width.
- Tests: many short runs on one lane, overlapping labels, a ten-hour span with gaps; no two labels ever overlap (measure in the test from the computed layout).

## 3. No serif (web)

Drop Newsreader everywhere. Geist for all interface text, titles and Claude's words; Geist Mono for code, times and numbers. Keep the hierarchy with size and weight (titles 600, Claude's words 400 at a comfortable reading size and line height), and check every page still reads well and matches the layout.

## Checks

Each builder: tests first, then `pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`, each exit code on its own; screenshots of the real task page above and the request page at 1440 × 900 into `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/fix3-*.png`.
