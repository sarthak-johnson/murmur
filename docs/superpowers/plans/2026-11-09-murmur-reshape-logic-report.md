# Murmur reshape, the logic: report

Built on branch `feat/reshape-logic` from the brief beside this file.
Everything is in `packages/core`, plus the recap prompt (`plugin/src/recap.ts`), the rebuilt `plugin/dist`, one plugin test helper and a two-line re-export in `web/src`.

## What core now gives

- `MessageView.phase`: the phase a message belongs to, by time, or unset after the plan was done.
- `RequestView.beyond`: work after every plan task turned done, with its helpers, messages and fix rounds.
- `RequestView.state`, `outcome` and `waiting`.
- `RequestView.short`, from the map's new optional `short` field or cut from the goal.
- `AgentView.role`, `subject` and `round`; `TaskView.rounds`, `PartView.rounds`, `RequestView.helperCounts` and `sentBack`.
- Full cards: a part with no aim or steps gets them from the record and `PartView.inferred`; every part gets `span`; part files with no narrated role get a path group and `roleInferred`.
- `SessionView.journey`: chapters, pauses, decisions and totals.
- `NowView.text` is never raw any more, and `NowView.detail` keeps the command or tool name.
- `keyMoments(request, lastLooked?)`, exported from core.
- The story's badge rules (`moment`, `firstSentence`, `plainText`) moved into core; `web/src/story.ts` and `web/src/markdown.tsx` re-export them under their old names, so no web import changed.

Every new field is optional and documented in `packages/core/src/view/types.ts`.
New code: `view/moments.ts` (badge rules, `keyMoments`), `view/rounds.ts` (roles, subjects, rounds), `view/shape.ts` (phases, beyond, state, outcome, short, cards) and `view/journey.ts`.

## Decided differently from the brief, and why

1. Phase windows run from a phase's first to its last tied event, and the narrowest window holding a message wins; only a message outside every window falls back to the brief's rule (the phase begun last).
   On the real data, phases run side by side: in request 13 the tracker work sits inside the Task 39 work, and with "first event to the next phase's first event" the Task 39 messages landed under the tracker.
2. Messages are not a window signal.
   Claude names a task when it lays out the plan ("then one page to compare them"), which opened request 4's last phase at its first minute and pulled 9 of 11 messages into it.
   A message that names a task still joins that task's phase.
3. `beyond` needs work after the plan was done (a tool call or a helper start), not only a closing message, or nearly every narrated request would have one.
   Its `agents` also holds helpers started earlier that keep working after it: request 13's Task 38 builder is exactly the work that continues after "4 of 4".
4. A recapped request never gets `beyond`: the recap's narrates sit a millisecond after the prompt, so their times say nothing.
   For the same reason windows, spans and the failed check read only real events.
