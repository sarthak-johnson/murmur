# Murmur reshape, the logic: phases own messages, beyond the plan, full cards, journey

Approved by the author on 9 Nov 2026 ("Yeah, go ahead and build it") after a full reshape proposal.
His words this answers: "one phase when I clicked has nothing to describe for, other live tracker one is not looking like the other one that is fully described", "where this session started and where it went", and, seen on his newest request, the plan reading 4 of 4 while Claude keeps working and every message landing under phase 1.

## Read first (local only, never commit them or copy their text into the repo: they hold the author's private work)

- `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/proposal.md`, section 7 (the ten logic changes) and the appendix (the numbers the screens use, so you can check your results against them).
- The mocks that consume this data: `/Users/sarprasa/Projects/murmur/reports/Murmur reshape/01-session-journey.html`, `02-request-running.html`, `05-task.html`, `06-task-thin.html` (PNGs beside them).
- `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/07-live-app-audit.md`.
- The real data: `/Users/sarprasa/Projects/murmur/research_notes/Murmur reshape/data/events-27a000a1.json` (19,669 events, 13 requests) and the view today's core builds from it, `view-27a000a1.json`. `dump.mts` beside them shows how core is run over them from a script (`node --import ./reg.mjs` style loader for the `.js` to `.ts` imports).

## What to build (`packages/core` only: `src/view/*`, `src/narration.ts` if a schema needs a field, and tests)

All pure and deterministic, from the session's events, all new fields optional on the types so older views still type-check.
Add every new field to `packages/core/src/view/types.ts` with a doc comment in the style already there.

1. **Phases own messages by time.**
   A phase's window runs from its first task's first event (the first event of any helper or narrate tied to that task) to the next phase's window start, or the request's end.
   `MessageView.phase` is the phase whose window holds the message; a message that names a task keeps `task`, and its `phase` is that task's phase.
   Messages before the first window belong to the first phase; messages after every plan task is done go to beyond (2), not to a phase.
2. **Beyond the plan.**
   When every task in the plan is done and events continue in the request, `RequestView.beyond = { since, agents: string[], messages: string[], rounds: number }` (helpers started and messages written after the moment the last plan task turned done, and fix rounds among those helpers).
   Unset when the plan is not all done or nothing followed.
