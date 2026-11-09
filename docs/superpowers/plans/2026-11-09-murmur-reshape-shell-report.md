# Murmur reshape, phase 1: report

Branch `feat/reshape-shell`, web only (`web/src`, `web/test`); `packages/core` is untouched.

## What was built

### The rail (`web/src/live/Rail.tsx`)

- A 272 px rail on the session, request and task pages: Murmur, the session's title (two lines at most) and one line of facts ("14 requests · 196 helpers · 7 days").
- The requests as a spine grouped by day ("Mon 2 Nov"), each row a real `<a href>` with its number, a short title and a state mark.
- Marks differ in shape and colour, with the word beside them for screen readers: a check for done, a blue dot for running (the one pulse on screen, 2.4 s, a static ring under reduced motion), an amber question mark for waiting on you, a hollow ring for left open, a red cross for failed.
- The full title is the row's native `title`; the shown request is highlighted with `aria-current="page"` (`"true"` on the session page and on a task page, where the row is the parent, not the page).
- Running and waiting rows, and the shown one, carry a second line ("Running · 17 m · 3 helpers", "3 h 05 m · 32 helpers").
- Only the request list scrolls; Murmur, the session and the foot stay put, and the list fades at both edges instead of showing a scrollbar.
- The shown request scrolls into view on load and whenever it changes or the list grows, but only when it is out of view, so a click in the rail never makes it jump.
- The rail is one component instance per session, so it never changes between pages of the same session.

### The short title and the state (`web/src/session.ts`)

- `requestShort` prefers core's `request.short` and otherwise cuts the goal at the first comma, colon, semicolon or spaced dash, then at a word boundary near 32 characters.
- `requestMark` prefers core's `request.state` and otherwise reads it from the existing `requestState`: the newest request runs, waits or is done; a finished one failed when a plan task failed, was left open when plan tasks are not done, else is done.
- Both helpers carry a comment naming the core field that replaces them.

### The top bar (`web/src/live/TopBar.tsx`)

- 56 px, sticky, translucent with a blur, as in the mocks.
- Left: the breadcrumb `Session › Request n › Phase › Task`, only the levels that apply, each a link but the last, ellipsis per level, never wrapping.
- On the session page it reads `Sessions › <session>` as in mock 01.
- The phase level links to that phase's part of the story (`#phase-<id>`), and the request page scrolls to it on arrival.
- Right: the Now line (the existing rule kept: narrated `now` wins, a Bash call shows its description or "Running a command", an MCP tool a plain phrase), the amber "n waiting on you" chip only when Claude waits, the state pill ("Running · 17 m", "Done · 3 h 05 m", "Waiting · 4 m") and a session menu.
- The session menu holds Settings, Sign out and Delete session (still two clicks).
- The phase progress bar moved out of the bar into the request page, beside the facts under the title.

### Tabs and routes (`web/src/router.ts`, `web/src/live/Tabs.tsx`)

- The request dropdown and the Story/Map toggle are gone.
- `Story · Flow · Files · Helpers` sit under the title as links, `aria-current="page"` on the active one; back and forward work.
- Routes: `/s/:sid/r/:rid` (Story), `/flow`, `/files`, `/helpers`; `/story` is not a second URL for Story.
- Flow shows today's map at up to 1360 px wide.
- Files shows the request's files grouped by part, then "Outside any task", with the existing `FileList` and `PathText`.
- Helpers lists every helper (description, agent number, model, state, start and time, verdict) linking to its task page when it has one.
- Story keeps the story with the plan as a sticky side card (the old left plan column), and the map in place of the story when Claude has said nothing yet.

### Session page

- `/s/:sid` shows the rail and the newest request's page in place, with no redirect.

### Responsive

