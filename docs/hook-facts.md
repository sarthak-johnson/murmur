# Hook facts

Real Claude Code hook payloads, recorded on 6 Nov 2026 with Claude Code 2.1.319 on macOS.
Every parser in `packages/core` and `plugin` must be built from these facts and fixtures, not from memory of the docs.

## How the fixtures were recorded

The capture plugin in `tools/capture-plugin` registers one command hook for every event in spec section 5.2.
Each call appends `{"hook", "env", "extraEnv", "payload"}` as one line to `$CAPTURE_OUT`.
`env` holds `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_SESSION_ID` and `CLAUDE_PROJECT_DIR` (null when unset).
`extraEnv` holds every other `CLAUDE*` and `AI_AGENT` variable the hook sees, minus names containing TOKEN, SOCKET, KEY, SECRET or AUTH.
On SessionStart the hook prints `{"systemMessage":"capture: hello"}`.

| Fixture | How | What it holds |
|---|---|---|
| `e2e/fixtures/feature.jsonl` | `claude -p --permission-mode acceptEdits --model sonnet` in a fresh git repo | Write (create), Edit, failing then passing Bash, one general-purpose subagent |
| `e2e/fixtures/write-update.jsonl` | `claude -p`, same repo, second session | Read, then Write over an existing file (`type: "update"`) |
| `e2e/fixtures/interactive.jsonl` | real interactive `claude` driven through `tmux`, manual (default) permission mode | permission prompt answered "Yes", idle wait, a `!` command, `/exit` |

Paths are rewritten for the repo: the temp dir became `/tmp/murmur-fixtures/` and the home dir became `/Users/dev`.
Nothing else was changed, and no secrets were found.
All runs used the author's normal user settings, so other installed plugins' hooks also ran (they do not appear in the fixtures).

## Common fields

Every payload has `session_id`, `transcript_path`, `cwd` and `hook_event_name`.
Most have `prompt_id`, which changes per user prompt and is a clean way to split requests.
Tool events, Stop, SubagentStop, UserPromptSubmit and PermissionRequest also carry `permission_mode` and `effort: {"level": ...}`.
SessionStart, SessionEnd, Notification and SubagentStart carry no `permission_mode`.
Inside a subagent, events add `agent_id` and `agent_type`.
Interactive payloads also carry `scratchpad_dir`; headless ones do not.
Interactive SessionStart adds `"model": "claude-sonnet-5-5"`; headless SessionStart has only `source`.

## 1. TaskCreated / TaskCompleted payload fields

**Not captured: UNVERIFIED.**
In Claude Code 2.1.319 on this machine, neither `TaskCreate`/`TaskUpdate` nor `TodoWrite` exist as tools, in `-p` or interactive mode, with Sonnet 5.5 or Opus 5.5.
`ToolSearch` for `select:TaskCreate,TaskUpdate` returns `"matches": []` (see `feature.jsonl` line 4 and `interactive.jsonl` lines 4 and 17).
Setting `CLAUDE_CODE_ENABLE_TASKS=1` did not add them.
No transcript under `~/.claude/projects` on this machine contains a `TaskCreate` tool call, so this is not a one-run fluke.
The cause is unknown (possibly a server-side flag for this account, or the sessions being launched from inside another Claude Code session).

Consequence for later tasks: the reducer must treat `TaskCreated`/`TaskCompleted` as optional and must not depend on their field names until a real payload is captured.
The shape given by the docs (not verified here), to code against tolerantly, is `task_id`, `task_subject`, optional `task_description`, plus `teammate_name`/`team_name` in agent teams.

## 2. Write and Edit `tool_response`

Write of a new file (`feature.jsonl` line 6):

```json
{"type": "create", "filePath": "/tmp/murmur-fixtures/feature-repo/greet.txt", "content": "hello\n",
 "structuredPatch": [], "originalFile": null, "userModified": false}
```

Write over an existing file (`write-update.jsonl` line 6):

```json
{"type": "update", "filePath": "/tmp/murmur-fixtures/feature-repo/greet.txt", "content": "bye\nsee you\n",
 "structuredPatch": [{"oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 2, "lines": ["-hello world", "+bye", "+see you"]}],
 "originalFile": "hello world\n", "userModified": false}
```

