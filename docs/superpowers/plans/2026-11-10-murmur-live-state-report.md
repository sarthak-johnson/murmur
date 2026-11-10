# Murmur live state: report

Branch `fix/live-state`, brief `2026-11-10-murmur-live-state.md`.

## Reproduced first

Each bug was reproduced on the real session with the dump script's events, reduced by this branch's core and cut at a past moment to read as it did live.
The page was shot with those events served to the browser and the clock held at that moment.

## Request 7, before and after

Times are for the events up to 21:10 IST, with both helpers running and the ask standing, unless said otherwise.

| | Before | After |
| --- | --- | --- |
| Session `needsYou` | null | input: "Sign in to ElevenLabs in the Chrome tab I opened" |
| Request state | running | waiting |
| Phase Mockup | todo | now |
| Phase Voice | now | blocked |
| Phase Video | todo | todo |
| t1, t2 | done | done |
| t3 Scenes 1-4 | todo | now (done once narrated at 21:17) |
| t4 Scenes 5-7 | todo | now |
| t5 | todo | todo |
| t6 ElevenLabs | failed | blocked, with the ask, 21:03 and Claude's message |
| t7, t8 | todo | todo |
| Helper "Build demo scenes 1, 2, 4" | no part, no task | part `scenes`, task t3 |
| Helper "Build demo scenes 3, 5, 6, 7" | no part, no task | part `scenes`, task t4 |
| Eight scene files | under "Script vs product check" | under "Seven scene files" |
| `s6-desk.js`, `s7-ledger.js` | "Seven scene files" | "Seven scene files" |
| `engine.js`, `data.js` | outside any task | "Player shell" (a narrated `~/` path now matches) |
| Message asking to sign in | Mockup | Voice |
| NOW line | the helper's action, no owner | "Demo scenes 1, 2, 4: " before the same action |
| Journey tiles | included "0 tasks sent back" and "0 pauses" | zeros left out |

## Decisions

A helper ties, in order, to the subject its description names, then the one task its words match, then the one part they match, then the task Claude was on.
That last fallback is dropped when Claude's latest narrate said the task was done or blocked.
Without that rule a status-check narrate pulls a later helper onto a finished task.
Two tasks matching equally tie the helper to neither; if they share a part, it ties to that part alone.

Only an ask raised at the end of Claude's turn leads "Where it stands" and leaves the amber panel.
Permission prompts and dialog questions stay in the panel, as before.

Claude's own tool calls still clear the ask, as they clear every needs-you today.
So while Claude works after a helper's report the request reads running, and it reads waiting again at its next Stop if it still asks.

`questionsIn` moved from the web to core, so core raises needs-you with the same cautious reading the page already used.

A helper's permission prompt shows over a standing ask and the ask returns once it clears.
Without this the real session lost its ask at 21:08, when a helper asked for permission.

## The 44-request session

No request is newly waiting, and `needsYou` is still null.
Request 41 went from failed to done: it was only marked failed because it waited on the author's pick.
Request 42's last task is blocked, not failed, and reads left open because a later prompt moved on.
Request 43's six research helpers now sit on their own tasks, and six files that were on the wrong part moved to the right one.
One helper in request 44 now stands on its own, because Claude's latest narrate had called its task done.
Its four files moved from that task's part to outside any task, the one change that reads worse, and the brief's rule asks for it.

## Merged with `feat/tasks-list`

Merged at `b2da9f8`.
Its web-side "Partly done" phase and its phase-line workaround are removed, because core now says it.
`plugin/dist` was rebuilt after the merge.

## Also fixed nearby

- The elapsed clock stopped while waiting with helpers still at work.
- "Request 7, waiting on you for 24 m" counted from the request's start, not from the ask.
- A band waiting on you read "21:03 to 21:03"; it now reads "to now".
- The NOW line was clipped at 440 px on wide screens with room to spare.

## Left open

- The task page says "Sign in there and tell me when you're done", Claude's first words on it; "there" leans on the sentence before.
- The journey header still says "1 running now" for a request waiting on you.
- The recap path (`plugin/src/recap.ts`) still reads a blocked task as failed, for imported history.