- 1200 px and up: the rail, content up to 1120 px.
- 900 to 1199 px: the rail folds to a 64 px strip of numbered marks; hover or focus shows "short title · state" beside the strip.
- Under 900 px: no rail, a "Requests" button opens it as a drawer over a scrim; focus moves in and is trapped, the page behind is `inert`, Escape and a scrim click close it and return focus to the button, any navigation closes it, and widening the window past 900 px closes it.
- Under 900 px the breadcrumb shows its last two levels and the Now line has its own row under the bar.
- The story and its plan card sit side by side when the page column is 860 px or wider (a container query), else the plan follows the story.
- Checked in the real browser: no horizontal scroll at 375, 390, 768, 1024, 1280, 1440 and 1920 px on the session page, the newest request, request 7 and its Flow, Files and Helpers tabs, and the "Lit plate tokens" task page; every tap target in the bar, tabs and drawer is 40 px or more on phones.

### Motion

- `navigate` runs the route change inside `document.startViewTransition` (with `flushSync`) where the browser has it, and is instant elsewhere.
- The request title is a shared element (`view-transition-name: request-title`) so it morphs; the page rises 8 px over 200 ms while the old one fades in 120 ms; the rail and the bar do not animate.
- Under `prefers-reduced-motion` every transition is a 150 ms crossfade and the drawer does not slide.
- The running helper card's shimmer in the plan was removed, so the rail's running mark is the only loop on screen.

## Tests

- New `web/test/shell.test.tsx` (30 tests): short titles (including the core field and the dash cuts), the rail's grouping by day, facts, links and full titles, each state mark, core's state, the highlighted request, the session page, the breadcrumb per page level, the top bar running, done and waiting, the Now line never raw, the session menu holding delete, the tabs and their URLs, Flow, Files and Helpers, and the drawer (opens with focus inside, Tab stays inside, Escape returns focus, scrim click, closes on navigation).
- `web/test/router.test.ts`: `matchRoute` for `/flow`, `/files`, `/helpers`, `/story` rejected, `requestPath`, and `navigate` with and without View Transitions.
- Existing tests whose markup changed were updated, not deleted: the switcher tests now drive the rail, the Story/Map tests drive the tabs, the progress tests look under the title, the delete test opens the session menu, the skeleton tests compare the new frame, the task page's in-page breadcrumb test checks its "Where it sits" chips and the top bar breadcrumb.

## Checks

- `pnpm -s lint`: exit 0, no warnings.
- `pnpm -s typecheck`: exit 0.
- `pnpm -s test`: exit 0 (web 307, core 245, server 207, plugin 129).
- `pnpm -s build:plugin`: exit 0.
- `pnpm --filter @murmur/web -s build`: exit 0.

## Decided differently, and why

- The left plan column stays, as a sticky card beside the story, because phase 2's track replaces it and the live helper cards, task links and map highlighting would otherwise disappear for weeks; it is not on the task page, where the breadcrumb and the new "Task 1 of 13 · Phase 0" chips (mock 05) say where you are.
- The task page's own breadcrumb moved to the top bar; in its place are the two chips from mock 05.
- The request page gained mock 03's head line ("Feature" and "Request 7 of 14 · Fri 6 Nov"), which also keeps the inferred-kind tag that used to live in the dropdown.
- A done request keeps its "In all" Now line (the brief says to keep the existing rule), but the bar gives way: the breadcrumb comes first, and the line hides itself when it has no room for its counts, so on a task page the bar reads like mock 05.
- The session menu also holds Settings and Sign out, because the rail's foot has no room for them in the folded strip.
- The chip says "2 waiting on you" as the brief asks, and keeps the wait time after it in quiet text; a permission prompt still says "Permission needed".
- Durations use the app's existing format ("17 m", "3 h 05 m") rather than the mock's "17 min".

## Could not match, waiting on core

- Short titles: the mocks use core's 2 to 4 word names ("Restart jobs, new tracker"); until `request.short` lands, the fallback cut of the goal is longer, so the rail ellipsizes most rows.
- States: the real session shows many finished requests as left open, because their plans have tasks never marked done; core's `request.state` will settle those.
- The session title is the first prompt, as core gives it today, not a narrated name like the mock's "Tradara redesign".