Edit (`feature.jsonl` line 8) has no `type` field:

```json
{"filePath": "/tmp/murmur-fixtures/feature-repo/greet.txt", "oldString": "hello", "newString": "hello world",
 "originalFile": "hello\n",
 "structuredPatch": [{"oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": ["-hello", "+hello world"]}],
 "userModified": false, "replaceAll": false}
```

`structuredPatch[].lines` are unified-diff lines prefixed with `-`, `+` or a space, so added and removed counts come from counting prefixes.
A new file has an empty `structuredPatch`; count its lines from `content`.

Related shapes seen:

- Bash success `tool_response`: `{"stdout", "stderr", "interrupted", "isImage", "noOutputExpected"}`.
- Bash failure fires `PostToolUseFailure` (not PostToolUse) with no `tool_response`, and instead `"error": "Exit code 1\n..."`, `"is_interrupt": false`, `"duration_ms"`.
  The error text can contain ANSI colour codes.
- Read `tool_response`: `{"type": "text", "file": {"filePath", "content", "numLines", "startLine", "totalLines"}}`.
- Every PostToolUse and PostToolUseFailure carries `tool_use_id` and `duration_ms`.

## 3. Agent tool `tool_input`

The tool is named `Agent` in hooks (`feature.jsonl` line 12):

```json
{"description": "Read greet file",
 "prompt": "Read greet.txt in the current directory and reply with its exact contents.",
 "subagent_type": "general-purpose", "run_in_background": false}
```

