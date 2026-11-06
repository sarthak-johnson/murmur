# Murmur: on/off follows the session and worktrees belong to their repo

Bug, reproduced on the author's real session on 7 Nov 2026:
the author ran `/murmur:on` in a session in `/Users/sarprasa/tradara-stock-screener` (a git repo).
Claude then worked inside the worktree `/Users/sarprasa/tradara-stock-screener/.claude/worktrees/lit-plate` (its `.git` is a file: `gitdir: /Users/sarprasa/tradara-stock-screener/.git/worktrees/lit-plate`).
Murmur decides "is this project on" per event from the event's own `cwd`, and the worktree resolves to its own git root, which is unset.
Result: every live event after the `cd`, including `narrate` calls, was dropped at the hook gate, and the backfill built 1,185 events but `flush` dropped 1,184 of them as "project not on".
The author saw only 6 events and no history.

## Required behaviour

1. **Worktrees map to their main repo.** `projectKey(cwd)`: when the git root found by walking up has a `.git` FILE whose `gitdir:` points into `<main>/.git/worktrees/<name>`, the key is `<main>` (the main repo root). A normal `.git` directory keeps today's behaviour. A `.git` file that points elsewhere (submodules: `gitdir: ../.git/modules/x`) keeps today's key (the submodule root). Never home or `/` (existing rule).
2. **On/off follows the session.** The session state file records `project` (the project key) the first time the session is seen in a project that is `on` (or when `/murmur:on` is run in that session).
   For every later event of that session, the upload gate uses the session's recorded project state, not the event's current cwd, with one exception: if the event's own cwd resolves to a project that is explicitly `off`, that event is not sent.
   A session first seen in a project that is unset or `asked` keeps today's behaviour (asks once, sends nothing).
3. **`flush` uses the same rule.** Its `wanted` filter keeps an event when the event's session state says its project is on (session-bound), and drops it when the event's own cwd is explicitly `off` or the session's project is no longer on (the user turned it off later). Events with no session state fall back to today's cwd check.
4. **Backfill uses the same rule**, so history from inside worktrees and subfolders of the turned-on project is imported.
5. **Mid-session map.** When the narration instruction is injected on a UserPromptSubmit into a session that was already under way (the mid-session case, not SessionStart), prefix it with one line: "This session was already under way. Call `map` now for the work in progress, then narrate as below." Keep the instruction text otherwise unchanged; no em dashes.
6. **Repair for sessions already affected:** a session whose state says `backfill: "done"` but whose project is now on and that has a `cutoff` should not be re-run automatically. Leave existing states alone.

## Tests (TDD: failing first)

- projectKey: a temp main repo with a `.git` dir and a worktree folder whose `.git` file points to `<main>/.git/worktrees/x` returns the main root; a submodule-style `.git` file keeps the submodule root; nested subfolders of the worktree also return the main root.
- Hook: project `on` at the main root; a session's first event has cwd = main root; a later PreToolUse with cwd inside the worktree is enqueued (this is the author's bug); a later event with cwd in a different explicitly-off project is not.
- Hook: turning the project off later stops further events of the session.
- Flush: queued events of an on session with worktree cwds are sent; events whose cwd is explicitly off are dropped.
- Backfill: a transcript whose entries are mostly in the worktree imports them all (end to end through flush with a fake fetch).
- Mid-session injection includes the map line; SessionStart injection does not.
