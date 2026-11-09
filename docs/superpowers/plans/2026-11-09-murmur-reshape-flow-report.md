# Murmur reshape, phase 4: report

## What was built

The Flow tab now shows a flow board (`web/src/flow/flow.ts` for the readings and geometry, `web/src/flow/FlowBoard.tsx` for the view).
Bands run left to right, one per phase that has parts, then one "Other work" band for parts with no known phase.
Each band header gives its title, its state word with mark, "n of m done" and its span.
Inside a band a part sits one column right of everything it reads; loops are broken by a walk in declaration order, so the part declared first stays first and the same input always lays out the same.
A column is ordered by start time, parts not started last.
Cards are one size: title (with the plan's tag, "T6", "T4-5", "B1", in front), state word with mark, and "3 helpers · 7 files · 17 m".
A card wider than 260 px also shows the part's aim.
Links run only through the gaps between cards (the column gutters and the row gaps, which line up because every card is the same height), so they never cross a card.
Selecting a part (click, or arrow keys) lights its links blue, puts each link's label on the related card's top edge, dims everything else to 42 percent in 200 ms, and opens a detail strip with aim, done-when, span, helpers, files with lines added and removed, "Uses", "Used by" and "Open Task n".
The selection lives in `?part=` (replaceState), so a deep link selects on load and Escape or a second click clears it.
Past 20 parts each band folds its done parts into a "+ n done" row that opens the band; a folded part named in the URL opens its band.
Under 900 px bands stack, cards run one under another in build order, and only the selection's links are drawn, in a gutter on the left.
When the board is wider than the frame it scrolls inside the frame and the right edge fades; the page never scrolls sideways.
The old `MapView`, `layout.ts`, their tests and the map CSS are gone; the Story tab no longer falls back to the map when a request has no messages.

## Checks

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build` each exit 0.

## Decided differently from the brief or the mock

- `checks` links order the layout as well as the four dependency labels, so a check sits after what it checks; with only the four labels the screenshot sweep of request 7 landed in the first column.
  Only "same files" gives no order, since narrated labels are free text ("builds on", "opens", "hands off to").
- Request 7 is eight columns deep with strict layering (tokens, HeroMoney, plate, surfaces, frame, then rail, top bar and dock, then the sweep, then Phase 1), not the five the mock shows, because the plate uses HeroMoney and the surfaces sit on the plate.
  It does not fit 1440 px at a readable card width, so it scrolls inside its frame with a fading edge, as the brief allows.
- Link labels sit as small blue tabs on the related card's top edge rather than on the line, because a 32 px gutter has no room for a label and a label on a line crossed other lines.
- The tag moved in front of the title: beside the state word it collided with "Done, 1 round" at 156 px.
- A running card never pulses while the rail shows (the rail's mark for the same request already pulses); under 900 px, where the rail is folded away, the first running card pulses.
- No real request has more than 20 parts (the biggest is request 7 with 12, and request 9 has 5), so folding was checked in tests and in a screenshot with the threshold lowered to 5 for that one shot.
- The plan column's hover no longer highlights anything (it lit the old map); `onHover` is passed a no-op for the request page builder to remove.
- A one-column band cuts its header with an ellipsis ("Phase 1: My Agents…"); the full title shows on hover.

## Screenshots

In `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/`: `flow-r7-1440.png`, `flow-r7-1440-sel.png`, `flow-r7-1440-end.png`, `flow-r7-1280-sel.png`, `flow-r7-390.png`, `flow-r7-390-sel.png`, `flow-r9-1440.png`, `flow-r9-1280.png`, `flow-r14-1440.png`, `flow-r14-1280-sel.png`, `flow-r14-390.png` and `flow-fold-demo-1440.png`.
