# Murmur reshape, phase 5: the session journey and the motion pass

Approved by the author on 9 Nov 2026 as part of the reshape.
His words this answers: "If you were to make it easy for user to understand, where this session started and where it went", and "I thought we could use some flows, with animations and stuff".
Core gives `SessionView.journey` (chapters, pauses, decisions, totals) and per request `short`, `state`, `outcome`, `tally`, `helperCounts`, `sentBack` (PR #18); read `packages/core/src/view/types.ts` and `journey.ts`.
The rail, top bar, request page, task page and flow board are merged; this phase takes over `/s/:sid`, which today shows the newest request in place.

## Read first (local only, never commit them or copy their text into the repo)

- `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md`, section 2 (the journey) and section 6 (motion, the full table).
- The mocks: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/01-session-journey.html` and `07-navigation.html` (an animated prototype of the shared-element transitions; frames `07-navigation-f1.png` to `f8.png`).
- `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/03-motion.md`.

## What to build (web, plus core only where the journey data is wrong)

1. **From here to here.** Two cards joined by a line: the first prompt as typed (with its day and time, and its kind) and the current state (the live or last request's `outcome`, its time, its state, and "n things wait on you" in amber only when real). Each card links to its request.
2. **Totals.** Helpers, files, commands, tasks sent back, pauses, as large figures with tabular numerals.
3. **Chapters.** A segmented strip, one segment per chapter sized by its request count, the live chapter lit; each segment labelled with its title and request range; clicking scrolls to that chapter on the line.
4. **The line.** A vertical metro line; each request a station card: kind chip, full title, `outcome`, four figures (took, helpers, files, tasks) and a thin load bar proportional to helper count; state mark on the line in the rail's shapes and colours.
   Chapter headers sit on the line.
   Pauses sit between stations as dashed beats ("3 days away. Nothing ran between Mon 2 Nov 21:01 and Fri 6 Nov 15:20"); pauses inside a request sit on its card as one quiet line.
   Decisions sit between stations as pills ("You approved the plan", Claude's decision sentence).
   A running request's station carries the one pulse (the rail's dot does not pulse on the journey page so only one thing pulses).
5. **Session title.** The rail and the breadcrumb show the first prompt today; use `journey` to name the session better if core can give a short name (the first chapter's title is not right; prefer a recap or narration `title` if present, else keep the first prompt cut at a word near 48 characters). Keep it honest, no invented names.
6. **Motion pass across the app**, following the proposal's table:
   - Station, rail row or track station to request or task: the clicked card or row morphs into the next page's title (View Transitions with matching `view-transition-name`s, 260 ms ease-out); back reverses it.
   - List entrances run once on load, never on live updates except for the new item.
   - One loop on screen at a time (the running mark, 2.4 s).
   - Under `prefers-reduced-motion`: 150 ms crossfades, rises become fades, the pulse a static ring.
   - Add a Playwright-free unit check where possible, and a short `web/test/motion.test.tsx` that the reduced-motion rules exist and that only one element carries the pulse class per page.
7. **Phone.** Under 900 px the two cards stack, the chapter strip scrolls horizontally inside itself, station cards go full width.

## Quality bar

Screenshots of the real session at 1440 × 900, 1280 × 800 and 390 × 844 compared with the mock (full page and first screen), plus three frames of a station-to-request transition.
Body text 15 px or more, nothing under 13 px, 4.5:1 contrast, no horizontal scroll, no empty section, nothing cut mid-word.

## Tests (test first)

From-here-to-here cards (amber only when waiting), totals, chapter strip (segments, live lit, scroll target), station cards, pauses between and inside, decisions, a single pulse per page, the session route showing the journey, reduced motion.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
See your build with `npx vite --port 5198 --strictPort` in your worktree's `web` folder (proxies to the author's server on 8787; never restart or change that server), using your own headless Chrome through Playwright scripts (the shared Playwright browser may be busy); open `http://localhost:5198/auth/dev?login=Sarthak` first, then `http://localhost:5198/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae`.
Save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/journey-*.png`.
Branch `feat/reshape-journey`; copy this brief in and write `2026-11-10-murmur-reshape-journey-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
