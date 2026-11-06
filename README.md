# Murmur

A live companion screen for Claude Code, shown on a second monitor beside the terminal.
It turns a running session into something a person can follow: what is being built right now and why, how the parts tie together, where the plan is, and what each subagent is doing.

Status: wave 1 is built and tested (plugin, server, live web screen).
It is not deployed yet, so for now it runs locally.

## Requirements

Requirements: Node.js 22+ on PATH.
The plugin's hooks and MCP server run with node; without it, Murmur says so at session start and stays out of the way.
Developing Murmur itself also needs pnpm.

## Using it in Claude Code

Inside Claude Code, add the marketplace and install the plugin:

```
/plugin marketplace add sarthak-johnson/murmur
/plugin install murmur@murmur
/murmur:login
/murmur:on
```

`/murmur:login` shows a short code to approve in the browser.
`/murmur:on` turns on the current project; nothing is sent for projects you have not turned on.
`/murmur:off`, `/murmur:pause`, `/murmur:resume`, `/murmur:status` and `/murmur:logout` do what they say.

The plugin talks to `http://localhost:8787` by default, which is the local server below.
For another server, set `MURMUR_SERVER` or run `murmur login <server>` in a terminal.
The repository is private for now, so installing needs GitHub access to it.

## Running locally

```bash
pnpm install
pnpm --filter @murmur/web build
cd server && MURMUR_DEV_LOGIN=1 pnpm dev
```

The server listens on port 8787 and serves the web app.
With no `DATABASE_URL` it stores data in `server/.data/pglite`.
`MURMUR_DEV_LOGIN=1` enables `/auth/dev?login=<name>` for local sign-in; it is never available in production.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm e2e` runs a real Claude Code session against a local server.
It costs a little money and needs `claude` on PATH, so it is not part of `pnpm test` or CI; see [e2e/README.md](e2e/README.md).

## How it is built

- `packages/core`: the shared, pure `reduce(events)` that turns raw hook events into the story, plan, map and flags, plus secret scrubbing.
- `plugin`: the Claude Code plugin (hooks, offline queue, the `map` and `narrate` tools, slash commands).
- `server`: the Hono server (GitHub and device login, ingest, live stream, retention).
- `web`: the React web app.
- `e2e`: the real Claude Code test.

Design: [docs/superpowers/specs/2026-11-06-murmur-design.md](docs/superpowers/specs/2026-11-06-murmur-design.md).
Build plan: [docs/superpowers/plans/2026-11-06-murmur-wave1.md](docs/superpowers/plans/2026-11-06-murmur-wave1.md).
Decisions made during the build: [docs/superpowers/plans/2026-11-06-murmur-wave1-rulings.md](docs/superpowers/plans/2026-11-06-murmur-wave1-rulings.md).

## The problem

Developers using coding agents often lose track of what the agent is doing and why.
The terminal shows diffs and tool calls, not the story.
Anthropic's January 2026 study on AI assistance and coding skills found developers who used AI scored about 17% lower on a quiz about the code they had just worked with, while those who asked for explanations kept their understanding.

## Mockups

Open these in a browser.

- [01 Map directions](docs/mockups/01-map-directions.html): route, mind map, and story + plan, compared.
- [02 Story + map + plan](docs/mockups/02-story-map-plan.html): the combined live screen.
- [03 Part drill-down and ideas](docs/mockups/03-part-drilldown-and-ideas.html): clicking a part opens its aim, steps, files, choices and checks, plus the list of whole-screen ideas.
- [04 Phases and tasks](docs/mockups/04-phases-and-tasks.html): Claude's plan as phases and tasks, linked to the map.
