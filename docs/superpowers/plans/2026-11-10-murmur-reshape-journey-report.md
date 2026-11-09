# Murmur reshape, phase 5: report

Branch `feat/reshape-journey`, web plus one small core fix.

## What was built

### The journey (`web/src/live/Journey.tsx`), now the page at `/s/:sid`

- The session page no longer shows the newest request in place; it answers "where did this start, where did it go".
- Over the title: a Session chip, the folder and the days it ran ("tradara-stock-screener · Mon 2 Nov to Tue 10 Nov").
- The title is the session's name (see the core fix), then the facts: days, requests, chapters, how many run now.
- From here to here: two cards joined by a line with "7 days · 14 requests" on it.
- The first card is the first prompt as typed, with its day and time, its kind and its outcome; the second is the last request's outcome, when, and "Request 14, running 2 h 52 m." (or "done in", "left open after", "failed after").
- "n things wait on you" shows in amber only when the request really waits; the second card says "Where it ended" once nothing runs.
- Each card links to its request.
- Totals: helpers, files, commands, tasks sent back after review, and pauses with the longest one ("7 pauses over an hour, the longest 3 days"), as large tabular figures.
- Chapters: a segmented strip, one segment per chapter, as wide as its request count, the live chapter lit and marked `aria-current="step"`; each segment has its title and request range, and a click glides to that chapter on the line.
- The line: a vertical metro line, chapter headers on it ("3. Phases 0 and 1 · 3 requests · 12 h 07 m · 51 helpers"), and each request a station card.
- A station card has the kind chip, the full title (wrapped, never cut), the outcome ("Running · ..." in blue while it runs), four figures (took or so far, helpers, files, tasks done of all) and a thin load bar sized to the busiest request's helpers.
- The state mark sits on the line in the rail's shapes and colours; the running station carries the one pulse.
- A pause between requests is a dashed stretch of the line: "3 days away. Nothing ran between Mon 2 Nov 21:01 and Fri 6 Nov 15:20."
- Pauses inside a request sit on its card as one quiet line: "Paused 2 h 36 m, Fri 6 Nov 20:03 to 22:39; 1 h 21 m, Sat 7 Nov 02:06 to 03:27."
- Decisions are pills: an approving prompt opens its request ("You approved: “Yes please go ahead”"), Claude's decision sentence follows the station it came in.
- A view built before core had `journey` reads as one chapter with no strip and no totals, never an empty section.

### Motion

- A clicked card grows into the next page's title: router.ts names the card (`.vt-src` under `html.vt-morph`) only for the old snapshot, the title carries the name in the new one, 260 ms ease-out.
- Cards that morph carry `data-morph`: journey stations and both end cards, rail rows, track stations, and the flow board's selected-part panel.
- Back and forward run the same path reversed: useRoute wraps popstate in a View Transition, names the card that links to the page being left, and restores that entry's scroll (kept in `history.state`), so the title shrinks back into its card where the reader left it.
- The page is the root snapshot, so a page scrolled down leaves from where it was; the rail and the top bar are layers of their own that change at once, so a crossfade never shows two lists.
- The old page fades in 120 ms; the new page rises 8 px over 200 ms from 60 ms, landing with the title at 260 ms.
- Entrances run once per session: the end cards, totals and the first ten stations rise in turn on first load; coming back to the journey or a live update replays nothing, and only a station that arrives live rises, alone.
- The chapter strip draws left to right once and the join line between the end cards draws from start to now.
- One loop on screen: on the journey only the newest running station pulses (the rail's dot does not); on a request page only the rail's newest running mark pulses, even when an older request's helper still runs too.
- Under reduced motion the shared element becomes a 150 ms crossfade, rises become 150 ms fades, the draws are static, the chapter jump does not glide, and the pulse is a static ring.

### Phone

- Under 900 px the end cards stack with the join line vertical, totals go two by two (the fifth spans), the chapter strip scrolls sideways inside itself, and station cards take the full width with the time above them and the figures under the outcome.

## Core fix

- `SessionView.title` was the first prompt sliced at 80 characters, cut mid-word.
- It is now the first prompt with spaces collapsed, cut at a word within 48 characters (`cutWords`), tested in `reduce.test.ts`.
- Neither recap nor narration gives a session name, so the title stays honest: "Bro we recently made Alphatake, and now…"; the rail and breadcrumb show it whole, the full prompt on hover.
- `plugin/dist/hook.cjs` is rebuilt to match.

## Tests

- `web/test/journey.test.tsx`: the session route shows the journey, the end cards (amber only when waiting, "Where it ended" once done), totals, the chapter strip (segments, weights, live lit, scroll target), chapter headers, station cards and their figures and load bar, marks, pauses between and inside, decisions and their order, and a view with no journey.
- `web/test/motion.test.tsx`: one pulse per page on the journey and on a request page, only the pulse loops in the CSS, entrances once, the reduced-motion rules, the chapter jump without glide, and the morph forward, on a plain link, and back.
- The tests that drew a request page through the bare session route now name the newest request (a small `Live` wrapper in each file); the shell tests say the session page is the journey.

## Checks

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build` each exit 0.

## Decided differently from the mock

- The title is the session's honest name, not the mock's written headline ("Tradara redesign: from the UI is mid to Phase 3"); Murmur has no source for such a name, and the first chapter's title was ruled out.
- The facts line has no "52 of 71 plan tasks done": plans repeat across requests, so a sum would count the same task many times.
- The fourth total reads "tasks sent back after review" without "of 136": core's count is distinct subjects, and helpers are a different unit.
- Chapter titles are core's ("Compare tradara.in's UI", "Phase 3"), not the mock's hand-written ones; "Phase 3" is bare because no plan title in those requests names it.
- Claude's decisions come from core as found; on the real session one is a note that the wordmark style is intentional, which reads as a decision about the look.
- A pause between chapters sits at the end of the chapter it follows, in time order, rather than under the next chapter's header.
- Titles wrap instead of ending in an ellipsis, so nothing is cut mid-word.
