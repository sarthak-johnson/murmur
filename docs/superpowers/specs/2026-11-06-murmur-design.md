# Murmur design

Date: 6 Nov 2026.
Status: approved by the author on 6 Nov 2026.
The name was chosen by the author on 6 Nov 2026.

## 1. Intent

Developers using Claude Code often don't understand what the agent is doing.
The terminal shows diffs, tool calls and long text, not the story.
With subagents running, it gets worse.
Most people never ask the agent to explain itself, so they ship code they couldn't explain.

Murmur is a live companion screen that sits in a browser on a second monitor beside the terminal.
It turns a running Claude Code session into something a person can follow at a glance: what is being built right now and why, where the work is in the plan, how the parts tie together, and what each subagent is doing.

Evidence behind the idea:
- Anthropic's randomized study (29 Jan 2026, anthropic.com/research/AI-assistance-coding-skills) found developers using AI scored about 17% lower on a quiz about code they had just worked with, while those who asked for explanations kept their understanding.
- METR (July 2025, arxiv.org/abs/2507.09089) found experienced developers misjudged how AI affected their own work.
- Research on 6 Nov 2026 found no existing tool that explains intent.
  Existing tools (Vibe Kanban, Opcode, claudecodeui, Conductor, ccusage, hook dashboards) show events, diffs, costs or task boards.

## 2. Who it is for

Every Claude Code user, from day one.
Not just the author's own projects.
It must work on any project, in any language, with any kind of session.

## 3. Goals, non-goals, anti-goals

Goals:
- Following a session live is the main job.
- Understanding afterwards is a secondary job, served by wave 2 (section 6).
- A glance at the screen answers "what is it doing now, and why?" in plain words.
- Setup is one plugin install plus a short login, nothing else.

Non-goals:
- Running, starting or orchestrating sessions.
  Vibe Kanban, Conductor and similar tools already do that.
- Cost or token tracking.
- Replacing the terminal.

Anti-goals: it fails even if it technically works when any of these happen.
- It becomes another raw event stream that the user has to decode.
- The screen is cluttered, or things jump around so a glance lands somewhere new each time.
- Code appears before the plain-words explanation.
- It breaks Anthropic's rules on using a person's Claude subscription.

Success (my guess, not yet confirmed by the author): after a session, a developer can explain what was built, how the parts connect and which choices Claude made, without reading the diff.

## 4. The experience

### 4.1 Reading order and look

These rules come from the author: easy on the eyes, nothing dumped on screen, and whatever is shown comes in a proper order.
It is dashboard-like but calm.

- One reading order everywhere: what is happening now and why, then where we are in the plan, then the map, then the details.
- Plain words first.
  Code, diffs and raw tool calls are always one click deeper, never the first thing shown.
- Nothing jumps.
  Every section keeps a fixed place.
  New items fade in instead of pushing things around.
- Few colours, each with one meaning: blue for now, green for done, amber for subagents, red only for stuck or failing.
  Everything else is quiet grey.
- Dark theme only, decided by the author.
  It sits comfortably next to a terminal.
  There is no light theme.

Mockups in `docs/mockups/` show the structure.
They are wireframes for layout and content, not final visual design.

### 4.2 The live screen (mockups 02 and 04)

Top to bottom, left to right:

1. **Phase strip.**
   Claude's plan as phases in order (for example Understand, Server side, App screen, Check it works), each with a progress bar.
   The current phase is highlighted.
2. **Since you last looked.**
   One line catching the user up on what changed while they were looking at the terminal, for example "finished the alerts table, started the endpoint, 1 test failing, Agent 2 started".
3. **Now card.**
   What Claude is building right now, in plain words, and why now.
   Under it, each running subagent with what it is doing and why.
   At the bottom, the request the session started from and how long ago.
