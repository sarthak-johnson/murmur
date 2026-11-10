# Murmur tasks list: report

Branch `feat/tasks-list`, from `origin/main` at 2d05def.
Brief: `2026-11-10-murmur-tasks-list.md` beside this file.

## The Story tab's cause

The Story tab was empty because Claude's words had not reached the server yet.
The plugin reads Claude's new text from the transcript (`catchUpText`) only in the detached child that the hooks Claude waits on spawn: `SessionStart`, `UserPromptSubmit` and `Stop`.
The tool hooks (`PreToolUse`, `PostToolUse` and the rest) are async in `hooks.json` and flush inline, but never read the text.
So while Claude works through tools, every message waits for the turn's `Stop`.
On request 7 the turn ran from 20:55 to 21:03 without a `Stop`, so at 15 commands the server held no `AssistantText` for it, and `Story` returned nothing: no messages and no helper waiting.
Reproduced by replaying the session's stored events cut at 21:01 with the text left out, through the author's own build on 8787 (requests intercepted in the browser, nothing written): the main column is empty and only the Files card shows, as in the author's screenshot.
With the text in, both the author's build and this branch draw the story at every point of that replay, so the view code was not the cause.

Fixed in two places:

1. `plugin/src/hook.ts`: the async hooks now call `catchUpText` before their own flush, so Claude's words go out with the next tool call.
   The hooks Claude waits on still never read the transcript (the existing dist test for `Stop` still holds).
   This is outside `web/src` and `packages/core`: the cause is in the plugin, so the fix is there; `plugin/dist/hook.cjs` is rebuilt for it.
2. `web/src/live/Story.tsx`: a running request's live section always says something.
   With no message in it and no helper waiting, it shows a "now" row: Claude's last narration, else the task under way, else the next one in the plan.

`packages/core` is untouched.

## What was built

- **Tasks tab.**
  The request tabs are `Story · Tasks · Flow · Files · Helpers`; `/s/:sid/r/:rid/tasks` is its own URL.
  The tab is hidden for a request with no plan and no map parts.
  One list by phase in the plan's order: the phase's title, "n of m done" and its time span, then its rows.
  Each row: its plan number, the rail's state mark, the full title (two lines at most, whole words), one quiet line (the part's aim, or for a done or failed task how it ended), and a facts line ("2 helpers · 3 files · took 4 m", "started 21:02", nothing when not started).
  A line that only repeats the title is left out.
  The whole row is a link; its title is the view transition's source (the router now also finds a `data-morph` inside the clicked link).
  The running row carries the page's one pulse, and the rail's mark stops pulsing on this tab.
  "Beyond the plan" is the last group, its helpers as rows; a request with no plan lists its parts in one group.
- **Every station named on the track.**
  Each caption has its station's slot, centred under its dot, two lines at most, an ellipsis only past that.
  Phases now share the width by station count (at least two), so every slot on a track is the same width.
  `stacks()` decides from the measured width (a `ResizeObserver`) whether any slot gets under 72 px; then the track reads top to bottom, the layout it already used under 900 px.
  That layout is now the `.trk.stack` class, set by `Track.tsx` under 900 px too, instead of a media query.
  At 2560 and 1440 both test requests stay horizontal; at 1280 request 15 of the long session (14 tasks in one phase) stacks.
- **One Previous/Next row.**
  The foot row is drawn only when the page has something between it and the top row (how it went, helpers, the margin, files); empty wrappers are no longer drawn either.
- **A task not started says what it will be.**
  "Last of 3 tasks in Draft, after Task 2 · Write the watering section.", "Next is Task 4 · Send to the printer.", and while the request runs "Claude is on Task 2 · Write the watering section now." with a link (the test fixture's words).
  The plan number is in the chip above, so the line does not say "Task 7 of 8" a second time.

## Fixed along the way

- A phase with some tasks done but its own status "todo" read "5 tasks, not started" on the track and "Not started" in the story; it now reads "2 of 5 done" and "Partly done".
- Text under 13 px in the story: inline code, code blocks, "Show more" and the assumption's reason were 12.5 px; now 13 px.

## Screenshots

In `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/`, named `tasks-<width>-<page>.png` for widths 2560, 1440, 1280 and 390, pages `r7-story`, `r7-tasks`, `r7-task1`, `r7-task7` (not started) of session `c8e82aaf`, and `r15-story`, `r15-tasks`, `r15-task1` of session `8af212b5` (request 15, 14 tasks).
The Story cause: `before-1440-r7-story-empty.png` (the author's build, text withheld) and `tasks-1440-r7-story-before-text.png` (this branch, same events).
Checked on every shot by script: no caption overlaps another or is hidden, no horizontal scroll, no text under 13 px, no page errors.
Request 7 moved on while this was built (it is left open now and request 8 runs), so the shots show its later state.

## Checks

`pnpm -s lint` 0, `pnpm -s typecheck` 0, `pnpm -s test` 0 (core 364, server 234, plugin 130, web 442), `pnpm -s build:plugin` 0, `pnpm --filter @murmur/web -s build` 0.

## Left open

- The top bar shows "Waiting on you 2 m" and "Waiting · 2 m" side by side when a request waits on you; existing tests ask for both, so it is unchanged here, but it reads as the same thing twice and crowds the breadcrumb, which cuts the phase name to two letters.
- At 1280 px some track captions still end in an ellipsis on their second line; the full name is in the tooltip and the Tasks tab.
- On request 7 the first task's page lists files its helpers' sibling tasks wrote: core's file-to-part attribution, not touched here.
