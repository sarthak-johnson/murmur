# Murmur: titles Claude writes, and the session's storylines (core and plugin)

Asked for by the author on 10 Nov 2026, looking at his own 44-request session.
His words: "The requests in the side rail, it is just some time short words, but the thing that is happening inside is different, I think its kinda nonsense just showing this as a feature or request right, we should rather summarize, like anything better than this bro, also there exists no flow of the whole session".
This brief is the data half; a second builder draws the session flow in the web app in parallel (branch `feat/session-flow`), reading the fields you fill.

## What is wrong today (measured on session `8af212b5-3fb0-4f7c-8d39-20ac4bde9088`)

- 29 of 44 requests were never mapped by Claude, so `short` and `goal` are the prompt cut short: "Yes", "Ok", "Sure okay", "Waiting", "Sent to Ankur", "[Image #1]", "Umang replied <pasted_content".
- Requests Claude did map rarely carry `short`, so `shortOf` cuts the goal at 32 characters mid-phrase: "Confirm whether build 9 was", "Find what can be pruned without", "Ok make sure if there are any".
- The kind chip ("Feature" on a request whose prompt was "yes") is a guess shown as a fact.
- The session is titled "yes" (its first prompt) and its journey has 22 chapters, titled "Yes", "All good?", "5.", "Ok".
- The recap that summarises imported history covers only the 5 most recent requests (`MAX_REQUESTS` in `plugin/src/recap.ts`).
- Meanwhile `outcome` is already good on almost every request ("Build 9 is uploaded to TestFlight.", "PR #4 is merged into main as a normal merge commit").

The fields to fill were added to `packages/core/src/view/types.ts` in PR #26: `SessionView.titledBy` and `threads` (`Thread`), and `RequestView.activity`, `thread` and `follows`; read their doc comments, they are the contract with the web builder.

## What to build

1. **Live: Claude gives a title on every request.**
   In `plugin/src/instruction.ts`, `map` asks for `short`: what the request does as a 2 to 5 word title ("Ship build 9 to TestFlight"), never the user's own words ("Yes", "Ok").
   Ask for `map` once even when the prompt is a short reply ("yes", "go ahead", "ok"): the goal is what the reply sets in motion.
   Put `short` in the example; keep the instruction short (it is sent to every session).
   Check `MapInput.short` (max 60) still fits.
