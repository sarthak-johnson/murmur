# Murmur: requests Claude never narrated still tell their story

Reported by the author on 7 Nov 2026, with a screenshot of an imported request.

## The problem, as the author sees it

Most of an imported session looks empty.
A request from before Murmur was on (or one where Claude never called `map`) shows:

- the map: one huge node with the prompt cut off, and "The map appears when Claude describes the parts of this work." in large grey text;
- the plan: "The plan appears when Claude lays out its steps.";
- a NOW card ("Editing tradara-inapp-style-revamp.md") on a request that finished days ago;
- "Files touched": a long list of absolute temp paths (`/private/tmp/claude-501/-Users-.../scratchpad/style/a/style.css`) broken in the middle of words, one after another down the page.

Clicking a phase or part shows "Claude is yet to describe" even for work that was done.
In his words: "Most of the imported data looks like this, so empty. Nothing appears, no plan, no map."

The real session (id `27a000a1-7dbc-4dd1-ab83-961149fc03ae`, 7,044 events, on the local server) has the material to tell the story; it is just not used.
Per request it has, for example:

- "I think we need to revamp from the style itself": 206 tool calls, helpers "Build style A, lit plate", "Build style B, departure board", "Build style C, quiet", 19 Writes, 30 Edits.
- "Yes please go ahead": 1,039 tool calls, 32 helpers: "Implement Task 1: Lit plate tokens", "Review Task 1 (spec + quality)", "Re-review Task 1 fix round 1", "Implement Task 2: HeroMoney", "Review Task 2 (spec + quality)", ...
- "Please track it in more detailed for each phase as well bro": helpers "Review Task 12 (spec + quality)", "Review bug B1 fix", "Fix B7: agent money speed", "Implement Tasks 13-14: book plate, agent cards", "Re-review Tasks 13-14 fix round", ...

A copy of all its events (the server's `/api/sessions/:id/events` pages joined) is at `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/events.json`; use it to check results, never commit it (it is the author's private work).

## Goal

Every request that did work shows a plan, a map and parts, built from what Claude did, and marked `inferred` with the existing tag.
A request with a valid `map` call keeps today's path exactly; nothing here changes it.

## Rules (in `@murmur/core`, pure and deterministic, from the request's events only)

Apply when the request has no valid map call (`planInferred` today).

1. **Parts from helpers.**
   Each `Agent` tool call (PreToolUse `tool_input.description`, `subagent_type`) is one helper run.
   Runs about the same subject become one part:
   - The subject id is the first match of a task or item id in the description, such as `Task 12`, `Tasks 13-14`, `B7`, `bug B1` (normalise case, `bug B1` and `B1` are the same).
   - Runs with no id are their own part each.
   - The part's title is the description of the first run that is not a review, with a leading work verb (Implement, Build, Draft, Write, Fix, Add, Research, Investigate) removed; if every run is a review, the first run's description with its verb removed.
     Examples: "Implement Task 1: Lit plate tokens" becomes "Task 1: Lit plate tokens"; "Build style A, lit plate" becomes "Style A, lit plate" (capitalise the first letter).
   - Each run is a step on the part, in order, with a short label from its verb ("Built", "Reviewed", "Re-reviewed", "Fixed", "Drafted"; otherwise the description) and status running / done / failed from the existing agent tracking (`view/agents.ts`).
   - The part's files are the Edit and Write touches made inside its helpers (events carry `agent_id`); its `agents` are its runs.
   - Status: done when all its runs finished, now when one is running, failed only if its last run failed.
2. **Main-thread changes.**
   Files the main thread (no `agent_id`) changed with Edit or Write are grouped by folder (the file's directory relative to the project, see rule 6); each folder is one part titled by the folder ("web/src/live", "scratchpad/style/a"), its files those touches.
   Folders with one file merge into their parent folder's part when the parent has one, so the map does not fill with one-file parts.
   Cap at 6 such parts; the rest of the files stay in `looseFiles`.
3. **Plan.**
   Keep the existing TaskCreated / TaskCompleted inference when it finds tasks.
   Otherwise one inferred phase, "What Claude did", whose tasks are the parts in the order they started, each task linked to its part, status from the part.
4. **Map.**
   The map draws these parts like any other: request in the middle, parts around it.
   Two parts that changed the same file are linked with the label "same files".
   The empty-state text shows only when there are no parts at all.
5. **Finished requests.**
   A request is finished when a later request exists or the session ended.
   Its NOW card becomes a DONE card: "Done", with one line of what happened, for example "3 helpers, 19 files changed, 51 commands run", and no stale "Editing x" line.
   A running request keeps today's NOW card.
6. **Paths people can read.**
   Everywhere a file path shows (NOW card files, part detail, map), show it relative to the project folder (`view.cwd`); a path outside the project shows from the first folder that says something to a person: drop `/private/tmp/claude-*/<project-slug>/<session-id>/` and similar temp prefixes, otherwise `~/` for home, keeping the last 3 segments ("scratchpad/style/a/style.css").
   The full path is the element's `title`.
   Long paths break only after a `/`, never mid-word.
7. **Files touched lists.**
   Show at most 8, newest first, then a "Show all N" toggle.
   The counts (+117 −2) stay on the same line as the name when it fits.

## Out of scope

Calling an LLM, reading assistant text replies, changing what the plugin sends, and changing the narrated path.
Note in the report anything that would make history richer (for example Claude's reply text at Stop) as a follow-up.

## Tests (test first)

- Core unit tests on small hand-made event lists in the real shape: helpers grouped by `Task N` / `Tasks N-M` / `B7` / `bug B1`, titles with verbs removed, review steps on the same part, runs with no id kept apart, main-thread folder parts with the one-file merge and the cap of 6, the "same files" link, the single inferred phase, TaskCreated inference still winning, a request with a map unchanged (existing tests stay green), finished vs running.
- Path display unit tests: inside the project, a `/private/tmp/claude-501/.../scratchpad/...` path, home, a short absolute path.
- Web tests for the DONE card, the "Show all N" toggle, and the map empty state only without parts.
- Run the reducer over `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/events.json` in a scratch script (not committed) and paste into the report, per request: part titles, their step counts and file counts, and the phase's task list.

## Checks before you report

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build`, each with its exit code checked on its own.
Then look at the real page yourself: the local server runs at http://localhost:8787 (dev login: open `http://localhost:8787/auth/dev?login=Sarthak` first), session `/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae`; it serves `web/dist` fresh on each request, so a web build is enough, no restart.
Screenshot at 1440 x 900 three requests: "I think we need to revamp from the style itself", "Yes please go ahead" and the newest one (narrated, must look as before), plus one part detail of an inferred part.
Be picky: nothing cut off mid-word, no empty boxes, nothing overlapping, consistent spacing with the rest of the page.
Save the screenshots under `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/inferred-*.png` and list them in the report.
