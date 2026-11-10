# Murmur: a list of tasks, every task named on the track, no doubled buttons (web)

Asked for by the author on 10 Nov 2026, looking at request 7 of his live session `c8e82aaf-dde0-4714-802b-38b5dd45fe83` (8 tasks in 3 phases: Mockup, Voice, Video).
His words, on three screenshots: "Duplicate" (the task page), "Not all tasks are labeled" (the phase track), and "There also should be a place where I can see list of tasks directly".

## What is wrong today

1. **Doubled Next button.**
   On `/s/c8e82aaf-dde0-4714-802b-38b5dd45fe83/r/3d05d8cf-d182-46cf-b6eb-6ec4441ecf7d/p/audit` (task 1, not started, not described), the page shows "Next: Task 2 · Player shell with seekable timeline →" twice, about 90 px apart, with only a rule between them.
   `web/src/part/PartDetail.tsx` draws the Previous/Next pair in the top nav and again in the foot nav (`pd-nav foot`) whenever there is a previous or next task, even when nothing sits between them.
2. **Most tasks have no name on the track.**
   `captions()` in `web/src/live/Track.tsx` names only the first, the live and the last station of each phase; on request 7 the Mockup phase shows 5 dots and 2 names, and the live one's name shows only as a hover tooltip.
3. **No list of tasks.**
   The only way to see a request's tasks is the track's dots, one task page at a time, or Previous/Next.
4. **A task that has not started is an empty page.**
   Title, "Not started", "Claude has not described this part yet.", a button row, and nothing else.
5. **Request 7's Story tab is empty.**
   On `/s/c8e82aaf-dde0-4714-802b-38b5dd45fe83/r/3d05d8cf-d182-46cf-b6eb-6ec4441ecf7d` (running, narrated live, 8 tasks, 2 files, 15 commands) the Story tab shows only the Files card on the right and nothing in the main column.
   Reproduce it first, find why (look at the request's view with the dump script below), and fix the cause; a running request always has something to say (what Claude is on now, its plan, what it has done so far).

## What to build

1. **Tasks tab.**
   The request tabs become `Story · Tasks · Flow · Files · Helpers`; `/s/:sid/r/:rid/tasks` is its own URL (`matchRoute`, `requestPath`, back and forward), a link with `aria-current` like the others.
   - One list grouped by phase, in the plan's order: a phase header with its title, "n of m done" and its time span, then its tasks.
   - Each task row: its number in the plan ("1"), the rail's state mark, the task's full title (never cut mid-word; wrap to two lines), one quiet line saying what it is for or how it ended (the part's aim or outcome, whichever fits its state; omit the line when there is neither), and a facts line ("2 helpers · 3 files · took 4 m", or "started 21:02" while running, nothing for a task not started).
   - The whole row opens the task page (the existing view transition morph from the row's title to the task title); the running task carries the page's one pulse; keyboard: rows are links in order.
   - Work after the plan ("Beyond the plan") is its own last group, its helpers as rows.
   - A request with no plan but with map parts lists its parts as tasks in one group; a request with neither has no Tasks tab.
   - Under 900 px the same list, full width.
2. **Every station named on the track.**
   Every task gets its caption under its dot, each in its own slot (the station's share of the phase's width), centred under its dot, wrapping to at most two lines, with an ellipsis only when two lines are not enough; the live one stays the bright one.
   At 2560, 1440 and 1280 px wide, no caption overlaps another and no caption is hidden.
   When a phase has more stations than fit at a readable width (under about 72 px per slot), the track drops to the stacked layout it already uses under 900 px (every station named) rather than hide names; decide this from measured width, not a guess at count.
3. **One Previous/Next row on a task page.**
   The foot nav shows only when the page has content between the top nav and the foot (how it went, helpers, files); a short page has one row.
4. **A task not started says what it will be.**
   Instead of only "Claude has not described this part yet.": where it sits in the plan ("Task 1 of 8, first in Mockup"), what comes before and after it by name, and, when the request is running, what Claude is on now (the live task, linked).
   Keep it to two or three quiet lines; no empty sections.

## Quality bar

Screenshots of request 7 of `c8e82aaf-dde0-4714-802b-38b5dd45fe83` (live, 8 tasks) and of a long finished request of `8af212b5-3fb0-4f7c-8d39-20ac4bde9088` with a plan (pick the one with the most tasks) at 2560 × 1300, 1440 × 900, 1280 × 800 and 390 × 844: the request's Story tab with the track, the Tasks tab, and task 1's page.
Body text 15 px or more, nothing under 13 px, 4.5:1 contrast, no horizontal page scroll, nothing overlapping, nothing cut mid-word, no empty section, no button drawn twice.
To look at a request's view as core builds it, run the dump script the author keeps locally: from `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/data`, `node --import ./reg.mjs dump.mts <session id> <your scratch dir>` (write only to your scratch folder; never copy its output or any Tradara text into the repo).

## Tests (test first)

Route and tab for `tasks`; the tab hidden when a request has no plan and no parts; grouping by phase in plan order, beyond-the-plan group, parts-as-tasks fallback; row content per state (done, running, not started, failed); one pulse; captions on every station with slot widths that never overlap; the stacked fallback when slots are too narrow; the task page's foot nav only with content between; the not-started task's lines; the Story tab cause you found.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
See your build with `npx vite --port 5199 --strictPort` in your worktree's `web` folder (it proxies to the author's server on 8787; never restart, change or write to that server), with your own headless Chrome through a Playwright script (`chromium.launch({ channel: "chrome", headless: true })`; the shared Playwright browser may be busy); open `http://localhost:5199/auth/dev?login=Sarthak` first.
Save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/tasks-*.png`.
Branch `feat/tasks-list` from `origin/main`; copy this brief in and write `2026-11-10-murmur-tasks-list-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
You own `web/src`; touch `packages/core` only if the Story cause is there, and say so in the report.
In `theme.css` add new rules in one block under a `/* Tasks list */` comment; change the track's existing rules in place.
