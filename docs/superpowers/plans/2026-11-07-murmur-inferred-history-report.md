# Report: requests Claude never narrated still tell their story

Brief: [2026-11-07-murmur-inferred-history.md](2026-11-07-murmur-inferred-history.md).
Branch `fix/backfill-whole-transcript`, not pushed.

## Commits

- `e73c356` feat: requests Claude never mapped still show a plan, a map and parts
- `196fe64` fix(web): map chip stacks never cover each other, cut labels end at a word
- `a353f19` fix: a background task's notification is not a request or a title
- `f7307e2` chore: clear the two lint warnings on main
- `deb31f4` fix(web): a map label too long for its box ends at a dash, not mid-word
- `356b19c` fix(web): a map link label looks further from its curve for a clear spot

## What changed, by file

### Core (`packages/core`)

- `src/view/history.ts` (new): `inferHistory`, run once after every request is reduced, only for `planInferred` requests.
  It builds helper parts (rule 1), main-thread folder parts with the one-file merge and the cap of 6 (rule 2), the "same files" links (rule 4) and the single "What Claude did" phase when TaskCreated found nothing (rule 3).
  It also sets `tally` (helpers, distinct files changed, commands run) on every request.
- `src/view/files.ts`: `touchOf` and a new `addTouch` are exported so history reuses the exact touch counting; new `displayPath(path, cwd)` (rule 6).
- `src/view/agents.ts`: `applyAgents` now returns which Agent call (`tool_use_id`) started which subagent, so a run's status comes from the existing agent tracking.
- `src/view/types.ts`, `src/view/requests.ts`: `RequestView` gains `finished` and `tally`.
- `src/view/reduce.ts`: sets `finished` (a later request exists or the session ended) and calls `inferHistory`.
  `isOwnCommand` became `isNotRequest` and also matches `<task-notification>` prompts (see "Found along the way").
- `src/index.ts`: exports `displayPath`.
- `test/history.test.ts` (new), `test/reduce.test.ts` (one test added).

### Web (`web`)

- `src/files.tsx` (new): `PathText` (display path, full path as `title`, a `<wbr>` after every `/`) and `FileList` (8 newest first by latest event, then "Show all N" / "Show fewer").
- `src/live/NowCard.tsx`: a finished inferred request shows a green "Done" card with one line, for example "3 helpers, 20 files changed, 51 commands run" ("Nothing changed" when all are zero), and no "Helpers running" block.
  A running request, and every narrated request, keep today's Now card.
- `src/pages/Session.tsx`: passes `view.cwd` and the session events down to the Now card.
- `src/part/PartDetail.tsx`: "inferred" tag next to the title of a part in an inferred request; files use `PathText` and `FileList`.
- `src/map/MapView.tsx`: chip stacks avoid earlier stacks; cut labels end at a word or dash, cut paths keep their last folders ("…/style/shared"); link labels try 32 and 48 px off the curve after the nearer spots.
- `src/theme.css`: Done card colours, file rows keep counts on the name's line (no wrap; the path shrinks and breaks after a slash), `.show-all`.
- `test/live.test.tsx`, `test/part.test.tsx`, `test/map.test.tsx`: new tests; the `RequestView` builders gained `finished` and `tally`.

### Server and plugin

- `server/src/ingest.ts`: uses `isNotRequest`, so a task notification is never a session title; `server/test/ingest.test.ts` has one new test.
- `server/src/sessions.ts`, `plugin/src/backfill.ts`, `plugin/dist/hook.cjs`: the two lint warnings that were already on the branch (unused import, comma operator), dist rebuilt.
  Core's view code is not in the plugin bundle, so the feature itself did not change `plugin/dist`.

## Choices worth knowing

- Rule 1 ids: `Task N`, `Tasks N-M` (singular and plural are the same id), and a letter plus digits, optionally after `bug` (`B7`, `bug B1`, `b1` are one id).
  `Phase N` is not an id, as the brief lists it; see "Left or uncertain".
