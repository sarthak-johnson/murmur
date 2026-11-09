# Murmur reshape, phase 2: report

Branch `feat/reshape-request`, web only (`web/src`, `web/test`).
`packages/core` is untouched: every field the screens needed was already right.

## What was built

### The brief (`web/src/live/Brief.tsx`)

- A card under the title with up to three cells and a foot row, each drawn only when it has something to say.
- Where it stands: `request.outcome` large, then the live edge in one line ("Still running: Build Task 38: capture chat reads."), or what was left open once the request is over.
- Once over, the cell reads "What came out of it", as in mock 03.
- Key moments: `keyMoments(request, lastLooked)`, each a row with its time, a mark (check, red cross, grey "!" for fixing, hollow ring for a decision, blue ring for "plan done"), the line, a task chip on its own line, and a blue dot when it is new.
- The heading carries "2 new since 20:31" when anything is new.
- The separate "Since you last looked" box and its frozen catch-up state are gone, along with `catchUpBrief`, `briefLead` and the `viewAt` view-at-a-time path that only fed it.
- By the numbers: elapsed (or "from ask to last word" once done), helpers with the running count (or by role once done), files with lines added and removed, fix rounds with how many tasks they were on; tabular numerals, zero figures hidden.
- Waiting on you: amber, only while Claude waits; the questions (with their options), else core's `request.waiting`, else Claude Code's own text, pending risky commands, the time since, and "Answer in the terminal".
- While Claude waits, the elapsed clock stops at its last word.

### The phase track (`web/src/live/Track.tsx`)

- Phases as segments sized by their task count, tasks as stations that link to the task page.
- Done phases are green lines with filled checks, the live phase fills as far as its tasks are done, todo is grey with hollow rings, a failed task is a red cross, unfinished work in a finished request is a hollow ring that says "left open".
- Captions sit under the first, the live and the last station of each segment, each in the room between its neighbours, so they never collide; every station keeps its name for screen readers.
- A dashed blue "Beyond the plan" segment, with one station per helper after the plan, when `request.beyond` is set.
- The foot line: "Plan: 4 of 4 done · Still working: 1 helper running, 1 fix round after the plan · Elapsed: 17 m", only the clauses that apply ("Left open" and "Took" once over).
- It draws left to right once on first paint (900 ms `scaleX`), the live phase's fill eases over 600 ms when a task completes, and it is static under reduced motion.
- Under 900 px the same list reads top to bottom, every station named.
- `PlanColumn` is gone; its tests moved to the track and the side column.

### The story (`web/src/live/Story.tsx`)

- Grouped by `MessageView.phase`, in plan order, then a "Beyond the plan" section from `beyond.messages`.
- Each section head has the phase name, its state word and mark, its time span, done count and message count.
- A finished section reads oldest first; the live section reads newest first under a "now" row for each helper that has not reported yet.
- Every message about a task folds into that task's row, its problems found, fixes and decisions included; the row says what happened in order ("Task 2 · HeroMoney · built, review found the decimal point misaligned, fixed, passed · 6 m · 3 helpers · 8 messages"), with a Problem found badge when one was found, and opens in place.
- A message's task is the one core tied it to, else the tasks its first sentence names ("Task 2", "Tasks 4 and 5", "Bug B1"), else its helper's task; a message that names nothing carries on the task before it.
- Only messages about no task stand alone: the opening lines, a phase finished, a plan change.
- Once a section is over, each task's messages gather in one row at its first message; the live section folds consecutive runs only, so a new message never moves an older row, and its newest run is open (it stays open while the section is live, folds once it is over, and the reader's own toggle always wins).
- Request 7's story went from 8,395 px to 2,015 px at 1440, request 8's from 8,955 to 1,483 and request 9's from 21,961 to 3,212.
- New messages slide down 8 px and fade in once (180 ms) on mount; rows are keyed by their oldest message, so nothing above the reader is rebuilt or reordered.
- A message folds only past 8 lines, so one under 6 lines never shows "Show more".
- Badges are 13 px tinted words (Done, Problem found, Fixing, Decision); Fixing stays grey so amber means "needs you" only.