4. **Map.**
   A mind map of the feature being built.
   The goal is in the centre and its parts branch out, for example alerts table, server endpoint, alert screen, push notification.
   Each part is marked done, current or not started, and tagged with the phase that builds it.
   Subagents hang off the part they are helping with.
   Arrows show how data or control moves between parts ("sends the alert to", "stores in").
   The map is about the feature, not about files.
5. **Plan panel.**
   Each phase expands into its tasks.
   Finished phases fold up.
   Each task shows a chip naming the map part it builds, the subagents on it, and problems such as "tried a fix 3 times".

Linking: hovering a task lights up its part on the map and dims the rest.
Clicking a phase in the strip shows only that phase's parts.
Clicking a task or a part opens the drill-down.

### 4.3 Drill-down for one part (mockup 03)

Opened by clicking a part or a task.
Breadcrumb back to the whole map.

- **Aim:** what this part is for and what "done" means for it.
- **What it did, in order:** each step in plain words, including failures and retries, each with a link to the raw tool calls or diff.
- **Files touched:** each file with lines added and removed, whether it is new or edited, and one line on its role ("the checks for a bad alert").
  Clicking a file shows its change with plain-words notes.
- **Choices it made:** decisions with the reason, and anything the user never asked for flagged as Claude's assumption.
- **Checked so far:** what is verified, what failed, and what has not been tried yet.
- **Where this sits:** a mini map, what goes in and what comes out, and who is working on it, including the brief each subagent was given.
- **Words used here:** short definitions of the technical terms in this part.
  This is where flash cards come from in wave 2.
- **Ask about this part:** wave 2 (section 6).

### 4.4 Wave 1 extras

- **Since you last looked** (above).
  "Last looked" is per viewer, based on when the page was last visible and focused.
- **Needs you and stuck flags.**
  A clear marker when Claude is waiting for the user (a permission prompt, a question, idle at the prompt), keeps retrying the same fix, or is about to do something risky such as deleting files, force-pushing or touching production.
- **Assumptions list.**
  Every choice Claude made that the user never asked for, gathered in one place.
  The user can accept or reject each one.

### 4.5 Which sessions are shown

Decided by the author: **opt-in per project**.
- The plugin installs for all projects, but nothing uploads until the user turns a project on.
- The first time a session starts in a project folder the plugin hasn't seen, it asks once in the terminal: "Show this project in Murmur?"
- The answer is remembered per project folder.
- A pause command stops uploading for the current session, and a matching command turns a project off.
- Headless runs (`claude -p`, Agent SDK, CI) never upload unless the user explicitly turns them on.

A user may run several sessions at once, on one or more machines.
The web app lists live and recent sessions by machine, project folder and session title.
The user picks which one to follow.

### 4.6 Requests and the kind of work

Decided by the author: **one map per request**.
A session often holds several requests in a row, such as a feature, then a bug, then a question.
- Each request gets its own goal, plan and map.
- The session's requests are listed down the side, newest at the top, so the user can switch between them.
- The phase strip, now card and plan panel show the selected request.
  The live request is selected by default.
- The map's shape follows the kind of work:
  - **Feature:** its parts and how they connect, as in the mockups.
  - **Bug hunt:** the symptom, the suspects, what was ruled out and why, the cause found, and the fix.
  - **Refactor:** before and after, and what moved where.
  - **Question or research:** the question, what was looked at, and the answer.
- Claude declares the kind of work when it declares the map.
  When it doesn't, the server picks the closest kind and labels the choice as inferred.

## 5. How it works

### 5.1 Shape

Decided by the author:
- The view is a browser page.
- In v1 the live view runs on our hosted website, with user accounts.
- In v1 the plugin sends everything from turned-on projects to our server: narration, events, code, diffs and error output, so the view can show as much as possible.
- The plain-words story is written by Claude itself, inside the user's own Claude Code session.
  Our product never makes its own calls on the user's Claude subscription.

The pieces:

1. **A Claude Code plugin**, installed with one command from a plugin marketplace.
   It ships:
   - hooks that forward session events to our server
   - the narration instruction and the means for Claude to report structured notes (5.3)
   - a login command (5.4)
