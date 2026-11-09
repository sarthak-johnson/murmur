# Murmur reshape, phase 4: the flow board replaces the map

Approved by the author on 9 Nov 2026 as part of the reshape.
His words this answers: "I thought we could use some flows, with animations and stuff", "since this is kind of a dashboard, flowchart kind of stuff", and the map being uneven (some parts empty, a hairball of crossing links on big requests, three boxes around an empty centre on small ones).
Core data (merged in PR #18) gives every part a status, `span`, `rounds`, `inferred`, links (`uses`, `sits in`, `sits on`, `feeds`, `checks`, `same files`), helpers and files; read `packages/core/src/view/types.ts`.
The shell (rail, top bar, tabs with `/s/:sid/r/:rid/flow`) is merged in PR #19; today the Flow tab shows the old `MapView`.

## Read first (local only, never commit them or copy their text into the repo)

- `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md`, section 4 (the flow) and section 6 (motion).
- The mock: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/04-flow.html` and its PNGs; `before-map.png` is today.
- `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/01-flow-visualisation.md`.

## What to build (web only: `web/src/map/*` or a new `web/src/flow/*`, the Flow tab, the theme)

1. **Bands** per phase, left to right, each with its title, state word and span; parts with no phase go in one "Other work" band at the end.
2. **Layered layout inside a band:** a part sits one column right of everything it reads through a dependency link (`uses`, `sits in`, `sits on`, `feeds`); cycles broken deterministically; inside a column, order by start time. Write the layering yourself (longest path over a DAG is a few dozen lines); no graph library.
3. **Uniform cards:** title, tag (T6), state word with mark (shape and colour), "3 helpers · 7 files · 17 min". Every part has these facts, so no card is empty. Running cards carry the one pulse only if nothing else pulses on screen, else a static blue mark.
4. **Links on selection:** unselected links are a quiet grey, `checks` dashed; selecting a part (click, or arrow keys and Enter) lights its links in blue with their labels and dims everything else to 42 percent; a detail strip below gives aim, done-when, span, files, "Uses" and "Used by", and "Open Task n" to the task page. `?part=<id>` in the URL selects on load (the task page links here); Escape clears.
5. **Folding past about 20 parts:** each band shows its running and failed parts plus a "+ n done" row that opens it.
6. **Size:** it fills the content column (max 1360 px for this tab), scrolls horizontally inside its own frame only when bands do not fit, never the page; under 900 px bands stack vertically and links are drawn only for the selection.
7. **Motion:** links restroke in 200 ms on selection, unselected cards dim; reduced motion instant.
8. Delete the old node-link `MapView` and `layout.ts` and their tests once nothing uses them (check the request page and task page imports; the request page's map section, if still present, goes; another builder is reshaping the request page, so only remove the map's import and usage there, nothing else).

## Quality bar

Screenshots of the real session at 1440 × 900, 1280 × 800 and 390 × 844, compared with the mock: request 7 (12 parts, 16 links), request 9 (huge, folding), the newest request (few parts), with and without a selection.
Text 13 px or more on cards, 4.5:1 contrast, no page horizontal scroll, no overlapping cards or labels, links never crossing a card.

## Tests (test first)

Layering (columns from links, cycle handling, order by start), bands including "Other work", uniform card facts, selection (links lit, others dimmed, detail strip, keyboard, Escape, `?part=`), folding past 20, stacking under 900 px.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
See your build with `npx vite --port 5194 --strictPort` in your worktree's `web` folder (proxies to the author's server on 8787; never restart or change that server); open `http://localhost:5194/auth/dev?login=Sarthak` first, then `http://localhost:5194/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae`.
Save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/flow-*.png`.
Branch `feat/reshape-flow`; copy this brief in and write `2026-11-09-murmur-reshape-flow-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push and open a PR, do not merge.
Two other builders work in parallel: one on the request page (`web/src/live/*`, branch `feat/reshape-request`) and one on the task page (`web/src/part/*`, branch `feat/reshape-task`). Stay in the flow files; in `theme.css` add your rules in one block under a `/* Flow board (reshape) */` comment and delete the old map rules.