3. **Request state and outcome.**
   `RequestView.state`: `"running" | "waiting" | "done" | "left-open" | "failed"`, derived from the last event and `finished`: waiting when the session's `needsYou` belongs to this request, running when it is the live request or a helper runs, left-open when a later request exists and plan tasks remain not done, failed when its last helper or step failed and nothing passed after, else done.
   `RequestView.outcome`: one or two sentences, the first sentence of the last message that reads as done (reuse the badge rules the web uses for "Done", move them into core if needed and have the web import them), else the first sentence of the last message, at most 240 characters cut at a word.
   `RequestView.waiting`: the questions Claude asked when it waits (from an `AskUserQuestion` call's questions, else the question sentences of its last message), as strings; unset when not waiting.
4. **Short title.**
   `RequestView.short`: 2 to 4 words.
   From a recap or narrate field `short` when present (add it as optional to the `map` input schema in `narration.ts` and to the plugin's recap prompt in `plugin/src/recap.ts` so new recaps write it; rebuild `plugin/dist` with `pnpm -s build:plugin` and commit it), else derived from `goal`: cut at the first comma, colon, " - " or " and then ", drop a leading verb only if what remains still reads ("Restyle the logged-in app" stays), then at a word boundary near 32 characters.
5. **Helper roles and rounds.**
   Parse each helper's `description` into `AgentView.role` (`"build" | "review" | "recheck" | "fix" | "plan" | "research" | "other"`), `AgentView.subject` (normalised task or item id: "Task 39", "Tasks 13-14", "B7"; reuse the id matcher in `infer.ts`) and `AgentView.round` (1 for the first build and review of a subject, n+1 for each "fix round n", "Re-review", "Fix" after a review).
   `TaskView.rounds` and `PartView.rounds`: fix rounds for that subject. `RequestView.helperCounts = { build, review, recheck, fix, other }` and `RequestView.sentBack`: subjects with at least one fix round.
6. **Full cards for every part.**
   When a part lacks `aim` or `steps`, fill them from the record and set `PartView.inferred = true`:
   - aim: the first sentence of the first builder's `brief`, else the first reviewer's; `doneWhen` from the last report verdict or the last done message about it ("Passed review after two fix rounds").
   - steps: one per helper start and report in time order (labels "Built", "Reviewed", "Sent back", "Fixed", "Passed", from role plus verdict), plus Claude's messages in the part's window that name it.
   - span: `PartView.span = { start, end? }` from its first and last event.
   - file roles: when no role was narrated, group by path (tests, styles, docs, config, source) into `FileTouch.role`.
   A narrated part keeps every narrated field as is; only missing fields are filled.
7. **Journey.**
   `SessionView.journey = { chapters, pauses, decisions, totals }`:
   - chapters: group consecutive requests that share task numbers, phase names or a plan; each `{ title, requestIds, state }`, title from the shared phase or plan name, else the first request's short title. Aim for 3 to 7 chapters on the real session; check what you get against the proposal's five.
   - pauses: gaps over one hour between a request's last event and the next request's first, and gaps over one hour inside a request; each `{ after: requestId, from, to, inside: boolean }`.
   - decisions: messages that read as a decision (badge rule) whose subject is a style, a plan or an approval, plus a user prompt that approves ("go ahead", "let's build it", "yes please"); each `{ ts, requestId, text }` with text one short sentence.
   - totals: helpers, distinct files, commands, tasks sent back, pauses.
8. **Now line never raw.**
   `NowView.text` from an inferred tool call: a Bash call uses its `description`, else "Running a command"; an MCP tool gets a plain phrase from a small map (browser tools "Looking at the browser", background job tools "Watching a background job", unknown "Using <server name>"); `Read` "Reading <file name>", `Edit`/`Write` "Editing <file name>", `Grep`/`Glob` "Searching the code", `Agent` "Starting a helper: <description>". Narrated `now` always wins. Keep the raw command reachable as `NowView.detail`.
9. **New since you last looked.**
   A pure helper `keyMoments(request, lastLooked?)` returning up to five `{ ts, mark: "done" | "problem" | "fixing" | "decision" | "plan", text, task?, new: boolean }` from messages, reports and plan changes, newest last; the web brief (phase 2) will render it.

## Out of scope

`web/src` (another builder is reshaping the web shell in parallel; do not touch it, except moving the badge rules into core and changing the web's import of them, which you coordinate by keeping the old export name working).
Server and hook behaviour, other than the recap prompt and schema field in 4.

## Tests (test first)

Unit tests on small hand-made event lists in the real shape for each of 1 to 9, including: a narrated request unchanged except for new fields, an inferred request, a recap request, a request with no plan, beyond appearing only after the last task is done, state for each value, short title fallbacks, round parsing for "Implement Task 2", "Review Task 2 (spec + quality)", "Re-review Task 1 fix round 1", "Fix B7: ...", "Tasks 13-14", chapter grouping, pauses, the Now phrases.
Then run core over the real `events-27a000a1.json` in a scratch script (in the scratchpad, not committed) and paste into the report, per request: short title, state, outcome, phase message counts (before and after), beyond, sentBack, helperCounts, and for request 13 and request 9 the filled aim and step labels of two parts; then the journey's chapters, pauses and decisions.
Check reduce time over the full 19,669 events stays under 1.5 s and report it (today's time first).

## Checks before you report

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build`, each with its exit code checked on its own.
Your worktree needs its own install: run `pnpm install --frozen-lockfile` in it; never symlink `node_modules` from the main checkout and never commit `node_modules`.
If `plugin/dist` changes, commit it (CI checks it matches the source).

## Git

Work on branch `feat/reshape-logic`.
Copy this brief into the branch at `docs/superpowers/plans/2026-11-09-murmur-reshape-logic.md` and write your report beside it as `2026-11-09-murmur-reshape-logic-report.md` (one sentence per line).
Commit with `git commit -- <paths>`; no `Co-Authored-By` line, no em dashes anywhere (use "-").
Push the branch and open a PR to `main` with `gh pr create`; do not merge.
