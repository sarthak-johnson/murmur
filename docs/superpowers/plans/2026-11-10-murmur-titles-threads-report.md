# Report: titles Claude writes, and the session's storylines

Branch `feat/titles-threads`, built from the brief beside this file.

## What was built

### Core

- `TITLES_TOOL` ("murmur:titles") and the `TitlesInput` zod schema sit next to the recap's in `narration.ts`, with the caps of the brief (session 48, short 40, goal 120, thread 40, 80 requests).
- The schema refuses a thread nobody listed, two requests or threads with one id, and a `follows` that names no other request of the answer.
- `reduce` takes titles events out of the session before it splits requests, so no pass sees them as work, time or a pause, and `lastEventAt` stays the session's own.
- A later titles run wins for the requests it names; the session title and thread names merge the same way.
- Precedence: `short` and `goal` come from the map (live or recap), then the titles run, then Murmur's own; `kind` from the map, then the run (`kindInferred` false), then the guess.
- New `RequestView.titledBy` says when Claude wrote `short`, so the plugin knows which requests to give only as context, and the web can tell Claude's title from Murmur's.
- `SessionView.threads` and each request's `thread` come from the run; a request newer than the run joins the thread before it; with no run, one inferred thread per journey chapter.
- When threads are Claude's, a journey chapter is a run of consecutive requests in one thread, titled with the thread's title.
- `follows` comes from the run when it covered the request (and only to an earlier one), else a reply follows the request before it.
- `activity` counts each request's tool calls (helpers' too) by kind, never Murmur's own tools.
- Murmur's own fallback: a reply takes its goal and short from the first clause of its outcome (a leading "Yes," or "Okay," dropped, two words at least); pasted text and images never show in a short, goal or session title; a leading list marker is dropped.
- A short never ends mid-phrase: it backs off to before a clause it cut into when three words are left, else before its last small word when two are left, else it ends with "…" rather than on a word like "was", "any" or "you".
- The session title skips bare replies and takes the first prompt that is not one.

### Plugin

- The narration instruction asks `map` for a 2 to 5 word title that says what the request does, never the user's words, and to map even a short reply; the example carries `short`.
- `titles.ts` builds the input (labels r1, r2, ... oldest first; prompt scrubbed, pasted text and images reduced, 300 characters; Claude's first and last message, 200 and 400; up to 5 files and 3 helpers; covered or map-titled requests as title and goal only, with the storylines so far), asks once through the recap's isolated `ask`, validates, turns labels into request keys and queues one event.
- It runs after an import's recap when its ask can end with time left, and in the child a Stop spawns, after the refresh.
- It asks only when a request no run covered is not among those the last ask covered, at most once every 10 minutes per session, at most the newest 80 requests, and never while the project is off, the session paused, logged out, headless, in its own run or with `MURMUR_RECAP=0`.
- Its state lives in `sessions/<id>.titles.json`; a history import forgets it, as it forgets the refresh.
- The line on the What Murmur sends page now says the user's own Claude also names the requests and groups them into storylines, on the machine, for up to 80 recent requests at a time.

## Decided differently from the brief

- Requests are named by key, not by event id: the live hook gives a prompt a random event id while the transcript gives another, so a titles run read from the transcript could never name a live request by id.
  Both carry the same `prompt_id`, so the key is the `prompt_id`, with "#n" for the nth request of a turn that has several (a prompt typed while Claude works), and the event id when there is none (`requestKeys` in core).
- Claude's threads stay whenever a run covered requests, not only when it covered every one: a request newer than the run joins the thread before it, and only requests older than every covered one (past the 80 cap) fall back to chapter threads.
  Flipping the whole flow back to chapters each time a new request starts would make it jump.
- A goal cut from the prompt now ends at a word with "…" instead of a raw 80-character slice.
- The titles run's timeout is 90 s (44 requests took 20 s), so it fits beside a refresh in the Stop child's 4 minutes.
- An answer with one field over its cap is refused whole, as the recap's is.

## Quality

The fallback and the dry titles run were checked on sessions 8af212b5 and 27a000a1; the full lists went to the author in the builder's reply, not here, since they quote his private session.
Fallback alone: replies like "Yes", "Ok" and "Waiting" now read as what happened ("Where the build stands", "Your wait is running"), and the mid-phrase cuts read "Confirm whether build 9…" and "Find what can be pruned".
Dry titles run on 8af212b5 (sonnet, 20 s, about $0.08): every request reads as what was done, the session is named, and 8 storylines group the 44 requests into 11 chapters.
The first prompt gave category storylines ("TestFlight builds and PRs", "Messages"); one tuning round told it a storyline is a piece of work with its own aim, never a kind of activity, which fixed it.

## Checks

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s build:plugin` and `pnpm --filter @murmur/web -s build` each exit 0.

## Review

Reviewed by an independent agent on 10 Nov 2026; fixes are in the commits after `7b4fbc3`.

### Found and fixed

- Privacy: the titles run read the whole transcript, which also holds requests asked while Murmur was off or paused, and uploaded a title and goal for each, and let them shape the session's name and storylines.
- The hook now records the `prompt_id` of every request it sends (`markSent`, `SessionState.sent`), and a titles run names only those and the imported history (before the import's cutoff); the others are not even given to Claude as context.
- The plan refresh had the same hole (it reads the whole transcript too), so it now skips a request Murmur did not send.
- A burst of Stops (helpers reporting) could start several Stop children that each read the transcript and passed the 10-minute mark together, so each asked; a child now marks the session before it reads and reads at most once every 5 minutes.
- Fallback titles read as Claude's talk on real outcomes ("I renamed", "Here's the page", "I'll message you when", "Your wait is running", "Nothing is ready to see yet", "It's a message I drafted") or stopped on the ask ("Can you check").
- A clause now has to read as a title: openers ("Ok", "Meanwhile", "Can you", "Let's") and a trailing "please" are dropped, "Here's the X" gives "X", "I renamed the tab" gives "Renamed the tab", and a clause that is talk gives way to the next clause or to the prompt.
- A reply with nothing better ("Yes", "Waiting") is titled "Follow-up", which is honest: it picks up the request before it.
- A cut just before a word that starts a phrase ("as", "for") keeps what it has, so "Page with 12 screens of build 9" no longer backs off to "Page with 12 screens".
- Tests no longer quote the author's own prompts or colleagues' names.

### Checked and kept

- The titles run never uploads from its own run (the recap's isolated `ask`), never runs headless, off, paused or logged out, scrubs what it sends, is killed on exit and timed out, and never runs in the hook itself.
- An invalid answer, a crash or a request the answer leaves out is marked tried, so nothing is asked again until a new request comes; the 10-minute spacing and the 80-request cap hold.
- Matching by `prompt_id` holds between live and transcript events; a prompt typed while Claude works is a queued attachment in the transcript, so no run covers it and it keeps Murmur's own title and the thread before it.
- Threads stay put when a new request starts after a run (it joins the thread before it), and chapters follow Claude's threads.
- The session's fallback name stays the first prompt that is not a reply: the folder and dates are already printed beside the title on the journey and in the session list, so a name made of them would repeat the line above it, and a titles run replaces it after one ask.

### Left open

- A session imported before this change has no record of which live prompts were sent, so its live requests from before the update keep Murmur's own titles; only imported history and new prompts are named.