### The side column (`web/src/live/Side.tsx`)

- Helpers: one line each with a mini bar on the request's shared clock; a running one shows its model ("Opus · running 16 m · no report yet").
- Over 8 helpers they are counted by role ("11 built", "10 reviewed") with "All 32 helpers" linking to the Helpers tab.
- The running mark pulses only under 900 px, where the rail's pulsing mark is off screen; elsewhere it is a static blue mark.
- Files: grouped by the task that changed them, the top five by lines changed, paths cut from the left so the file name stays in view, "n more" linking to the Files tab.
- Checked: every part's checks as pass, fail or not yet checked.
- Sticky from 1200 px, below the story under that; no card is drawn empty.

### Head and CSS

- The line over the title reads "Request 13 of 14 · asked Mon 9 Nov, 20:25 · narrated live" (or "recap by Claude", "plan inferred").
- The facts under the title: tasks, helpers, files, fix rounds (or sent back), commands.
- The in-page phase bar beside the facts is gone; the track replaces it.
- `theme.css`: one block under `/* Request page (reshape) */`; the rules of the plan column, the progress bar, the catch-up box, needs your call and the old story are deleted.

## Tests

- New `web/test/request.test.tsx` (26 tests): the brief (each cell hidden when empty, new markers and count, numbers and zero rows, waiting only when set and its stopped clock, core's questions), the track (states, fill, captions, beyond segment, foot clauses, links, no track without a plan, the vertical rule under 900 px and the draw and reduced-motion rules), the story (phase grouping, beyond section, order rules, folding and opening runs, decisions standing alone, no "Show more" on short messages, existing rows kept on live updates) and the side column (helpers on a shared clock, by role past 8, top five files and the rest, checks, empty cards).
- Tests of the plan column, the progress bar, the catch-up box and needs your call were rewritten against the track, the brief and the side column rather than dropped.
- One test was removed: hovering a plan task highlighted its map part, and the map now lives on its own tab.

## Checks

- `pnpm -s lint`: exit 0, no warnings.
- `pnpm -s typecheck`: exit 0.
- `pnpm -s test`: exit 0 (web 335, core 295, server 208, plugin 129).
- `pnpm -s build:plugin`: exit 0.
- `pnpm --filter @murmur/web -s build`: exit 0.

## Screens checked

Vite on 5191 against the server on 8787, at 1440 × 900, 1280 × 800, 1024 × 768 and 390 × 844, no horizontal scroll on any.
Request 13 is drawn as it stood at 15:13 UTC on 9 Nov (the saved events served up to that time), because it has since finished and core no longer gives it a `beyond`; that is the state mock 02 shows.
Also checked: request 7 (finished, recapped), request 9 (huge, thin data), request 14 (newest, running) and a session waiting on the user.
Every text colour used is 5:1 or more on its surface; nothing is under 13 px.

## Decided differently, and why

- Fixing is grey, not the mock's amber: the theme keeps amber for "needs you" alone, and the existing badges already did so.
- "Held until Task 38 finishes" and "Needed your call · answered in request 8" from the mocks are not drawn: nothing in the view says what blocks on what or which later request answered a question.
- Key moments come from core's `keyMoments`, so their wording is core's ("The plan is done; work goes on beyond it").
- The track's phase names are not links; the breadcrumb's phase link already lands on the phase's part of the story.
- Durations use the app's format ("17 m", "3 h 05 m") everywhere but the large elapsed figure, which reads "17 min" as in the mock.
- A long message folds after 8 lines rather than 6, so a message that only just runs over does not hide one line behind "Show more".
- `PlanColumn.tsx` keeps only `Glyph` and `PlanSource`, and `catchup.ts` only `list`, `few` and `cutWords`, because the task page imports them; they can move once the task-page branch lands.

## Could not match

- The short session named in the brief (`523ef14d-...`) is not on the local server (404), so a 36-request session waiting on the user stood in for the thin case.
