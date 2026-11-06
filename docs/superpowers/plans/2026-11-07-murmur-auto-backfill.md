# Murmur auto-backfill and mid-session narration

Approved by the author on 7 Nov 2026.
Goal: when a project is on, a session Murmur has not seen before (already running, resumed, or opened before the plugin was installed) uploads its history so far automatically, then continues live; and Claude starts narrating from the next prompt without waiting for a new session.

## Behaviour

- Trigger: the first hook event of a session that Murmur has not marked as backfilled, in a project that is on, logged in, not paused, not revoked, and not headless (unless `MURMUR_ALLOW_HEADLESS=1`).
  SessionStart with source `startup` for a brand-new session also marks it backfilled with nothing to import.
- The triggering event itself is sent live as today.
  The backfill imports only transcript entries strictly older than that event's `ts` (the cutoff), so nothing is sent twice.
- The backfill runs in a detached child (`hook.cjs --backfill <sessionId>`), never inside the hook that Claude waits on.
  State per session lives in `MURMUR_HOME/sessions/<id>.json` (the existing narration state file): add `backfill: "pending" | "running" | "done"`, `cutoff`, `transcriptPath`.
  A second hook event while the backfill is pending or running does not start another.
- Old, finished sessions of the project are not imported.

## Mapping transcript entries to MurmurEvents

Source: the hook payload's `transcript_path` (main session) and, for subagents, `<dirname(transcript_path)>/<sessionId>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` (`agentType`, `description`, `toolUseId`).
Each line is JSON; skip any line that fails to parse or lacks the fields used below (best effort, never throw).
Use only these entries; ignore every other type (including `session-owner`, `cost-state`, `api-request*`, `attachment`, `file-history-*`, `system`):

| Transcript entry | MurmurEvent |
|---|---|
| `type: "user"`, `message.content` is a string, `origin.kind === "human"` | `UserPromptSubmit` with payload `{prompt}` |
| `type: "assistant"`, content block `type: "tool_use"` | `PreToolUse` with `{tool_name, tool_input, tool_use_id}` |
| `type: "user"`, content block `type: "tool_result"` | `PostToolUse` (or `PostToolUseFailure` when `is_error` is true) with `{tool_name, tool_input, tool_use_id, tool_response}`; `tool_response` is the entry's `toolUseResult` when present, else the block's content; `tool_name`/`tool_input` come from the matching tool_use by id |
| subagent file, first entry | `SubagentStart` with `{agent_id, agent_type}` at that entry's timestamp |
| subagent file tool_use / tool_result | as above, payload also carries `agent_id` |
| subagent file, last entry | `SubagentStop` with `{agent_id, agent_type}` |

Every payload also carries `hook_event_name`, `session_id`, `cwd` (from the entry, else the session cwd).
`ts` is the entry's `timestamp`; entries without a timestamp are skipped.
Event `id`: a deterministic UUID (version 5 style, from SHA-1 or SHA-256 of `murmur-backfill:${sessionId}:${entry.uuid}:${index-in-entry}:${hookName}`), so re-running a backfill never duplicates.
Every event goes through `scrubEvent` and the normal queue (`enqueue`), then `flush` in the same child.

Size limits: at most 5,000 events and 20 MB of serialized events per backfill; when over, keep the most recent ones and drop the oldest.

## Narration from the next prompt

- Track `instructed: boolean` in the session state; SessionStart's existing injection sets it.
- On `UserPromptSubmit` in an on project where `instructed` is false, the hook prints `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext": NARRATION_INSTRUCTION}}` once and sets `instructed`.
- UserPromptSubmit therefore becomes a synchronous hook in hooks.json.
  It must stay fast: it only reads local state, prints, enqueues, and spawns the detached flush or backfill child; it never waits on the network.

## Tests

- Mapping unit tests on a small hand-made transcript fixture in the real format (prompts with `origin.kind: "human"`, a system-injected text entry that must be skipped, a tool_use/tool_result pair, an error result, an Edit with `toolUseResult.structuredPatch`, one subagent file with meta).
- Cutoff: entries at or after the cutoff are not emitted.
- Deterministic ids: two runs give identical ids.
- Malformed lines and missing subagent files are skipped without throwing.
- Size cap keeps the most recent events.
- Hook: first event of an unseen session in an on project spawns one backfill (spawn injectable) and marks state; a second event does not; off, paused, headless, revoked or logged-out projects never backfill; startup SessionStart marks done with nothing imported.
- Hook: UserPromptSubmit injects the instruction once when not instructed, never twice, never for off projects.
- Built-bundle test: `dist/hook.cjs` with a UserPromptSubmit payload returns within 1.5 s while the server hangs.
- End to end on the real local server: turn a temp project on, run the built `hook.cjs --backfill` against a fixture transcript, and confirm `GET /api/sessions/:id/events` returns the imported events and the reduced view has the request and files.

## Out of scope

Importing finished past sessions; an explicit import command.
