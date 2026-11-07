# Murmur redesign: catch-up brief layout, calm colours, helper timeline

Picked by the author on 7 Nov 2026 from three directions mocked on his real session.
His words before: "need it sexy looking, easy for user to read, understand what's going on, where it is".
His pick: **direction C's layout, with direction A's colours and B's helper timeline on the task page, and B's fonts.**

The mocks are local only (they hold the author's private work, never commit them or copy their text into the repo):
`/Users/sarprasa/Projects/murmur/reports/design-directions/` has `a-calm-instrument.html`, `b-live-mission.html`, `c-catch-up-brief.html` and a request and task PNG for each, plus `index.html` comparing them.
The research behind them: `/Users/sarprasa/Projects/murmur/reports/Murmur UI design study.md`.

## What to build (web only, plus core only where a view needs data core does not give)

1. **Type (from B).** Geist for interface text, Geist Mono for code, times and numbers (tabular figures), Newsreader for Claude's own words and page titles as in C. Load from Google Fonts with real fallback stacks.
2. **Colour (from A).** A's warm grey ramp and text ladder exactly as in `a-calm-instrument.html`'s tokens; colour only ever means a state: blue live, green done, red failed, amber means only "needs you" (not helpers, not "left open"; helpers and left-open use neutral or their own non-amber marks, as in A). One glow: the live phase.
3. **Frame (from C).** A top bar pinned across the page: Murmur, Running/Done pill, "Now" line, phase n of m with a segmented bar and n/m, and a "N questions for you · waiting X min" chip in amber only when Claude is waiting on the user.
   A left plan column as a vertical timeline: phases with their done count and times, tasks with checks, the current phase's live helpers as small cards (task, agent, model, running time), a "you are here" dot on the live phase; it replaces the old phase strip and the right-hand plan panel.
   The session's other requests move to a request switcher (a menu in the top bar, like B's "Request 3 of 9"), so the left column is the plan.
4. **Request page (from C).** The request title in Newsreader, a quiet line of facts (asked at, helpers, sent back after review).
   "Since you last looked at HH:MM, X ago": one plain sentence and up to five bullets built from what happened since `lastLooked` (tasks done or passed review, problems found, fixes, helpers started, questions asked), each with a state mark; hidden when there is nothing new or no last look.
   "Needs your call" beside it when Claude is waiting: the questions Claude asked (from an `AskUserQuestion` call's questions, else the question sentences of Claude's last message before it stopped waiting), how long it has waited, and "Answer in the terminal".
   Then the story grouped under its phase ("Phase 1: … · what happened"), oldest first inside a finished phase, newest first in the live one, using the existing message grouping and quiet badges.
   The map becomes an optional "Map" view one click away (the report: a node map only helps under about 20 parts).
5. **Task page (C's layout with B's timeline).** Breadcrumb, title in Newsreader with its outcome ("Done after one fix round"), aim and "Done when", facts (time span, helpers, files with +/−, commit).
   "How it went" as B's timeline: one lane per helper (and one for Claude) on a shared time axis, each run a labelled bar (Built…, Found weaker colours, Fixed, Passed) coloured by its result, Claude's own closing step at the end; below it the numbered steps with Claude's words as in C, each opening the helper's full report.
   "Left open", "Checked" and "Files, by what they do" (files grouped by their role) as in C.
6. **Now line.** Never a raw shell command: a running Bash shows its description, else "Running a command" with the command one click away; Claude's narrated `now` wins when present.
7. **Keep what works.** No raw JSON by default, the safe Markdown renderer, the readable event views, the error boundary, sticky columns, focus rings, reduced motion, deep links, everything the existing web tests cover; update tests whose markup changes.

## Quality bar

At 1440 × 900 and 1280 × 800 on the real session the screens must look like the mocks: same hierarchy, spacing rhythm and restraint. Body text 15 to 16 px minimum, nothing under 12 px, WCAG 4.5:1 for all text, nothing cut mid-word, no horizontal scroll, no empty sections drawn.
Live updates must not move what the user is reading (no reshuffle, no layout jump when a helper starts or ends).

## Tests and checks

Web tests first for: the top bar states (running, done, waiting with questions), the plan column (phases, you-are-here, live helpers), the catch-up block (built from events since last look, hidden when nothing new), the questions block, story grouped by phase, the task timeline (lanes, bars, results, Claude's lane), files grouped by role, the request switcher, the Now line never showing a raw command.
Then `pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`, each exit code checked on its own, and screenshots of the real session (log in at `http://localhost:8787/auth/dev?login=Sarthak`, session `/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae` request "Restyle the logged-in app…" and its task "Lit plate tokens", plus the short session `/s/523ef14d-ed00-4cdd-a218-967304e9d185`) compared side by side with the mock PNGs.