5. Filled steps also take live narrates that name the part (Claude's `now` line).
   Without them request 13's tracker part, which has no helper, would stay empty, which is the complaint this fixes.
6. Real helper briefs open by casting the helper ("You are building Task 39 of ...: the chat's styles and small parts."), so the aim is what follows the colon; a planner's brief counts like a builder's.
7. An inferred aim carries `aim.inferred`, and the plugin's refresh now writes Claude's aim over an inferred one (it used to write one only where none existed, so a filled aim would have blocked Claude's better one).
   A plugin test covers it.
8. `FileTouch.roleInferred` marks a path group, so the web can tell it from Claude's words; loose files keep no role.
9. Steps of a helper still running read "Building", "Reviewing", "Fixing" rather than a past tense.
10. A subject is also "Phase N" when no task or bug id is named, so "Phase 1 review", "Fix Phase 1 review findings" and "Re-review Phase 1 fix round" form rounds; "Task 18a" is now read too, also by the inferred plan's grouping.
11. A part's messages include those whose first sentence leads with its subject, so "Task 39 ... is done after two rounds of fixes" counts for Task 39 even though it goes on to mention Task 38.
12. Chapters also read task numbers from helper names (not phases from them), and when both sides name phases the phase decides; that is what keeps requests 9 to 11 together and splits 11 from 12.
13. Decisions carry `by: "claude" | "user"`.
14. `journey.totals.files` counts distinct paths across the session (477); the proposal's 527 is the sum of per-request counts.
15. The short title drops bracketed asides and only drops filler verbs ("Start", "Resume"), since dropping "Compare" or "Restyle" loses the meaning.
16. The outcome skips Claude Code's own "API Error" lines.
17. One plugin test helper (`plugin/test/refresh.test.ts`) now reads only narrated steps, since a part without them shows filled ones.

## The real session, before and after

Session 27a000a1, 19,669 events, 13 requests.
Messages are per phase in plan order; "before" stacks every message that names no task under the first phase, as the web did.
Helpers are build, review, recheck, fix, other.

| # | Short title | State | Messages before | Messages after | Beyond | Sent back | Helpers |
|---|---|---|---|---|---|---|---|
| 1 | Compare tradara.in's UI | done | 3/0 | 3/0 | - | 0 | 0/0/0/0/0 |
| 2 | Review the internal pages | left-open | 2/0 | 2/0 | - | 0 | 0/0/0/0/0 |
| 3 | Review the inside | done | 8/0/0 | 6/0/2 | - | 0 | 0/0/0/0/0 |
| 4 | Revamp the logged-in app's look | done | 9/0/2 | 3/5/3 | - | 0 | 3/0/0/0/0 |
| 5 | Redesign the other app screens | done | 14/2/0/0/0/0 | 4/3/0/4/1/4 | - | 0 | 0/0/0/0/4 |
| 6 | Build the Lit plate redesign | left-open | 6/0 | 6/0 | - | 0 | 0/0/0/0/0 |
| 7 | Restyle the logged-in app | left-open | 82/2 | 81/3 | - | 10 | 11/10/10/1/0 |
| 8 | Track every phase | done | 46/7/1 | 4/26/24 | - | 6 | 2/6/8/2/1 |
| 9 | Phase 2 | left-open | 113/0/0 | 1/5/107 | - | 18 | 19/18/20/0/2 |
| 10 | Continue the agent pages work | left-open | 2 | 2 | - | 0 | 0/0/0/0/0 |
| 11 | Estimate time left | left-open | 4 | 4 | - | 0 | 1/1/0/0/0 |
| 12 | Phase 3 | left-open | 38/0 | 35/3 | - | 4 | 3/3/4/1/3 |
| 13 | Restart the two stopped Phase 3 | running | 6/0 | 3/2 | since 15:12 UTC: the Task 38 builder, 1 message, 0 rounds | 1 | 1/1/1/0/0 |

Request 7's messages stay under Phase 0 because Phase 1 only began in its last half hour, which is what happened.

Filled cards: request 13's three parts now have steps (2, 11 and 3), two have an aim read from a builder's or reviewer's brief, and Task 39's done-when comes from Claude's closing message.
Request 9's parts are filled too; its plan put 57 helpers on one part, so that card lists all of them (63 steps) and has no aim, since they span 18 subjects.

Journey: five chapters, the proposal's five.

| Chapter | Requests | State |
|---|---|---|
| Compare tradara.in's UI | 1 to 3 | done |
| Revamp the logged-in app's look | 4 to 5 | done |
| Phases 0 and 1 | 6 to 8 | done |
| Phase 2: the agent page | 9 to 11 | left-open |
| Phase 3 | 12 to 13 | running |

Pauses: 7, two between requests (90.3 h after request 5, 11.7 h after request 9, the network drop) and five inside requests (2.6 h and 1.4 h in 8, 1.5 h in 9, 5.4 h and 22.8 h in 12).
Decisions: the two approving prompts that start requests 6 and 7; no message by Claude matched the decision badge with a style, plan or approval subject.
Totals: 135 helpers, 477 distinct files, 7,269 commands, 38 subjects sent back, 7 pauses.

## Known limits

- A short title cut near 32 characters backs off to before its last article, preposition or conjunction ("Track every phase"), never under two words, so one with no such word can still end mid phrase ("Restart the two stopped Phase 3"); maps and recaps written from now on carry their own `short`.
- Task 39's second fix round was done by messaging the builder, not by a new helper, so it shows one fix round, not two.
- `running` for the last request rests on its last main-thread event not being a Stop; a session closed without a SessionEnd reads as running until the web compares the last event with the clock.

## Reduce time over the 19,669 events

Before: about 110 to 250 ms a run.
After: about 130 to 220 ms a run, on the same machine with other builds running; the new passes cost about 20 to 30 ms.
The pause scan parsed every timestamp twice and now parses each once.

## Checks

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test` (core 291, plugin 208, server 129, web 274), `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build` each exit 0.
