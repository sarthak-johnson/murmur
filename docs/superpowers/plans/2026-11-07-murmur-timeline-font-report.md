# Report: a timeline that reads, no serif (items 2 and 3)

Brief: `docs/superpowers/plans/2026-11-07-murmur-live-plan-and-timeline.md`, items 2 and 3, all in `web/`.

## The bug, reproduced

On the real task "Inventory of every agent page element" (session `27a000a1-…`, request `6a4a8307-…`), Agent 2 ran from 03:54 to 15:33 in ten runs.
The lane drew them on a plain ten-hour axis: ten bars between 2 px and 40 px wide, every label pushed beside its bar, so "Bı", "Fixed", "ixe", "xed" sat on top of each other.
Two of the ten bars had no width at all: a run resumed by a message with no stop seen ended at the helper's first stop (04:51), before it started (08:11, 11:27).
The band above read "03:54 to 04:51", the first stop, not the end of the work.

## Item 2: a timeline that reads

The layout is now one pure function, `layoutTimeline` in `web/src/part/Timeline.tsx`, that returns every bar, label, tick and break in px, so tests measure it directly.

- **Long gaps are cut.**
  Idle stretches longer than a twelfth of the span (at least 20 minutes) become a 44 px break: a slashed mark on the axis, a hatched band down the lanes, and the real idle time in the mark's tooltip ("2 h 50 m with no work").
  No stretch between breaks is drawn narrower than 72 px, and breaks plus those minimums never take more than 70% of the track (past that, the shortest gaps are drawn after all).
- **Close runs merge.**
  Runs closer than a label is wide, or whose bar can hold its words neither inside nor beside it before the next run, become one bar: "3 fix rounds" when all were fixes, else the first label plus "+N" ("Built +1").
  A bar never spans a break.
- **Labels never touch.**
  Words go inside the bar, else after it, else before it, and only where they touch no other label or bar; a merged bar of fixes may fall back to "3 fixes" first.
  Otherwise the bar is drawn bare and its words stay in its tooltip (which lists every run's times) and in the step list below.
- **Axis times never touch** each other or a break; a stretch after a break starts its time at its own edge.
- **Grid lines** are drawn at the ticks instead of a repeating background, so they stay true on a cut axis.
- **Root-cause fixes** in `web/src/session.ts` (a resumed run with no stop of its own ends where it starts, never before) and `web/src/part/PartDetail.tsx` (the band runs to the helper's last run).

On the real task the lane now reads, left to right: "Built +1", a break, "Fixed", a break, "Fixed", a break, "3 fixes", then later "3 fixes", a break, "Fixed".

## Item 3: no serif

Newsreader is gone from `web/index.html` and `web/src/theme.css`, and the `--font-read` token with it.
Every rule that used it is Geist now, with the hierarchy carried by size and weight:

| Role | Before (Newsreader) | Now (Geist) |
| --- | --- | --- |
| Task title `.pd-title` | 500 42/48 | 600 38/46, -0.025em |
| Request title `.ask` | 500 30/38 | 600 28/36, -0.02em |
| Section heads `.sect h2`, `.hh` | 500 20/26 | 600 18/26, -0.01em |
| Phase names `.ph h3` | 500 18/24 | 600 16/22, -0.01em |
| Small heads `.mh`, `.qq b` | 500 17 | 600 16 |
| Brand | 500 21 | 600 18, -0.02em |
| Claude's words `.story-text` | 400 18/28 | 400 16/26 |
| Lead and deck `.lead`, `.deck-text` | 400 21/31 | 400 18/28 |
| Steps `.step-lead`, `.step-text` | 400 17/27 | 400 16/26 (a body after a lead: 15/24) |
| Reading text `.reading`, `.ev-brief` | 15.5/1.6 | 400 15/24 |

Code, axis times and story times stay Geist Mono, as before.
The `.num` spans (for example "waiting 5 m", "3 files, +161 −0") mix words and numbers, so they stay Geist with tabular figures rather than switching whole phrases to mono.

Two layout follow-ups found while checking every page:

- A step's lead was set a size below its own body once both were sans; the lead is now 16 px and the body under it 15 px.
- The "From Claude's narration" tag wraps under the deck line now that the line is a sans; its 4 px left margin pushed it out of line with the text above, so the space before it is the gap instead.

## Tests

New tests, each seen failing for the right reason before the code:

- `web/test/timeline.test.tsx` (10 tests): many short runs on one lane merge into "12 fix rounds"; a mixed merge reads "Built +2"; far-apart runs keep their bars; a label with no room is left to the tooltip; a ten-hour span with gaps gets at least three breaks and its seven-minute run more than twice its plain-axis width; a short span has no breaks; 200 seeded random layouts where no label ever touches another label or bar and no tick touches another tick or a break; a resumed run never ends before it starts; the task page marks the cut gaps; the band runs to the last run.
- `web/test/type.test.ts` (4 tests): only Geist and Geist Mono are loaded or named; titles are 600; Claude's words are 400 at 15 px or more with a line height of 1.5 or more; the task title is the largest type.
- One existing expectation in `web/test/redesign.test.tsx` changed: a one-minute recheck's "Passed" now sits after its bar rather than before it, since it fits there.

Counts: web 272 tests, all passing; `pnpm -s test` 782 across the four packages (243, 175, 92, 272), all passing.

## Checks

- `pnpm -s test`: exit 0.
- `pnpm --filter @murmur/web -s build`: exit 0.
- `pnpm -s lint`: exit 1, only on `plugin/src/recap.ts` and `plugin/test/refresh.test.ts` (formatting), the other builder's work in progress; `biome check web` is clean.
- `pnpm -s typecheck`: exit 1, only in `plugin/src/recap.ts` (`cost` missing on `Ask`), the same work in progress; `tsc` for web is clean.

## Screenshots (1440 × 900)

- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/fix3-task.png`: the real task page, with the readable timeline.
- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/fix3-tokens.png`: "Lit plate tokens", in request "Restyle the logged-in app…".
- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/fix3-request.png`: the request page.
- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/before-task.png`: the task page before, for comparison.

## Known limits

- Label widths are estimated (7 px a character at 12 px semibold, 7.8 px for 13 px mono), a little wide for Geist; measuring with canvas would let more labels sit inside their bars.
- A stretch drawn at its 72 px minimum is wider than its true scale, so time is not to scale across stretches; the breaks mark that.
