# Murmur redesign: report

Built on `feat/redesign` from the brief in `2026-11-07-murmur-redesign.md`: direction C's layout, direction A's colours, direction B's fonts and B's helper timeline on the task page.
Web only.
Core is unchanged, so `plugin/dist` did not change and needed no new commit.

## Commits

- `bb874f9` test(plugin): temp projects use the real path Claude Code reports.
- `7a1e89a` feat(web): the catch-up brief redesign, calm colours, Geist type.
- This report.

## What changed, by file

### New

- `web/src/session.ts`: plain readings for the frame, all from the view and its events.
  It decides where a request stands (running, waiting, done), what Claude waits on (an open `AskUserQuestion` call, a needs-you from Claude Code, or the questions in Claude's last message once it stopped), the now line, short task names ("Task 3: Reminder list" reads "Reminder list"), phase times, the live phase, a helper's model and a helper's runs of work.
  The now line never shows a raw shell command: a running Bash reads as its description, else "Running a command", and Claude's narrated now wins.
  The live phase is the running phase with the latest activity, because a plan often leaves an earlier phase marked running while the next one is under way.
- `web/src/catchup.ts`: "Since you last looked" as one sentence and up to five marked bullets, built by comparing the request at the last look with the request now.
  Bullets cover tasks done, problems found, work sent back to fix and helpers started; phases finished or started and questions waiting go in the sentence.
- `web/src/live/TopBar.tsx`: the bar pinned across the page.
  It holds Murmur, the request switcher ("Request 7 of 9", a menu that closes on Escape or a click outside), the Running, Waiting or Done pill, the now line with its details one click away, "Phase n of m" with a bar of tasks and n/m, and the amber "N questions for you" chip only while Claude waits on you.
- `web/src/live/PlanColumn.tsx`: the plan as a vertical timeline.
  Phases carry their done count and times, tasks their marks, the live phase its running helpers as cards (task, agent, model, running time, an identity hue rail that shimmers), and one glowing "you are here" dot.
  Phase titles link to their part of the story.
  The foot holds the connection state, the signed-in user, Settings, Sign out and Delete session.
- `web/src/live/Brief.tsx`: the catch-up block and "Needs your call" beside it, with the questions, how long Claude has waited, "Answer in the terminal" and when it asked; a pending risky command shows there too.
- `web/src/part/Timeline.tsx`: B's "How it went" timeline.
  One lane per helper and one for Claude share a time axis; each run is a bar named by what it was (Built, Fixed, Sent back, Passed, Running) and coloured by how it ended, and Claude's closing step ends its lane.
  A helper sent back to fix its work gets a second run, read from the `SendMessage` to it and its next report or stop.
- `web/test/redesign.test.tsx`: the tests listed under Tests.

### Changed

- `web/src/pages/Session.tsx`: the frame (bar, plan column, page) for both the request page and the task page.
  The request page has the title in Newsreader, a line of facts, the brief block, assumptions, the story or the map, and loose files.
  The catch-up is read once the stream is live and then kept still, so new work never moves the story under the reader.
- `web/src/live/Story.tsx`: the story is grouped under its phase; the phase where the work is reads newest first and sits on top, finished phases read oldest first.
  A message about no task stays with the phase it was written in.
  Claude's opening line is now the first beat of the story instead of its own block.
- `web/src/part/PartDetail.tsx`: breadcrumb, title with its outcome ("Done after one fix round"), aim and "Done when", facts (time span, helpers, fix rounds, files with + and −, commit), the timeline, then the numbered steps in Claude's words, each opening the helper's full report.
  A step's number is coloured by the timeline's verdict, and a helper step reads "Built by Agent 1".
  "Left open", "Checked", "Words used here" and "What goes in and out" sit in the margin; "Files, by what they do" groups files into cards by role, tests on their own, with the folder they share said once.
  An open diff takes the whole width.
- `web/src/files.tsx`: a path can drop a folder already named around it; `sharedFolder` finds it.
- `web/src/App.tsx`: the session, request and task routes all use the live frame, which brings its own bar; the account links move to the foot of the plan column.
- `web/src/theme.css`: A's warm grey ramp and text ladder as tokens, the older token names mapped onto them for the other pages.
  Colour only means a state: blue live, green done, red failed, amber only needs you; helpers use their own hues and "left open" is neutral.
  One glow, on the live phase.
  Nothing under 12 px; badges are quiet tints.
- `web/index.html`: Geist, Geist Mono and Newsreader from Google Fonts, with fallback stacks in the theme.
- `web/src/story.ts`: the Decision badge is neutral, not blue.
- `web/src/map/MapView.tsx`: label measurements match the 12 px floor.

### Removed

`web/src/live/PhaseStrip.tsx`, `PlanPanel.tsx`, `RequestList.tsx`, `NowCard.tsx` and `Notices.tsx`, replaced by the bar, the plan column and the brief block.

### Outside the web

`plugin/test/cli.test.ts` and `plugin/test/dist.test.ts` failed four tests on macOS before this work, on the untouched base commit too.
`murmur on` stores the real path, as Claude Code reports it, but the tests sent hooks the symlinked temp spelling (`/var` is `/private/var`).
The tests now use the real path; the plugin code is unchanged.

## Tests

New tests in `web/test/redesign.test.tsx`, all with made-up content (a garden planner):

- The bar while running, once done, waiting on two questions (count and wait), and with an answered question (no chip).
- The now line: a command's description, "Running a command" with the command behind Details, no raw command when its event is not loaded, the narrated now winning.
- The request switcher: its place, newest first, switching, closing on Escape.
- The plan column: phases with counts, times and short names, one you-are-here on the live phase, running helpers with task, agent, model and time, a finished request with work left open, a task opening its page and marked there, the live phase picked by latest activity, nothing reading as running once Claude stopped.
- The catch-up: one sentence and marked bullets from what happened since, hidden when nothing changed or on a first visit, still while new work arrives.
- Needs your call: an `AskUserQuestion` call's questions, else the questions of Claude's last message once it stopped, and not drawn when nobody waits.
- The story by phase, and the map one click away.
- The task page: title and outcome, lanes and axis, runs named and coloured by result, the step numbers' verdict, Claude's lane, files grouped by role, no timeline without helpers.

Most were written before the code and run against the old code in a scratch worktree: 25 of 28 failed on missing parts (no bar, no plan column, no timeline), and the 3 that passed check absence.
Four were added after the code: the live phase choice, the stopped plan, the step numbers' verdict and the still catch-up.

Existing tests were updated where the markup changed, keeping what they check: the phase strip became the plan column and the bar's progress, the request list became the switcher, the Now card became the now line and the plan's helper cards, the notice row became the needs panel, the summary band became the facts line with the pill in the bar, the opening line is the story's first beat, chips use short task names, "Checked so far" is "Checked", "Files changed" is "Files, by what they do", and the skeleton draws the same frame as the loaded page.
The folding of finished phases in the plan was dropped, as the mock lists every task; one stuck-flag test was dropped because the stuck task's problem now shows on its row in the plan, which another test covers.

## Checks

Each run on its own, after the last change:

| Check | Exit code |
|---|---|
| `pnpm -s lint` | 0 |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 (core 243, plugin 162, server 92, web 233 tests) |
| `pnpm -s build:plugin` | 0, `plugin/dist` unchanged |
| `pnpm --filter @murmur/web -s build` | 0 |

The paid e2e suite was not run.

## Screenshots against the mocks

Taken on the real session through the running :8787 server, signed in with the dev login, into `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/`.
A last look of 16:16 on 6 Nov was set before each load, as in mock C.

| Screen | 1440 × 900 | 1280 × 800 | Mock |
|---|---|---|---|
| Request "Restyle the logged-in app…" | `redesign-request-1440.png` | `redesign-request-1280.png` | `c-request.png` |
| Task "Lit plate tokens" | `redesign-task-1440.png`, `redesign-task-files-1440.png` | `redesign-task-1280.png` | `c-task.png`, `b-task.png` |
| Short session | `redesign-short-1440.png` | `redesign-short-1280.png` | |
| Latest request of the long session | `redesign-live-1440.png` | `redesign-live-1280.png` | |
| Request switcher open | `redesign-switcher-1440.png` | | `b-request.png` |
| Request at phone width | `redesign-request-375.png` | | |

No page scrolls sideways at 1440, 1280 or 375.

The request page matches C's frame: the 60 px bar, the 312 px plan column with its spine, the title and facts, the brief box and the story under its phase heading, with the same spacing and type.
It differs where the data differs: that request is finished, so the bar says Done with what it did in all instead of Running and a now line, nothing waits on the user so there is no amber chip and no "Needs your call", and no helper runs so Phase 1 shows left open with no glow and no helper cards.
The catch-up lead reads "5 problems were found and 19 helpers started." rather than C's phase sentence, because a recapped plan has its final statuses from the start, so nothing in it "finished" after the last look.

The task page matches C's head (breadcrumb, Newsreader title with "Done after one fix round", aim, facts with the commit) and B's timeline closely: four lanes, Built and Fixed on the builder, Sent back on the reviewer, Passed on the recheck, and Claude's closing step with a check.
The steps below follow C, with step 2 red and step 3 green.
It differs in a "Recap by Claude" tag beside the title, the aim and "Done when" on two lines as in B, each step showing both the recap's line and Claude's message, and the margin also holding "Checked" and "Words used here".
Fixed while comparing: tick labels running past the box at 1280, the recap tag touching the title, colourless + and − counts in the facts, inline code breaking inside `--` names, tall empty file cards, a blue live dot on a request that had stopped, the story reading oldest first while running, and assumptions taking three tall cards.

## What is left

- The waiting state (amber chip, "Needs your call") and the plan's live helper cards could not be shown on the real session, because nothing was waiting or running when the screenshots were taken; tests cover both.
- File groups follow the role string core gives each file, which is often one role per file, so a task can get one card per file; C's named groups ("The tokens", "Theme switch") would need core or narration to name groups.
- Short task names drop the plan number ("Task 12"), as in the mock, while Claude's messages still say "Task 12"; the full title is the row's tooltip.
- The map lost the phase strip's phase highlight; hovering a task in the plan still highlights its part.
- The now line clamps to two lines, and the switcher's titles to three, with an ellipsis at the end.

## Review fixes

An Opus review of the build found five must-fix problems and thirteen smaller ones, all fixed in `45e5aac`.
Each logic fix has a test in `web/test/redesign.test.tsx` ("review fixes" blocks) or `web/test/map.test.tsx`, run red before the change: 21 of the new tests failed for the reason they name.
The running-helper and overlapping-runs timeline tests passed before the change and stay as cover.

### Must fix

1. False "needs you".
   `questionsIn` (`web/src/session.ts`) now reads only the end of Claude's last message: its last paragraph or a trailing list.
   It skips code spans, code blocks and links, treats headings and list items as sentence ends, keeps "v1.2" whole, and reads "Should I…? Or…?" as one question.
   It counts only questions put to the user ("Should I", "Do you", "May we", or any with "you").
   A question Claude answers in the next sentence does not count.
   The reviewer's link-and-code fixture now reads Done with no chip, and the heading fixture reads "1 question for you" with the whole either-or.
2. The catch-up on reconnect.
   It is built the first time the stream is live, kept in state, and rebuilt only when the last look changes (`web/src/pages/Session.tsx`).
   The past view is reduced once there, not on every batch.
3. The plan jumping.
   Every task of the live phase is now a card on one line, busy or not, so a helper starting or ending changes words, not boxes (`web/src/live/PlanColumn.tsx`).
   A second helper on a task reads "+1", and times under a minute read "<1 m".
   On the reviewer's running fixture, the plan's rows sat at the same heights (120, 173, 199, 243, 298, 370) before a helper started, while it ran and after it stopped.
4. Sideways scroll at 375 px.
   The 900 px query now uses `.bar > .cell.now-cell`; every page and fixture measured no wider than the window at 375 and 1440.
5. Keyboard order.
   "Skip to the content" is the bar's first stop, aimed at `<main id="main">`; the story's "Skip to the plan" is gone.

### Minor

6. A finished request never says helpers are still running.
7. The story gets the computed `done`, so a request Claude stopped on reads oldest first.
8. The Story or Map choice lives above the request and in local storage, so it stays when you switch requests; the facts row keeps the toggle's height.
9. Timeline bars sit at their true width (at least a 4 px sliver); a label that does not fit sits beside the bar, before it near the end of the axis.
10. A helper's first bar is named in the plan's words when they fit ("Builder added the tokens, Tailwind…"), else by its short name; ticks name the day when the axis crosses midnight.
11. At 375 px lane names put the role under the name.
12. A long file name wraps its counts under it; no file card overflows at 1280.
13. "2 sent back for fixes"; names with an "and" of their own are joined with semicolons; a text with no spaces is cut at its length; the catch-up's "questions waiting" part is worked out live, so it drops once they are answered.
14. An open `AskUserQuestion` reads "Asking you 2 questions"; the now details close on Escape or a click outside, like the request switcher.
15. "Answer in the terminal" is a note, not a button.
16. Map labels end at a word (only a single long word is cut inside), and the width estimate is set for Geist, so labels fit their boxes.
17. Covered by 2.
18. Timeline tests: a running helper, ten seconds and five hours, past midnight, overlapping helpers, a label wider than its bar, and a bar named by the plan.

### Checks after the fixes

| Check | Exit code |
|---|---|
| `pnpm -s lint` | 0 |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 (core 243, plugin 162, server 92, web 258 tests) |
| `pnpm -s build:plugin` | 0, `plugin/dist` unchanged |
| `pnpm --filter @murmur/web -s build` | 0 |

### Screenshots

In `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/`, at 1440 × 900 and 375 × 812:

- Real pages: `redesign2-request-*.png`, `redesign2-task-*.png`, `redesign2-short-*.png`, plus `redesign2-task-timeline-1280.png` and `redesign2-task-timeline-375.png`.
- The reviewer's fixtures from `/tmp/mrv/fx.js`: `redesign2-fx-url-*.png` (no false amber), `redesign2-fx-msg-*.png` (one whole question), `redesign2-fx-ask-*.png` (the waiting state, "Asking you 2 questions", no sideways scroll at 375), `redesign2-fx-run-*.png`, `redesign2-fx-inf-*.png`.
- `redesign2-helper-start-1440.png`: a helper started on the running fixture, the plan unmoved.

### Still open

- A helper on no task still adds a card at the end of the live phase; that is rare, and only the rows below it move.
- Bar label widths are estimated from character counts against the measured track, so a label can sit beside a bar it would just fit.
