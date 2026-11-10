# Murmur: the session flow, a flow for every request, honest labels (web)

Asked for by the author on 10 Nov 2026, looking at his own 44-request session.
His words: "also there exists no flow of the whole session, I thought we were also making it", "Also no flow in the first request I see", and of the kind chip on a request whose prompt was "yes": "I think its kinda nonsense just showing this as a feature or request right".
A second builder fills the data in core and the plugin in parallel (branch `feat/titles-threads`): Claude-written titles, storylines (threads) and `follows`.
The fields are in `packages/core/src/view/types.ts` since PR #26: `SessionView.threads` (`Thread`) and `titledBy`, `RequestView.activity`, `thread` and `follows`; read their doc comments, they are the contract.
Until that branch lands, `threads` and `activity` are unset on real data: build against fixtures in tests, and merge `origin/feat/titles-threads` into your branch for real-data screenshots once it has been pushed (check with `git ls-remote origin feat/titles-threads`); never edit `packages/core` or `plugin` yourself.

## Read first

- `web/src/flow/*` (the request flow board: bands, longest-path layering, uniform cards, selection, links), `web/src/live/Journey.tsx` (the session journey), `web/src/pages/Session.tsx` and `web/src/router.ts` (routes, tabs), `web/src/theme.css` (tokens; wide screens since PR #25: `--content`, `--content-wide`, `--side`, `--reading`).
- The reshape proposal for the visual language: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md` sections 2, 4 and 6, and mock `04-flow.html` (local only, never commit them or copy their text into the repo).

## What to build

1. **Session tabs.** Under the session title on `/s/:sid`, a tab row `Journey · Flow` styled like the request tabs; `/s/:sid` stays the journey, `/s/:sid/flow` is the session flow; `matchRoute` handles it, a tab is a link with `aria-current`, back and forward work.
2. **The session flow: storylines as swimlanes, time running down.**
   - One column per thread, in order of first request; a sticky header per column: thread title, "n requests", span, state mark; when threads are `inferred`, one quiet line above the board: "Grouped by Murmur; Claude has not named these storylines yet."
   - One row per request in time order; each request is a card in its thread's column: number, `short`, one line of `outcome`, state mark (the rail's shapes and colours), and "took · helpers · files"; consecutive requests in one thread are joined by its lane line.
   - `follows` draws a link from the earlier request's card to the later one when it crosses threads or skips requests; links route in the gaps between cards, never across a card.
   - Long pauses from `journey.pauses` between requests are full-width dashed rules with their words ("3 days away"); a time gutter on the left shows the day and time where they change.
   - Selecting a card (click, arrow keys, Enter opens the request) lights its thread and its `follows` chain and dims the rest to 42 percent; Escape clears; `?r=<request id>` selects on load.
   - The running request carries the one pulse on the page.
   - Size: it fills the content column; many threads scroll sideways inside the board's own frame, never the page; under 900 px it becomes one list in time order where each card carries its thread as a chip and "picks up from 12" for `follows`.
   - Rows stay compact: a card is as tall as its text, rows of different threads may share a band when they do not overlap in time only if the order still reads top to bottom; keep it simple and readable on the 44-request session.
3. **A flow for every request.**
   When a request has no parts, its Flow tab draws a short step flow instead of an empty board: "You asked" (the prompt, cleaned: `<pasted_content ...>` blocks shown as "(pasted text)", `[Image #n]` as "(image)"), "Claude looked" (reads, searches, web from `activity`), "Claude did" (files changed with names, commands, helpers), "Ended" (`outcome`), joined left to right (stacked under 900 px).
   Draw only the steps that have something; a request with only a reply draws "You asked" and "Ended".
4. **Honest labels.**
   Show the kind chip ("Feature", "Question") only when `kindInferred` is false, on the journey's station cards, the request header and anywhere else it appears.
   Wherever a prompt is shown as text (the journey's "Where it started" card, a request's prompt), show pasted blocks and image markers the same cleaned way.
5. **Motion** as in the proposal: selection restrokes in 200 ms, a card click morphs into the request title (the existing view transition names), reduced motion instant.

## Quality bar

Screenshots of the real session `8af212b5-3fb0-4f7c-8d39-20ac4bde9088` (44 requests) and `27a000a1-7dbc-4dd1-ab83-961149fc03ae` (14 requests) at 2560 × 1300, 1440 × 900, 1280 × 800 and 390 × 844: the session flow with and without a selection, request 1 of `8af212b5` (a bare "yes") and request 4 (a question with no parts) on their Flow tabs, and the journey's station cards without guessed kind chips.
Body text 15 px or more, nothing under 13 px, 4.5:1 contrast, no horizontal page scroll, no overlapping cards or labels, no link across a card, nothing cut mid-word, no empty section.

## Tests (test first)

Routes and tabs; swimlane layout (columns from threads, rows in time order, `follows` links only where they cross threads or skip, pauses); the inferred note only when inferred; selection, keyboard, Escape, `?r=`; the phone list; the request step flow (only steps that have something, the reply case, prompt cleaning); kind chips hidden when inferred; one pulse per page.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
See your build with `npx vite --port 5199 --strictPort` in your worktree's `web` folder (proxies to the author's server on 8787; never restart or change that server), with your own headless Chrome through Playwright scripts (the shared Playwright browser may be busy; the installed Chrome works with `channel: "chrome"`); open `http://localhost:5199/auth/dev?login=Sarthak` first.
Save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/sflow-*.png`.
Branch `feat/session-flow`; copy this brief in and write `2026-11-10-murmur-session-flow-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
In `theme.css` add your rules in one block under a `/* Session flow */` comment.