2. **History and gaps: a titles run.**
   One `claude -p` run (same isolation as `ask` in `recap.ts`: headless, `MURMUR_RECAP_RUN=1`, never uploads its own hooks, killed on exit, timeout) that names every request Claude has not titled, and groups all requests into storylines.
   - Input per request: id, time, prompt (scrubbed with core's scrubbing, `<pasted_content ...>` blocks and `[Image #n]` reduced to "(pasted text)" and "(image)", cut to 300 characters), Claude's first and last message (cut to 200 and 400), up to 5 file names it changed, up to 3 helper descriptions; for requests already titled, their `short` and `goal` only, as context.
   - Output, validated by a new zod schema in core next to the recap's: `{ "session": { "title" }, "threads": [{ "id", "title" }], "requests": [{ "id", "short", "goal", "kind", "thread", "follows"? }] }`; session title at most 48 characters, `short` at most 40, `goal` at most 120, thread title at most 40.
   - The prompt asks for titles that say what was done or decided, in plain words, never the user's words, and storylines as the few threads of work a person would name (expect 3 to 10 for a long session, one for a short one); `follows` only when a request picks up a different, earlier request than the one before it in its thread.
   - It runs after an import's recap finishes (so imported history is titled in full, not only its last 5 requests), and when a request ends while any request lacks a Claude title or a thread: at most once every 10 minutes per session, only when something new is uncovered, at most 80 requests per run (the newest), and never while the project is off or the session paused.
   - It emits synthetic events the way the recap does (marked so core can tell them apart and the hook never treats them as live work); pick the shape that fits `recapEvents`, and document it.
   - Update the privacy line in `web/src/pages/WhatMurmurSends.tsx` ("Imported history is summarised once by your own Claude, on your machine, for up to 5 recent requests") so it stays true.
3. **Core reads it.**
   - `short` and `goal`: live `map` first, then the recap's `map`, then the titles run, then Murmur's own fallback (below). `kind`: `map`, then titles (`kindInferred` false), then the guess.
   - `thread` and `follows` from the titles run; `SessionView.threads` from it (`inferred` false) when it has covered every request, else one thread per journey chapter (`inferred` true), and a request the run has not covered yet joins the thread of the request before it.
   - `SessionView.title` and `titledBy: "claude"` from the run's session title.
   - Journey chapters: when threads come from Claude, a chapter is a run of consecutive requests in the same thread, titled with the thread's title.
   - `activity` counts for every request, from its tool calls (see the doc comment).
4. **Murmur's own fallback, before Claude has titled a request** (this is also what every older session shows until a titles run reaches it):
   - A reply prompt (at most 4 words, or starting with a yes/ok/sure/go ahead/done/thanks/waiting style word, or only an image or pasted text) takes its `short` and `goal` from what the request ended with (`outcome`), cut at its first clause; else from the prompt as today.
   - `<pasted_content ...>` and `[Image #n]` never appear in `short`, `goal` or the session title.
   - A `short` never ends mid-phrase: if the first clause does not fit in 32 characters, back off to a whole phrase that reads complete, or end with "…" rather than stopping on "was", "without", "any" or "the".
   - A reply request `follows` the request before it.
   - The fallback session title skips bare replies ("yes"): use the first request whose prompt is not a reply.

## Quality bar

Run the dump script the author keeps locally (`/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/data/dump.mts`, run with `node --import ./reg.mjs dump.mts <session id> <out dir>` from that folder, writing to your own scratch folder, never into the repo) against sessions `8af212b5-3fb0-4f7c-8d39-20ac4bde9088` and `27a000a1-7dbc-4dd1-ab83-961149fc03ae`, and list every request's `short`, `goal` and thread before and after, with the fallback only.
Then run the titles run's prompt once for real on session `8af212b5`'s material in a dry mode that prints the parsed answer and uploads nothing, and paste its titles and threads into your report; judge them as the author would ("does this say what happened?"), and tune the prompt until they do.
Never let a test or a dry run write to the author's server, his `~/.config/murmur`, or a real session's queue.

## Tests (test first)

Instruction asks for `short`; titles schema (caps, ids must exist); titles input (scrubbing, pasted text and images reduced, caps); when the run triggers and when it must not (off, paused, debounce, nothing new, its own run); core precedence for `short`, `goal`, `kind`; threads from the run and the chapter fallback; chapters from threads; `follows`; `activity`; the reply fallback and the mid-phrase rule on the real examples above; the session title fallback.

## Checks, verification and git

The five checks (`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin`, `pnpm --filter @murmur/web -s build`), each exit code on its own; your own `pnpm install --frozen-lockfile` (never symlink `node_modules`, never commit it, never `git stash`).
Rebuild and commit `plugin/dist` (CI checks it).
To see the rail with your core, run `npx vite --port 5197 --strictPort` in your worktree's `web` folder (it proxies to the author's server on 8787; never restart or change that server), open `http://localhost:5197/auth/dev?login=Sarthak`, then the two sessions; save screenshots under `/private/tmp/claude-501/-Users-sarprasa/0a6793ec-2c27-46aa-8e1f-a9ddabe4552d/scratchpad/titles-*.png`.
Branch `feat/titles-threads`; copy this brief in and write `2026-11-10-murmur-titles-threads-report.md` beside it (one sentence per line); commit by pathspec, no `Co-Authored-By`, no em dashes; push early (the web builder merges your branch for real data) and again when done, open a PR, do not merge.
The web builder stays in `web/src`; you own `packages/core`, `plugin` and `WhatMurmurSends.tsx`.