2. **Our server**, which receives events per session, stores them, and builds the story, map, plan and flags from them.
3. **The web app**, which shows the live screen and updates in real time.

### 5.2 Data sources

Facts checked on 6 Nov 2026 against code.claude.com docs and a real session on disk:

- **Hooks are the supported live source.**
  The relevant events are SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Notification, PermissionRequest, Stop, StopFailure, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, PreCompact and PostCompact.
  Payloads carry `session_id`, `transcript_path`, `cwd`, `tool_name`, `tool_input` and `tool_response`, plus `agent_id` and `agent_type` inside subagents.
  `Notification.notification_type` includes `permission_prompt`, `idle_prompt`, `elicitation_dialog` and `agent_needs_input`, which feed the "needs you" flag.
  Hooks can be command or HTTP hooks, but SessionStart accepts only command and MCP-tool hooks.
  A plugin's `hooks/hooks.json` registers when the plugin loads.
- **Task lists are structured.**
  Current Claude Code uses the TaskCreate, TaskList, TaskGet and TaskUpdate tools, and fires TaskCreated and TaskCompleted.
  Task files are also stored in `~/.claude/tasks/<session>/<n>.json` with `subject` and `description`.
- **Subagents.**
  The spawn prompt is in the Agent tool's input.
  SubagentStop gives `agent_transcript_path` and `last_assistant_message`.
  On disk, each subagent has `subagents/agent-<id>.jsonl` and `agent-<id>.meta.json`, which holds `agentType`, `description` and the parent `toolUseId`.
- **Transcripts** at `~/.claude/projects/<project>/<session>.jsonl` are internal.
  The docs say the format "can break on any release".
  Use them only for extra detail, such as subagent internals, never as the foundation.
- **Thinking is not available** through hooks or telemetry, so the "why" must come from Claude's narration, its plan and its task descriptions.
- **Mods** can draw a pane inside Claude Code but cannot draw a separate browser window.
  They are not needed for v1.

### 5.3 Narration

Claude narrates itself.
My call on the mechanism, which the builder may change if something works better:
- The plugin injects a standing instruction at session start.
- The plugin ships a small MCP server with two tools:
  - `map`: declares or updates the feature's parts, the connections between them, and which phase builds each part.
    It is called when the plan is formed and whenever the shape changes.
  - `narrate`: reports the current step with what, why, the part it touches, the task, any assumptions made, and the words used.
    It is called at each meaningful step, not every tool call.
- The MCP server forwards these to our server.

Narration budget, decided by the author: **rich**.
The whole product is the explanation, so narration may add a few percent to a session's token use.
- Claude always declares a plan (phases and tasks) and a map at the start of each request, even when it would otherwise skip planning.
- These drill-down fields come from Claude every time: aim and what "done" means, each file's role, choices with reasons and assumptions, what was checked, what goes in and out of each part, the reason for each subagent, and definitions of the words used.
- The server mostly renders what Claude gives it.
  Hook-based guessing is only the fallback.

Constraints on narration:
- Each narration call stays compact, so the terminal shows short tool lines, not paragraphs.
- It must not change what Claude builds, only make Claude say what it is doing and why.
- It runs only in sessions for projects the user has turned on (4.5), so sessions nobody is watching pay nothing.
- When Claude never calls `map` or `narrate`, the server still shows what it can from hooks, and clearly labels anything it inferred as inferred.

### 5.4 Accounts and login

- The user signs up on the website.
- In Claude Code they run a login command (for example `/murmur login`).
  It shows a short code, the user approves it in the browser, and the plugin stores a token tied to that account, like `gh auth login`.
- Each linked machine shows up under the account.
- There is no "Sign in with Claude" for third-party apps.
  The plugin must never read Claude Code's own stored credentials.
