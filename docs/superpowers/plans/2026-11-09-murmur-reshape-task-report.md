# Murmur reshape, phase 3: report

Branch `feat/reshape-task`, based on `origin/main` after PR #19.

## What changed

### The task page (`web/src/part/*`)

- The title line carries the outcome word from status and core's `rounds` ("Done after one fix round").
- The chips row holds "Task n of N", the phase, and the plan's source ("Recap by Claude", "inferred"), which used to sit inside the title.
- The facts row reads core's `span`, with how long it took, and names the day on both ends when it ran past midnight.
- The band names at most three commits and counts the rest; all of them are in its tooltip.
- Claude's own aim shows no source line.
- An aim read from the record says whose brief it came from ("From the builder's brief", "From the reviewer's brief", "From the planner's brief"), and its done-when says "read from how it ended".
- On a part core filled from the record, one quiet line sits under the facts: "Claude hasn't described this task itself. This page is read from its helpers, files and messages."
- A nav row under the facts: back to the request, "Flow: n parts use this" (or "Flow: uses n parts") linking to the flow tab with `?part=<id>`, and the previous and next task in the plan's order.
- Previous and next repeat at the foot of the page.
- "How it went" is one panel: heading, round markers, lanes, Claude's lane, then the time axis at the foot.
- Round markers ("Round 1 · build and review", "Round 2 · fix and recheck") come from each helper's `round`; a builder resumed after a review counts as a fix in the next round.
- Markers are drawn only when the helpers share one subject and took more than one round.
- A marker that starts too near the end puts its words before its line.
- Lanes are named by role ("Builder", "Reviewer", "Recheck") with "Agent n · Model" under it.
- Past ten helpers the lanes merge into one per role ("Builders, 18 helpers"), and a merged bar is counted ("17 rechecks") and coloured only when its runs agree.
- Claude's messages about the task are dots on Claude's lane: red for a problem found, green for the closing word on a done task, a ring otherwise.
- Core's verdict from the record ("Sent back", "Passed") wins over the timeline's own guess, on the bar and on the step.
- Steps read "who · model · when · badge", then the one-line fact, then Claude's words, then "Helper's report" and "Brief".
- Claude's own steps read "Claude · time", and the last one on a done task carries "Done" and Claude's closing words.
- A step drawn from a message a helper card already shows is dropped, and a message step has no Details button.
- Left open (with its count), Checked, Choices and Words used here are quiet cards in the margin.
- Files sit in cards as wide as their paths; role names get a capital and lose a closing stop; inferred "tests" join the Tests card (this also fixed a duplicate React key).
- Every section, the nav, the flow link, the rounds and the inferred line are left out when they would be empty.

### Theme

All rules are in one block at the end of `web/src/theme.css` under `/* Task page (reshape) */`, scoped to `.pd` where they override older rules.
Nothing on the task page is under 13 px, open panels included.

### Core fix (`packages/core/src/view/agents.ts`)

A helper whose description names a task ("Review Task 38") now joins that task and its part, and never the one of another task Claude happened to be on when it started.
Before, Task 39's page in request 13 showed a Task 38 reviewer and a Task 43 builder as its own helpers, and missed the Task 39 reviewer.
Tested in `packages/core/test/agents.test.ts`.
`plugin/dist/hook.cjs` is rebuilt from it by `pnpm build:plugin`.

### Wiring

`web/src/pages/Session.tsx` passes `sessionId` and the request's number to the task page.

## Checks

Each run on its own, each exit 0: `pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`.

## Screenshots

Under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/`, at 1440, 1280 and 390 px wide:
`task-tokens-*.png` (request 7, Lit plate tokens), `task-t39-*.png` (request 13, Task 39), `task-r9build-*.png` and `task-r9plan-*.png` (request 9, its biggest and thinnest parts).
No page scrolls sideways at any of the three widths.

## Different from the mocks, and why

- Time spans read "6 m" and "3 h 06 m", as everywhere else in the app, not the mock's "6 min".
- Steps name the helper as "Agent n", matching its lane, rather than "the Sonnet builder"; with 57 helpers on one task the number is what tells them apart.
- The mock's "4 files" link per step, "What review caught" card and "3,612 tests pass" fact need data core does not give per helper yet, so they are not drawn.
- A recap's rounds have no step for the builder's resumed fix run, so Lit plate tokens shows four steps where the mock shows five.
- Task 39's timeline has no builder lane: both its fix rounds were sent by message to the builder request 12 started, and a helper's lane shows only in the request it started in.
  Its title and band still say "two fix rounds", as Claude wrote: a fix sent by message to an earlier request's builder counts in the request that sent it (review fix, below).
- On a phone the timeline keeps its own sideways scroll inside its panel, as before.

## Review fixes

- Rounds: a builder resumed by message (SendMessage) with a fix ("Task 39 fix round 2: ...", "Task review found issues. Fix these") is a fix round, counted in the request that sent it.
  Follow-ups, notes and restarts after a stop are not, and neither is a message about another task.
  On the real session this changes only Task 39 in request 13 (one fix round to two) and Task 41 in request 12 (none to one, now in `sentBack`).
- A helper named for a pair of tasks ("Review Tasks 13-14") joins the one of them Claude was on, as before PR #21, instead of none.
- A timeline bar too narrow for the plan's words, with no room beside it, shows its short name ("Built") instead of nothing.
- With more than ten helpers the timeline's note says "one lane per role".
- The timeline's note wraps as one block under its heading on a phone.
