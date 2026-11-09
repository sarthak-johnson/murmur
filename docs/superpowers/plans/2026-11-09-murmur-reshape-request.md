# Murmur reshape, phase 2: the request page (brief, phase track, story, side column)

Approved by the author on 9 Nov 2026 as part of the reshape.
His words this answers: "in each request, catch user attention, its easy for them to read summary of stuff that is going on, but just not plaintext right, more detailed but also organized".
Built on top of the merged shell (PR #19: rail, breadcrumb, top bar, tabs) and the merged core logic (PR #18: `state`, `outcome`, `waiting`, `beyond`, `helperCounts`, `sentBack`, `MessageView.phase`, helper `role` and `round`, and `keyMoments` in `packages/core/src/view/moments.ts`); read `packages/core/src/view/types.ts` for the exact fields.

## Read first (local only, never commit them or copy their text into the repo)

- `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md`, section 3 (the request page) and section 6 (motion).
- The mocks: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/02-request-running.html` (running, with Beyond the plan and waiting on you) and `03-request-finished.html` (finished), PNGs beside them.

## What to build (web only)

1. **The brief**, a card under the request title and tabs:
   - Where it stands: `request.outcome` (and the live edge for a running request: the running helpers' descriptions, or what was left open).
   - Key moments: `keyMoments(request, lastLooked)`, each a row with time, mark (shape and colour), one line, task chip; items with `new` carry a blue dot and the heading reads "3 new since 20:31". This replaces the separate "Since you last looked" block, remove it.
   - By the numbers: elapsed, helpers (with running count), files with +/-, fix rounds; tabular numerals, no jitter on live updates.
   - Waiting on you, amber, only when `request.waiting` is set: the questions and "Answer in the terminal".
2. **The phase track**, replacing the in-page phase bar and today's left plan column:
   phases as horizontal segments, tasks as stations (links to the task page), captions under the first, the live and the last station; done phases green with filled checks, the live phase fills, todo grey with hollow rings, failed red cross.
   A dashed blue "Beyond the plan" segment when `request.beyond` is set.
   Foot line: "Plan: 4 of 4 done · Still working: 1 helper running, 2 fix rounds after the plan · Elapsed: 17 min" (only the clauses that apply).
   It draws left to right once on first paint (900 ms, `scaleX`, reduced motion static); a phase that completes while open fills over 600 ms.
   Under 900 px it becomes a vertical list of phases with their task stations.
   Remove `PlanColumn` and its tests' coverage moves to the track.
3. **The story**, grouped by `MessageView.phase`, then a "Beyond the plan" section from `beyond.messages`:
   a finished phase reads oldest first, the live section newest first with a "now" row for helpers that have not reported yet.
   Consecutive messages about the same task fold into one row ("Task 2 · HeroMoney · built, review found ..., fixed, passed · 5 min · 3 helpers · 7 messages") that opens in place; messages that stand alone are decisions, problems found and phase finished.
   New messages slide down 8 px and fade in once (180 ms) on mount only; the story never reorders what is above the reader.
   The fold applies to task runs; a single message under 6 lines never shows "Show more".
4. **The side column** (sticky at 1200 px and up, below the story under that): Helpers (one line each with a mini bar on a shared clock, running ones pulse only if no other pulse is on screen, else a static blue mark), Files (grouped by task, top five, "n more" opens the Files tab), Checked (pass, fail, untried).

## Quality bar

Same as the shell: screenshots of the real session at 1440 × 900, 1280 × 800, 1024 × 768 and 390 × 844 compared with the mocks; body text 15 px or more, nothing under 13 px, every text colour 4.5:1 or more, no horizontal scroll, no empty section drawn, live updates never move what is on screen above the new item.
Check request 13 (running or newest, with beyond), request 7 (big, finished, narrated), request 9 (huge, thin data) and a short session (`/s/523ef14d-ed00-4cdd-a218-967304e9d185`).

## Tests (test first)

Brief (each row hidden when empty, new markers, waiting only when set), track (states, beyond segment, foot clauses, links, vertical under 900 px), story (grouping by phase, beyond section, folding task runs, order rules, no "Show more" on short messages), side column.

## Checks, verification and git

As in the shell brief: the five checks, each exit code on its own; own `pnpm install --frozen-lockfile`; Vite on port 5191 against 8787 for screenshots saved under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/request-*.png`.
Branch `feat/reshape-request`; copy this brief in and write `2026-11-09-murmur-reshape-request-report.md` beside it; commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
Two other builders work in parallel: one on the task page (`web/src/part/*`, branch `feat/reshape-task`) and one on the flow board (`web/src/map/*` or `web/src/flow/*`, branch `feat/reshape-flow`, which also removes the old map's import from the request page). Stay in the request page files; in `theme.css` add your rules in one block under a `/* Request page (reshape) */` comment and delete the rules of what you remove.