- Because each plugin runs inside one person's own Claude Code, events are already tied to the right person.
  There is no step that sorts events by Claude account.

### 5.5 Wave 2 and the user's own API key

Wave 2 features that need fresh AI writing (side questions, flash cards, quick checks, the session recap) must not call Claude on the user's subscription from our product.
Allowed routes:
- Claude produces the material itself inside the session, through the narration tools (for example, cards when a part finishes, a recap at session end).
- The user adds their own Anthropic API key, which is clearly allowed.

## 6. Waves

Wave 1, the live screen:
- phase strip, now card with subagents, map, plan panel, and the linking between them
- part drill-down
- since you last looked
- needs you and stuck flags
- assumptions list
- accounts, plugin login, several sessions
- opt-in per project, and pause
- one map per request, with the four kinds of work

Wave 2, understanding afterwards:
- replay slider: drag back through the session and watch the map grow
- zoom levels: feature to parts to files to functions
- ask on the side: questions about any part, answered without derailing the session
- flash cards and a quick check when a part finishes
- session recap: the map frozen into a page to come back to or share with a teammate

The approved order is wave 1 first.

## 7. Constraints

- **Anthropic's rules.**
  Third-party products may not offer claude.ai login or use subscription limits without approval.
  This design keeps all AI writing inside Claude Code (narration) or on the user's own API key.
- **We hold users' code.**
  v1 sends code, diffs and errors to our server, so the builder must treat this as sensitive data:
  - encryption in transit and at rest
  - strict per-account access
  - per-session delete, and full account delete
  - a clear statement to users of what is sent
  - scrubbing obvious secrets (API keys, tokens, .env values) before upload
- **Any project.**
  No assumptions about language, framework or repo layout.
- **Setup.**
  One plugin install and one login.
  No config files to edit.
- **Terminal noise.**
  The plugin must not visibly clutter the Claude Code terminal beyond short narration tool lines.
- **Unstable sources.**
  Anything read from transcripts must fail softly when the format changes.

## 8. Calls I made (please check)

- Narration through a plugin-shipped MCP server with `map` and `narrate` tools (5.3).
- Device-code login modelled on `gh auth login` (5.4).
- Secret scrubbing before upload (7).
- Rejecting an assumption in wave 1 marks it on the screen and gives the user a ready line to paste into the terminal.
  Sending it straight into the session is left for later.
- "Stuck" means the same fix failing three or more times, or the same file edited repeatedly with tests still failing.
  The builder may tune this.
- The success definition in section 3 is my guess.
- **v1 is single-user.**
  Each account owns its own sessions, with no teams, orgs or shared live views.
  Sharing a recap with a teammate arrives in wave 2 as a read-only link.
  Keep the account model simple, but don't block adding orgs later.
- **Retention.**
  Sessions are kept until the user deletes them, and are deleted automatically after 90 days by default.
  The user can change that period.
  Wave 2 replay and recap work on whatever is kept.
- **Surfaces for v1.**
  Claude Code running locally on macOS and Linux: the terminal, plus the IDE extensions and the desktop app, where the same local hooks run.
  Windows is best effort.
  Cloud sessions (Claude Code on the web) come later.

## 9. Left to the builder

- Languages, frameworks, hosting, database and real-time transport.
- The exact narration instruction text and the tool schemas.
- How the map is laid out automatically as parts are added.
- How phases are formed when Claude made no explicit plan.
- Final visual design within the rules in 4.1.
- Plugin marketplace packaging and distribution.

## 10. Open risks

- **Demand.**
  Monitoring and orchestration tools have tens of thousands of GitHub stars, but no comprehension tool has traction yet.
  That could mean nobody has done it well, or that demand is weak.
- **Anthropic may build this.**
  The `/recap` summary and the Explanatory and Learning output styles are steps in this direction.
- **Hosting code** raises the trust bar, and some companies will block the tool.
- **Narration quality** depends on Claude following the instruction consistently across models and long sessions, including after compaction.