- A step label is "Built" for Implement and Build, "Reviewed", "Re-reviewed", "Fixed", "Drafted"; any other run's step is its description.
- A run is done when its subagent stopped, when its call returned (not launched in the background), or when the request is finished and the subagent did nothing after it.
  The last case matters: the imported history has no SubagentStop for "Build style A/B/C", so without it the 4-day-old request showed three helpers "in progress".
  A helper still active after the next prompt (Task 12 and bug B1 ran into the next request) keeps running until it stops.
- A helper's Edit and Write touches go to its part even when they land after the next prompt; the later request does not list them again.
- A failed last run marks the task `failed`; the part itself is `done`, since `PartView.status` has no failed state.
- Folder parts are always `done` (the change was made); the Now card covers what is current.
- Files directly in the project root stay in "Files touched", so the existing file tests keep their shape.
- Rule 6 also drops `~/.claude/projects/<slug>/` (Claude's memory folder shows as `memory/...`) and `.claude/worktrees/<name>/` inside the project (worktree files read as project paths).
- The Done card shows only for inferred requests, as the brief scopes its rules to requests with no valid map call.
  Older narrated requests still show their last Now line.
- `AgentView.part` is not set for inferred parts: an existing test pins the exact agent object, and the part's `agents` list already carries the link.

## Tests, RED then GREEN

| Suite | RED | GREEN |
| --- | --- | --- |
| core `history.test.ts` (new, 27 tests) | 25 failed, 2 passed (the map guard and the empty-request guard pass by design) | 27 passed |
| core `reduce.test.ts`, task notification (1 test) | 1 failed | passed |
| web: Done card, Done line, Show all, part detail paths (4 tests) | 4 failed; 3 guards passed (keep Now card, 8 or fewer files, map empty line only without parts) | 7 passed |
| web map: chip stacks, word cuts (2 tests) | 2 failed | passed |
| web map: dash cut (1 assertion added) | failed | passed |
| web map: link label in a crowded grid (1 test) | failed with the old offsets | passed |
| server `ingest.test.ts`, task notification title (1 test) | 1 failed | passed |

Totals now: core 196, plugin 110, server 92, web 105, all passing (before: core 168, plugin 110, server 91, web 95).
No existing test was changed except the two web `RequestView` builders, which gained the two new required fields.

## Checks

Each run on its own, after the last commit:

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 0 (no warnings) |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 |
| `pnpm -s build:plugin` | 0 (no diff in `plugin/dist`) |
| `pnpm --filter @murmur/web -s build` | 0 |

## The reducer over the real events

From a scratch script outside the repo, over `events.json` (7,126 events).
Per request: part titles with status, step count and file count, then the phase's task list.
`loose` is what stays in Files touched.

```
## "I think we need to revamp from the style itself, I don't like it now"
planInferred=true finished=true tally={"helpers":3,"files":20,"commands":51} loose=0
- scratchpad/style/shared [done] steps=0 files=2
- Style A, lit plate [done] steps=1 files=5
- Style B, departure board [done] steps=1 files=5
- Style C, quiet [done] steps=1 files=5
- scratchpad/style [done] steps=0 files=1
- memory [done] steps=0 files=2
  phase "What Claude did" [done]: scratchpad/style/shared (done) | Style A, lit plate (done) | Style B, departure board (done) | Style C, quiet (done) | scratchpad/style (done) | memory (done)

## "Like the Lit plate one, can we do for other screens in the artifact as"
planInferred=true finished=true tally={"helpers":4,"files":83,"commands":111} loose=0
- scratchpad/style/a [done] steps=0 files=3
- scratchpad/style/shared [done] steps=0 files=2
- Lit plate: Portfolio, Screener, Stock [done] steps=1 files=15 links=dir:scratchpad/style/a
- Lit plate: chat and Library screens [done] steps=1 files=27
- Lit plate: News, Watchlist, Settings, panels [done] steps=1 files=20
- Lit plate: rest of agent page, variants [done] steps=1 files=12
- scratchpad/style [done] steps=0 files=3
- memory [done] steps=0 files=2
  phase "What Claude did" [done]: scratchpad/style/a (done) | scratchpad/style/shared (done) | Lit plate: Portfolio, Screener, Stock (done) | Lit plate: chat and Library screens (done) | Lit plate: News, Watchlist, Settings, panels (done) | Lit plate: rest of agent page, variants (done) | scratchpad/style (done) | memory (done)

## "I love it, let's build it"
planInferred=true finished=true tally={"helpers":0,"files":2,"commands":13} loose=0
- docs/superpowers/plans [done] steps=0 files=1
- memory [done] steps=0 files=1
  phase "What Claude did" [done]: docs/superpowers/plans (done) | memory (done)

## "Yes please go ahead"
planInferred=true finished=true tally={"helpers":32,"files":29,"commands":807} loose=0
- docs/superpowers/plans [done] steps=0 files=1
- Task 1: Lit plate tokens [done] steps=3 files=0
- scratchpad/tracker [done] steps=0 files=1
- memory [done] steps=0 files=1
- Task 2: HeroMoney [done] steps=3 files=0
- .superpowers/sdd/2026-11-06-lit-plate [done] steps=0 files=2
- Task 3: dot field and plate [done] steps=3 files=3
- Tasks 4-5: surfaces, controls [done] steps=3 files=0
- Task 6: app frame [done] steps=3 files=1
- Task 7: the rail [done] steps=3 files=1
- Task 8: the top bar [done] steps=3 files=0
- Task 9: dock and floating panels [done] steps=3 files=4 links=task:6
- Task 11: one gain/loss colour [done] steps=3 files=0
- Task 10: shell screenshot sweep [done] steps=2 files=3
- Phase 0 review against prototype [done] steps=1 files=0
- Task 12: fast agent list [done] steps=1 files=5
- Bug B1: closed trades disagree [done] steps=1 files=8
  phase "What Claude did" [done]: docs/superpowers/plans (done) | Task 1: Lit plate tokens (done) | scratchpad/tracker (done) | memory (done) | Task 2: HeroMoney (done) | .superpowers/sdd/2026-11-06-lit-plate (done) | Task 3: dot field and plate (done) | Tasks 4-5: surfaces, controls (done) | Task 6: app frame (done) | Task 7: the rail (done) | Task 8: the top bar (done) | Task 9: dock and floating panels (done) | Task 11: one gain/loss colour (done) | Task 10: shell screenshot sweep (done) | Phase 0 review against prototype (done) | Task 12: fast agent list (done) | Bug B1: closed trades disagree (done)

## "Please track it in more detailed for each phase as well bro"
planInferred=true finished=true tally={"helpers":19,"files":33,"commands":1157} loose=0
- scratchpad/tracker [done] steps=0 files=1
- memory [done] steps=0 files=1
- Task 12 (spec + quality) [done] steps=3 files=0
- Bug B1 fix [done] steps=2 files=0
- Tasks 13-14: book plate, agent cards [done] steps=3 files=0
- B7: agent money speed [done] steps=3 files=5
- .superpowers/sdd/2026-11-06-lit-plate [done] steps=0 files=1
- Task 15: My Agents page [done] steps=4 files=18
- Phase 1 review: My Agents [done] steps=1 files=1
- Phase 1 review findings [done] steps=1 files=6
- Phase 1 fix round [done] steps=1 files=0
- Phase 1 small follow-ups [done] steps=1 files=0
  phase "What Claude did" [done]: scratchpad/tracker (done) | memory (done) | Task 12 (spec + quality) (done) | Bug B1 fix (done) | Tasks 13-14: book plate, agent cards (done) | B7: agent money speed (done) | .superpowers/sdd/2026-11-06-lit-plate (done) | Task 15: My Agents page (done) | Phase 1 review: My Agents (done) | Phase 1 review findings (done) | Phase 1 fix round (done) | Phase 1 small follow-ups (done)

## "continue with the work"
planInferred=false finished=false tally={"helpers":2,"files":6,"commands":225} loose=0
- feat/lit-plate integration branch [todo] steps=0 files=0
- Inventory of every agent page element [now] steps=0 files=3
- Phase 2 section of the plan [todo] steps=0 files=0 links=inventory
- Live tracker rows for Phase 2 [todo] steps=0 files=0 links=plan
- Agent page rebuilt on Lit plate parts [now] steps=0 files=3 links=plan
  phase "Housekeeping" [todo]: Bring the latest staging into the redesign branch (todo)
  phase "Plan Phase 2" [now]: Read the agent page prototypes and today's agent page (now) | Write the Phase 2 task list into the plan (todo) | Add Phase 2 tasks to the live tracker (todo)
  phase "Build Phase 2" [now]: Dispatch the first builder and review its work (now)
```

Notes on the numbers:

- "Task 1", "Task 2", "Tasks 4-5", "Task 8" and "Task 11" show 0 files because their helpers changed files only through Bash (`sed -i`, `python3 -`, `cp`), never Edit or Write; that is the data, not a miss.
- "Bug B1 fix" and "Task 12 (spec + quality)" in the fourth request are the review rounds; the implementing runs started in the third request and sit there with their files.
- The newest request is narrated and comes out exactly as the map path builds it.

## Screenshots

All at 1440 x 900, from the local server after `pnpm --filter @murmur/web -s build`:

- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/inferred-revamp.png`: "I think we need to revamp from the style itself".
  Checked: Done card "3 helpers, 20 files changed, 51 commands run", no stale "Editing" line, no helpers block; phase strip "What Claude did 6 of 6"; map with 6 parts around the request, chip stacks apart, labels cut at words ("…/style/shared", "Style B, departure…").
- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/inferred-go-ahead.png` and `inferred-go-ahead-full.png` (full page): "Yes please go ahead".
  Checked: 17 parts, 8 in the ring and 9 in the grid below, "+1 more" chips, the "same files" link from Task 9 to Task 6 with its label clear of every chip and box (measured with `getBBox`: 0 overlaps, it was 2 before the last fix).
- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/inferred-newest-narrated.png`: the newest request, narrated.
  Checked: same plan, phases, Now card, helpers and assumptions as before; the only visible change is map labels ending at a word.
- `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/inferred-part-task15.png` and `inferred-part-task15-all.png`: part detail of "Task 15: My Agents page" (inferred), before and after "Show all 18".
  Checked: "inferred" tag, four steps (Built, Reviewed, Re-reviewed, Re-reviewed), four helpers with briefs, worktree prefix gone (`frontend/src/...`), counts on the same line as each name, nothing cut mid-word.

## Found along the way

- When a background helper finishes, Claude Code submits a `<task-notification>` prompt.
  It arrived on the real session while I worked and became a new request at the top of the list, so the page opened on it instead of the narrated request, and it could become a session title.
  Fixed in `a353f19`: its events stay with the request before.
- Two lint warnings were already on the branch; cleared in `f7307e2`.

## Left or uncertain

- Phase-level helpers ("Phase 1 review: My Agents", "Fix Phase 1 review findings", "Re-review Phase 1 fix round") stay separate parts because `Phase N` is not in the brief's id list.
  Adding `Phase N` as an id would fold them into one part; I left it for the author to decide, since "Draft Phase 2 plan" would then join the Phase 2 work too.
- Files changed only through Bash do not count anywhere (brief scope is Edit and Write).
  Reading `git commit` output or Bash `tool_response` could fill this in.
- With many helper parts the map is busy: every part shows up to two agent chips plus "+N more", and the chip text repeats the part title ("Agent 7: Implement Task…").
  For inferred parts the chips could show the step label instead, or be left out since the part detail lists the helpers.
- The inferred Now line for a running request still cuts a long command at 60 characters ("Running cd /Users/.../.claude/worktrees/"); unchanged, as it is outside this brief.
- Older narrated requests keep their last Now line; the Done card could cover them too if the author wants it.
- Follow-ups that would make history richer: Claude's reply text at Stop (a one-line "what happened"), the subagent's `last_assistant_message` as the step text, and TodoWrite or TaskCreate payloads when present.
