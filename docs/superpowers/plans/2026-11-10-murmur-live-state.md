# Murmur: tell the truth while a request runs (core first, web where it shows)

Found on 10 Nov 2026 by watching the author's live session `c8e82aaf-dde0-4714-802b-38b5dd45fe83`, request 7 (`3d05d8cf-d182-46cf-b6eb-6ec4441ecf7d`), between 21:04 and 21:25 IST.
He asked: "attach and check in live if everything is alright, find bugs and what we should show as well, how we can improve".
The request: 8 tasks in 3 phases (Mockup 5, Voice 1, Video 2); Claude wrote the player shell, then started two helpers ("Build demo scenes 1, 2, 4" and "Build demo scenes 3, 5, 6, 7"), tried ElevenLabs, found it signed out, asked the author to sign in, and ended its turn (Stop at 21:03:54) while both helpers kept working; it woke at 21:17 when one helper finished and again asked him to sign in.

## What is wrong (each seen on the live page; reproduce each with the dump script before fixing)

1. **"Waiting on you" never shows.**
   Claude asked the author to sign in at 21:03 and again at 21:17, and narrated task t6 with `taskStatus: "blocked"` and the reason.
   The page says "Running", nothing is amber, the brief's "Where it stands" never mentions it, and `SessionView.needsYou` is null: `needsYou()` in `packages/core/src/view/flags.ts` only reads permission and idle notifications, and the idle notification does not come while helpers run.
2. **A task waiting on the user is drawn as failed.**
   `TASK_STATUS` in `packages/core/src/view/requests.ts` maps `blocked` to `failed`, so the ElevenLabs task is a red cross on the track, a red "Failed" card on the flow board, and its page says "Not started" next to a red problem pill and a "Failed" step.
3. **A phase with done tasks says "not started".**
   Mockup reads "5 tasks, not started" on the track and "Not started" on the Story heading while 3 of its 5 tasks are done; the flow board column says "Not started · 2 of 3 done".
   The phase status comes from Claude's `map` and is never reconciled with its tasks.
4. **Helpers are not tied to the tasks they do.**
   Both scene helpers have no `part`; tasks t3 and t4 (scenes) stay "not started" while their helpers run; the flow card "Seven scene files" says "0 helpers"; the Story tab lists the running helpers under the Voice phase.
   Claude named the scenes in the helper descriptions and in its 21:02 message, and the plan's tasks t3/t4 say "Scenes 1-4" and "Scenes 5-7".
5. **Files written by helpers land on the wrong task.**
   All 8 scene files the helpers wrote (`s1-agents.js`, `s2-basket.js`, `s3-backtest.js`, `s4-cpi.js`, `s-kit.js` and more) are filed under "Script vs product check", a task that was already done and wrote none of them.
   A file a helper writes belongs to that helper's task or part; when the helper has none, to the helper ("Build demo scenes 1, 2, 4"), never to whatever the main thread narrated last.
6. **Claude's messages go under the wrong phase.**
   Claude's 21:17 message about scenes 1, 2 and 4 sits under "Voice · Running" on the Story tab, because Voice is the live phase.
7. **A finished helper says nothing about how it went.**
   "Build demo scenes 1, 2, 4 · 21:02 to 21:16" on the Story side card and the Helpers tab, with no result line, though its report is in the events.
8. **Zero tiles on the journey.**
   "0 tasks sent back after review" and "0 pauses over an hour" are headline numbers; a zero says nothing, so leave the tile out.

## What to show

- **Waiting on you while helpers work.**
  When Claude's turn has ended (Stop) and its last words or a task's `blocked` reason ask the author for something, the session `needsYou` is set (reason "input", the ask in Claude's words, cut to one sentence; "Sign in to ElevenLabs in the Chrome tab I opened"), and the request's state is "waiting on you" even while helpers run, with "2 helpers still working" beside it.
  It clears on the next prompt, as today.
  The top bar pill, the rail, the brief ("Where it stands" leads with the ask), the track (the blocked task in amber with the needs-you mark), the flow card and the task page all agree.
  Amber stays reserved for "needs you".
- **What each running helper is doing now.**
  The top bar's NOW line already shows helper actions ("Reshoot scene 3", "Fix crypto strip cell formatting") with no owner; say whose ("Scenes 3, 5, 6, 7: Reshoot scene 3").
  On the Helpers tab and the Story side card, a running helper shows its latest action and how many files it has written so far.
- **A blocked task's page** says "Waiting on you" with the ask, when it was asked, and a link to Claude's message; no "Failed", no "Not started".

## How to fix (decide the details yourself; keep it simple)

- `blocked` becomes its own task status in core (`TaskView.status` gains `"blocked"`; read the type's doc comments and update them), shown as needs-you everywhere a status is drawn; a phase's status is derived from its tasks when they say more than the map does (any done and any not done: in progress; all done: done; a blocked task: waiting).
- Helper to task: when a helper starts with no part, match it to a plan task or part by the words Claude used (the helper's description against task and part titles, numbers like "1, 2, 4" against "1-4"), and mark the matched tasks running; when nothing matches, the helper stands on its own.
  Keep it deterministic and tested; never guess when two tasks match equally.
- Story grouping uses the part or task a message is about when known, else the time order, not the live phase.

## Quality bar

Run the dump script the author keeps locally: from `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/data`, `node --import ./reg.mjs dump.mts c8e82aaf-dde0-4714-802b-38b5dd45fe83 <your scratch dir>` (write only to your scratch folder; never copy its output or any Tradara text into the repo; tests use made-up fixtures shaped like it).
List, before and after: request 7's phase and task statuses, each helper's task, each file's task, `needsYou`, and the request state.
Screenshots of request 7 at 2560 × 1440 and 390 × 844: the request page (brief, track, Story), the Flow tab, the Helpers tab, the ElevenLabs task page, and the session journey; also check the 44-request session `8af212b5-3fb0-4f7c-8d39-20ac4bde9088` still reads right (no request newly waiting that was not).
Body text 15 px or more, nothing under 13 px, 4.5:1 contrast, nothing overlapping, no empty section.

## Tests (test first)

`blocked` as its own status through core and every place the web draws a status; phase status from tasks; needs-you after Stop with a blocked task or an ask in Claude's last message, while helpers run, cleared by the next prompt, and not raised by an ordinary end of turn; helper-to-task matching (match, no match, two equal matches); helper files to the helper's task; Story grouping by part; a finished helper's result line; zero tiles hidden.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
Rebuild and commit `plugin/dist` if core changes reach it (CI checks it).
See your build with `npx vite --port 5198 --strictPort` in your worktree's `web` folder (it proxies to the author's server on 8787; never restart, change or write to that server); your own headless Chrome through a Playwright script; open `http://localhost:5198/auth/dev?login=Sarthak` first.
Save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/live-*.png`.
Branch `fix/live-state` from `origin/main`; copy this brief in and write `2026-11-10-murmur-live-state-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
Another builder is working in parallel on branch `feat/tasks-list` (a Tasks tab, captions on every track station, the task page's Previous/Next row, a not-started task's page; files `web/src/live/Track.tsx`, `web/src/live/Tabs.tsx`, `web/src/router.ts`, `web/src/part/PartDetail.tsx`, a new tasks list component).
You own `packages/core` and the plugin; in `web/src` keep your changes to what drawing `blocked`, needs-you and the helper lines requires, and before opening your PR merge `origin/feat/tasks-list` if it exists (check with `git ls-remote origin feat/tasks-list`) and resolve conflicts so both changes stand.