Its PostToolUse `tool_response` (line 18) links back to the subagent:
`status` ("completed"), `prompt`, `agentId`, `agentType`, `toolsUsed`, `content` (array of text blocks, the subagent's answer), `resolvedModel`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `usage`, `toolStats` (`readCount`, `searchCount`, `bashCount`, `editFileCount`, `linesAdded`, `linesRemoved`, `otherToolCount`) and `canContinueAgent`.
`agentId` equals the `agent_id` on SubagentStart/SubagentStop and on the subagent's own tool events.

Tool calls can run in parallel: in `feature.jsonl` the Agent PreToolUse and SubagentStart arrive before the PostToolUse of an earlier Bash call.
Order events by arrival, and pair Pre/Post by `tool_use_id`, never by position.

## 4. SubagentStart / SubagentStop fields

SubagentStart (`feature.jsonl` line 13), beyond the common fields:

```json
{"prompt_id": "...", "agent_id": "aa6ff0aac020e7838", "agent_type": "general-purpose", "hook_event_name": "SubagentStart"}
```

It carries neither the prompt nor the description; take those from the parent's `Agent` PreToolUse.

SubagentStop (`feature.jsonl` line 17):

```json
{"permission_mode": "acceptEdits", "agent_id": "aa6ff0aac020e7838", "agent_type": "general-purpose",
 "effort": {"level": "medium"}, "hook_event_name": "SubagentStop", "stop_hook_active": false,
 "agent_transcript_path": "/Users/dev/.claude/projects/-tmp-murmur-fixtures-feature-repo/<session>/subagents/agent-aa6ff0aac020e7838.jsonl",
 "last_assistant_message": "hello world", "background_tasks": [], "session_crons": []}
```

The subagent's own tool events carry the same `agent_id` and `agent_type`, and the parent's `session_id`.

**Trap:** in interactive mode a SubagentStop with `"agent_type": ""` and no matching SubagentStart follows every Stop (`interactive.jsonl` lines 10, 19, 22).
Its `last_assistant_message` is the greyed prompt suggestion shown in the input box (for example `"run ToolSearch for TodoWrite instead"`).
Parsers must ignore a SubagentStop that has an empty `agent_type` or no earlier SubagentStart with the same `agent_id`.

Stop has the same shape as SubagentStop without the agent fields: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`.

## 5. `Notification.notification_type` values seen

| `notification_type` | `message` | When |
|---|---|---|
| `permission_prompt` | `Claude needs your permission` | right after PermissionRequest, before the user answers |
| `idle_prompt` | `Claude is waiting for your input` | about 60 seconds after Stop with no new prompt |

Example (`interactive.jsonl` line 7):

```json
{"prompt_id": "...", "hook_event_name": "Notification", "message": "Claude needs your permission", "notification_type": "permission_prompt"}
```

No Notification fired in either headless run.
`elicitation_dialog` and `agent_needs_input` were not seen.

PermissionRequest (line 6) fires before the Notification and carries `tool_name`, `tool_input` and `permission_suggestions`, for example `[{"type": "setMode", "mode": "acceptEdits", "destination": "session"}]`.
There is no hook event for the user's answer; the next event for that tool is its PostToolUse (allowed) or nothing (denied, not tested).

## 6. What distinguishes `claude -p` from interactive

Use the environment, not the payload.

| Variable seen by hooks | `claude -p` | interactive |
|---|---|---|
| `CLAUDE_CODE_ENTRYPOINT` | `sdk-cli` | `cli` |
| `CLAUDE_CODE_SESSION_ATTENDED` | `0` | `1` |

Recommended signal: headless when `CLAUDE_CODE_ENTRYPOINT` starts with `sdk` (the binary also knows `sdk-ts` and `sdk-py`) or when `CLAUDE_CODE_SESSION_ATTENDED` is `0`.
Payload-only hints are weaker: interactive payloads have `scratchpad_dir` and SessionStart `model`, headless ones do not, and SessionEnd `reason` is `other` for `-p` versus `prompt_input_exit` for `/exit`.

Other variables every hook sees in both modes: `CLAUDECODE=1`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_ENV_FILE`, `CLAUDE_PID`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`, `AI_AGENT=claude-code_2-1-319_harness`.
`CLAUDE_CODE_SESSION_ID` equals the payload's `session_id`, so a hook can read the session id from the environment too.
Hooks also see `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`, which the capture deliberately does not record.

## 7. Is `systemMessage` from SessionStart shown in the interactive terminal?

**Yes, verified.**
The interactive terminal showed this line under the banner at startup:

```
  ⎿  SessionStart:startup says: capture: hello
```

So a plugin can show a one-line message to the user with `{"systemMessage": "..."}`, and Claude Code prefixes it with `SessionStart:<source> says:`.
In `-p` mode it does not appear in the result text.

## 8. Is `CLAUDE_SESSION_ID` set for `!` command execution?

**No.**
`CLAUDE_SESSION_ID` is not set anywhere: it is null in every hook call in all three fixtures, and absent from a `!` command's environment.
The variable that does exist is `CLAUDE_CODE_SESSION_ID`.
Running `! env | grep -E '^(CLAUDE|AI_AGENT)'` in the interactive session printed:

```
AI_AGENT=claude-code_2-1-319_agent
CLAUDE_CODE_CHILD_SESSION=1
CLAUDE_CODE_ENTRYPOINT=cli
CLAUDE_CODE_EXECPATH=/Users/dev/.local/share/claude/versions/2.1.319
CLAUDE_CODE_SESSION_ATTENDED=1
CLAUDE_CODE_SESSION_ID=a6a3cf24-9f5f-4a5a-87ec-832f3e7e2a64
CLAUDE_EFFORT=high
CLAUDE_PID=26290
CLAUDECODE=1
```

That id matches the session's hook `session_id`, so a `!` command can key state by `CLAUDE_CODE_SESSION_ID`.
Shell steps inside slash commands are likely the same but were not tested.
`CLAUDE_PROJECT_DIR` is not set for `!` commands.
A `!` command fires no UserPromptSubmit or tool hook, but it does start a model turn that ends in Stop (`interactive.jsonl` line 21, new `prompt_id`).

## Other facts worth knowing

- SessionStart `source` was `startup` in all three sessions.
- SessionEnd `reason`: `other` for `claude -p`, `prompt_input_exit` for `/exit`.
- `PostToolUseFailure` replaces `PostToolUse` for a failed tool call; a parser that only reads PostToolUse will miss failures.
- `effort.level` is per turn and changed from `medium` to `high` when the model was switched to Opus mid-session.
- `ToolSearch` calls are real tool events with PreToolUse and PostToolUse; the reducer should probably hide them.
- Not exercised: StopFailure, PreCompact, PostCompact, and a denied permission.
