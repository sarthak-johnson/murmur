# Report: on/off follows the session, worktrees belong to their repo

Branch `fix/session-bound-project`, fix commit `d16c0f7`.
Brief: `2026-11-07-murmur-session-bound-project.md`.

## What changed

- `plugin/src/local.ts`
  - `projectKey` now returns the main repo root when the git root it finds has a `.git` file whose `gitdir:` resolves to `<main>/.git/worktrees/<name>` (absolute or relative `gitdir`).
    A `.git` folder, a submodule (`gitdir: ../.git/modules/x`) or an unreadable line keeps the old key.
    The main root is never home or `/`.
  - `SessionState.project`: the project key the session is bound to.
  - New `sessionProjectState(cwd, sessionId)`: the session's bound project state, unless the event's own cwd is explicitly `off`; with no binding, the old cwd rule.
    It is the one rule the hook gate and `flush` both use.
  - `isNewSession` now means "no hook has seen it" (`backfill` unset) instead of "no state file", so `/murmur:on` can bind a session without stopping its first hook from starting the backfill.
    Every hook path that sees a session already set `backfill`, so existing states read the same.
- `plugin/src/hook.ts`
  - The gate uses `sessionProjectState`.
  - Once past the on, login, revoked and session-id checks, an unbound session is bound to `projectKey(cwd)`.
    A session first seen in an unset or `asked` project is never bound and keeps asking once and sending nothing.
  - A pause of the bound project also counts as paused.
  - Fresh-session writes use `updateSession` so they keep a binding made by `/murmur:on`.
  - A UserPromptSubmit injection (the mid-session case) is prefixed with `MID_SESSION_LINE` and a newline; SessionStart injection is unchanged.
- `plugin/src/upload.ts`: `flush`'s `wanted` uses `sessionProjectState(e.cwd, e.sessionId)`, cached per session and cwd.
  The backfill gets the same rule through `flush`, so no change to `backfill.ts` was needed.
- `plugin/src/cli.ts`: `on` run inside a session (`CLAUDE_CODE_SESSION_ID`) binds that session to the project.
- `plugin/src/instruction.ts`: `MID_SESSION_LINE` = "This session was already under way. Call `map` now for the work in progress, then narrate as below."
- Point 6 (repair): nothing re-runs.
  An existing `backfill: "done"` session is not new, so it never backfills again; its next event in an on project just binds it.
- `plugin/dist/*.cjs` rebuilt.

## TDD evidence

RED: with only the tests written, `npx vitest run` in `plugin` gave 10 failed, 89 passed:

- local: worktree and subfolders map to the main repo, submodule stays its own (received the worktree path, expected main).
- local: `MID_SESSION_LINE` em dash check (export missing).
- hook: session keeps sending from its worktree and other folders, not from an off project.
- hook: turning the project off later stops the rest of the session.
- hook: an already imported session is bound but not imported again.
- hook: mid-session instruction asks for a map, SessionStart's does not.
- hook: the existing "missed SessionStart" test, updated to expect the map line.
- upload: bound session sends from worktree and other folders, not from an off one (sent 1, expected 4).
- backfill: imports history from inside a worktree of the on project, end to end through flush with a fake fetch.
- cli: `on` in a session binds it and leaves it unseen.

The guard test "a session first seen in an unset folder asks once and sends nothing" passed before and after, as intended.
The dist test for UserPromptSubmit was updated for the map line; it failed against the old bundle and passes after the rebuild.

GREEN: plugin suite 99 passed after the fix.

E2E through the built bundles, temp `MURMUR_HOME`, fake server, the author's layout (main repo plus `.claude/worktrees/lit-plate` with a `.git` file):
`murmur on`, then SessionStart at main, PreToolUse in the worktree, PostToolUse in an unrelated unset folder.

- Old bundle (`HEAD~1` dist): server got only `SessionStart main`. This is the bug.
- New bundle: server got SessionStart, the worktree PreToolUse and the other-folder PostToolUse; the session state has `project` set to the main root.

Final checks, each exit status checked on its own:
`pnpm build:plugin` exit 0, `pnpm lint` exit 0 (after `biome check --write` formatting of the new code), `pnpm typecheck` exit 0, `pnpm test` exit 0 (163, 99, 89 and 95 tests across the four packages, all passing).

## Concerns

- `murmur status` still reports the cwd's own project state, not the session's.
  In a worktree that is now correct (it maps to main), but in an unrelated folder a bound session reports "not set" while its events are sent.
- `/murmur:on` binding relies on `CLAUDE_CODE_SESSION_ID` being set for the command's shell, the same assumption `pause` already makes.
  Without it, the session binds on its first hook event in the on project, which is the usual path anyway.
- `isNewSession` reads state now instead of checking the file exists.
  A malformed session file therefore counts as new and could start one more backfill; the server dedupes tool and subagent ids, but prompts from that history could show twice.
- Session state writes are still read-modify-write without a lock (existing ponytail note); the new `project` write happens once per session, so the added risk is small.
- In the E2E run, the SessionStart event was posted twice because its detached flush and my manual `--flush` raced.
  That is the documented existing behaviour (same id, the server dedupes), not caused by this change.
- The author's real affected session (backfill done, 1,184 worktree events never imported) stays as it is, per point 6.
  Its new live events from the worktree will now be sent.
