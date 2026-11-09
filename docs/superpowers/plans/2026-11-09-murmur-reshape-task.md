# Murmur reshape, phase 3: a full task page for every task

Approved by the author on 9 Nov 2026 as part of the reshape.
His words this answers: "one phase when I clicked has nothing to describe for, other live tracker one is not looking like the other one that is fully described".
Core already fills the data (merged in PR #18): `PartView.inferred`, `aim.inferred`, `span`, `rounds`, inferred steps ("Built", "Reviewed", "Sent back", "Fixed", "Passed"), `FileTouch.role` / `roleInferred`, and on helpers `role`, `subject`, `round`; read `packages/core/src/view/types.ts`.
The shell (rail, top bar with breadcrumb) is merged in PR #19.

## Read first (local only, never commit them or copy their text into the repo)

- `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md`, section 5 (the task page) and section 6 (motion).
- The mocks: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/05-task.html` (a described task, Task 1 Lit plate tokens) and `06-task-thin.html` (Task 39, never described by Claude), PNGs beside them.

## What to build (web only: `web/src/part/*` and the theme)

1. Title line with the outcome word: "Lit plate tokens · Done after one fix round" (from status and `rounds`), chips "Task 1 of 13" and "Phase 0: foundation", the facts row (time span from `span`, helpers, files with +/-, commit).
2. Aim and done-when; when `aim.inferred`, a small source line ("From the reviewer's brief" / "read from how it ended").
3. "How it went": keep the lane timeline and add round markers above it ("Round 1 · build and review", "Round 2 · fix and recheck") from helper `round`, and Claude's messages about the task as dots on Claude's lane; short bars carry their label outside the bar.
4. Steps read "who · when · badge", then the one-line fact, then Claude's words at that moment, then links to the helper's report and brief.
5. Left open, Checked, Files by role (inferred roles shown the same, no extra noise).
6. When `part.inferred`: one quiet line under the facts, "Claude hasn't described this task itself. This page is read from its helpers, files and messages." Nothing else about the page is thinner; no section that would be empty is drawn.
7. Previous and next task buttons at the foot (within the request's plan order), and "Flow: n parts use this" linking to `/flow` with the part selected (`?part=<id>`; the flow builder reads that parameter).

## Quality bar

Screenshots of the real session at 1440 × 900, 1280 × 800 and 390 × 844, compared with the mocks: request 7's "Lit plate tokens", request 13's Task 39 (or the newest request's thinnest task), and two parts of request 9 (huge, thin data).
Body text 15 px or more, nothing under 13 px, 4.5:1 contrast, no horizontal scroll, nothing cut mid-word, no empty section.

## Tests (test first)

Outcome word from status and rounds, round markers, Claude's dots, the inferred line only when inferred, the aim source line, previous and next, the flow link, every section hidden when empty.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
See your build with `npx vite --port 5193 --strictPort` in your worktree's `web` folder (proxies to the author's server on 8787; never restart or change that server); open `http://localhost:5193/auth/dev?login=Sarthak` first, then `http://localhost:5193/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae`.
Save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/task-*.png`.
Branch `feat/reshape-task`; copy this brief in and write `2026-11-09-murmur-reshape-task-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
Two other builders work in parallel: one on the request page (`web/src/live/*`, branch `feat/reshape-request`) and one on the flow board (`web/src/map/*`, branch `feat/reshape-flow`). Stay in `web/src/part/*`; in `theme.css` add your rules in one block under a `/* Task page (reshape) */` comment so merges stay simple.
