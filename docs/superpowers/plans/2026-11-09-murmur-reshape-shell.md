# Murmur reshape, phase 1: the rail, the breadcrumb and the top bar

Approved by the author on 9 Nov 2026 ("Yeah, go ahead and build it") after a full reshape proposal.
His words that this phase answers: "when I opened it was hard for me to understand what was going on, and how to navigate in pages, I saw Request, but hiding it in a dropdown bar, was tough to find around, I think that should be more transparent right".
He also asked "why its not responsive", so the frame must work from 375 px to 1920 px.

## Read first (local only, never commit them or copy their text into the repo: they hold the author's private work)

- `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md`, sections 1, 6 and 9 (navigation, motion, build plan).
- The mocks, open them in a browser: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/02-request-running.html` and `03-request-finished.html` (the frame: rail, top bar, tabs), `05-task.html` (the breadcrumb on a task), `01-session-journey.html` (the rail on the session page). PNGs of each sit beside them; `before-*.png` show today.
- `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/02-navigation.md` and `03-motion.md`.

## What to build (web only: `web/src`, `web/test`, `web/index.html`, theme)

1. **The left rail, 272 px, on every session page** (session, request, task).
   - Top: Murmur, then the session's title and one line of facts (requests, helpers, span, e.g. "13 requests · 136 helpers · 7 days").
   - Then the requests as a spine, grouped by day ("Mon 2 Nov"), each a row: its number, a short title (2 to 4 words: `request.short` when core gives it, else the goal cut at the first comma, colon or " - ", then at a word boundary near 32 characters), and a state mark that differs in shape and colour: a check for done, a pulsing blue dot for running (the only pulse on screen, 2.4 s, static ring under reduced motion), an amber question mark when Claude waits on the user, a hollow ring for left open, a red cross for failed.
   - The full title shows on hover (native `title`) and in the page header.
   - The current request is highlighted; the row is a real link (`<a href>`), keyboard reachable, `aria-current="page"` on the current one.
   - Long sessions scroll inside the rail; the current request scrolls into view on load.
   - The rail never changes between pages of the same session.
   - "Delete session" moves from the rail foot into a small session menu in the top bar.
2. **The top bar, 56 px, sticky.**
   - Left: the breadcrumb `Session › Request n › Phase › Task` (only the levels that apply), each level a link except the last, truncated with an ellipsis per level, never wrapping.
   - Right: the Now line (one line, ellipsis, never a raw shell command or raw tool name; keep the existing rule: narrated `now` wins, a Bash call shows its description else "Running a command", an MCP or other tool shows a plain phrase), the amber "n waiting on you" chip only when Claude waits, and the state pill ("Running · 17 min", "Done · 3 h 06 m", "Waiting · 4 min").
   - The phase progress bar that sits in today's top bar moves into the page (phase 2 replaces it with a track); keep it on the request page under the title for now.
3. **Remove the request dropdown and the Story/Map toggle.**
   Under the request title, a tab row `Story · Flow · Files · Helpers`, persisted in the URL: `/s/:sid/r/:rid` (Story), `/s/:sid/r/:rid/flow`, `/files`, `/helpers`.
   Flow shows today's map for now (phase 4 replaces it); Files shows the request's files grouped by part (reuse the existing files components); Helpers shows the helpers as one list (description, model, state, time, verdict) linking to their task pages.
   Back and forward work; a tab is a link, the active tab has `aria-current`.
4. **Session page.**
   Until phase 5 builds the journey, `/s/:sid` shows the rail and the newest request's page content in place (do not redirect, so phase 5 can take this route over).
5. **Responsive.**
   - At 1200 px and up: rail, content up to 1120 px.
   - 900 to 1199 px: the rail collapses to a 64 px strip of numbered marks (hover or focus shows the short title), content takes the rest.
   - Under 900 px: no rail; a "Requests" button at the left of the top bar opens it as a drawer over the page (focus trapped, Escape and a scrim click close it, it closes on navigation); the breadcrumb shows only the last two levels; the Now line moves under the top bar as its own line.
   - No horizontal scroll at 375, 390, 768, 1024, 1280, 1440 and 1920 px; nothing cut mid-word; tap targets 40 px or more on phones.
6. **Motion (just enough for this phase).**
   Navigating between requests uses the View Transitions API where the browser has it (`document.startViewTransition` around the route change in `navigate`), with the request title as a shared element (`view-transition-name`) so it morphs; the content rises 8 px over 200 ms; under `prefers-reduced-motion` a 150 ms crossfade only.
   Without View Transitions support, navigation is instant (no fallback library in this phase).

## Keep

Geist and Geist Mono only, the warm greys, amber only for "needs you", colour plus shape plus word for every state, no raw data by default, the safe Markdown renderer, the error boundary, focus rings, deep links, everything existing web tests cover (update tests whose markup changes; do not delete coverage).
Read `web/src/theme.css` tokens and reuse them; add tokens rather than raw values.

## Out of scope

Core changes (another builder is changing `packages/core` in parallel; do not touch it), the brief, the phase track, the flow board, the journey, the task page body.
Where you need a field core does not give yet (`short`, a request state), compute it in one small web helper with a comment naming the core field that will replace it.

## Tests (test first)

Web tests for: the rail (grouping by day, short title fallback, each state mark, current highlighted, links), the breadcrumb per page level, the top bar states (running, done, waiting chip), the tabs and their routes (`matchRoute` for `/flow`, `/files`, `/helpers`), the drawer under 900 px (opens, Escape closes, closes on navigation), the Now line never showing a raw command, the session menu holding delete.

## Checks before you report

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build`, each with its exit code checked on its own.
Your worktree needs its own install: run `pnpm install --frozen-lockfile` in it; never symlink `node_modules` from the main checkout and never commit `node_modules`.

Then look at the real page with Playwright.
The author's local server runs on `http://localhost:8787` serving the main checkout's build, so run your build through Vite instead: `npx vite --port 5190 --strictPort` in your worktree's `web` folder (it proxies `/api` and `/auth` to 8787), open `http://localhost:5190/auth/dev?login=Sarthak` first, then `http://localhost:5190/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae`.
Screenshot at 1440 × 900, 1280 × 800, 1024 × 768 and 390 × 844 (drawer closed and open): the session page, the newest request, request 7 ("Restyle the logged-in app ..."), its Flow tab, and the task page "Lit plate tokens".
Compare each with the mock PNGs and fix what does not match or looks off before reporting; be picky about alignment, spacing, truncation and contrast.
Save them under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/shell-*.png` and list them in the report.

## Git

Work on branch `feat/reshape-shell`.
Copy this brief into the branch at `docs/superpowers/plans/2026-11-09-murmur-reshape-shell.md` and write your report beside it as `2026-11-09-murmur-reshape-shell-report.md` (one sentence per line).
Commit with `git commit -- <paths>`; no `Co-Authored-By` line, no em dashes anywhere (use "-").
Push the branch and open a PR to `main` with `gh pr create`; do not merge.
