# Murmur

**A live, plain-words view of your Claude Code session, in the browser.**

Murmur sits on a second screen beside your terminal and turns a running Claude Code session into something a person can follow: what is being built and why, the plan and where it stands, how the parts fit together, what each helper (subagent) is doing, and which files changed.
It works on long sessions too: a week of work reads as one journey, from your first prompt to where things are now.

[![CI](https://github.com/sarthak-johnson/murmur/actions/workflows/ci.yml/badge.svg)](https://github.com/sarthak-johnson/murmur/actions/workflows/ci.yml)

- [Why Murmur](#why-murmur)
- [What you see](#what-you-see)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Privacy](#privacy)
- [Configuration](#configuration)
- [Host it on your Mac for friends](#host-it-on-your-mac-for-friends)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Why Murmur

Developers using coding agents often lose track of what the agent is doing and why.
The terminal shows diffs and tool calls, not the story.
Anthropic's January 2026 study on AI assistance and coding skills found that developers who used AI scored about 17% lower on a quiz about the code they had just worked with, while those who asked for explanations kept their understanding.
Murmur keeps that explanation on screen, as the work happens, without you having to ask.

## What you see

- **The journey.** The session page shows where it started (your first prompt) beside where it is now, the totals (helpers, files, commands, tasks sent back, pauses), the chapters of the work, and every request on one line with your approvals and the pauses between them.
- **The request rail.** Every request is always visible on the left, grouped by day, each with a short title and its state: running, waiting on you, done, left open or failed.
- **The request page.** A brief at the top (where it stands, key moments since you last looked, the numbers, anything waiting on you), a phase track with each task as a station, and a story grouped by phase in which each task's back-and-forth folds into one line.
- **The task page.** For every task: its aim and when it counts as done, how it went (helpers on a timeline, with build and fix rounds), the steps, what was checked, what was left open, and the files by role.
  Tasks Claude never described are still filled in from their helpers, files and messages.
- **The flow board.** The parts of a request laid out left to right in build order, grouped by phase. Click a part to light up what it uses and what uses it.
- **Files and Helpers tabs.** Every file a request touched, grouped by task, and every helper with its model, state, time and verdict.
- **Live.** A running session updates as it goes, with one quiet pulse on whatever is running now.
- **Works on any screen.** From a phone to a wide monitor; motion follows your reduced-motion setting.

## How it works

```
 Claude Code (your machine)                       Murmur server                  Browser
 ┌───────────────────────────┐   batched HTTPS   ┌──────────────────────┐   SSE   ┌──────────┐
 │ murmur plugin             │ ────────────────► │ ingest  ─► Postgres  │ ──────► │ React    │
 │  hooks: every prompt,     │                   │ (or PGlite on disk)  │         │ web app  │
 │  tool call and helper     │                   │ live stream          │         │          │
 │  secrets scrubbed here    │                   │ GitHub sign-in       │         │          │
 │  offline queue            │                   │ retention job        │         │          │
 └───────────────────────────┘                   └──────────────────────┘         └──────────┘
```

1. The **plugin** listens to Claude Code's hooks.
   For projects you turn on, it scrubs obvious secrets on your machine, then sends events to the server in batches.
   If the server is down, events wait in a local queue and are sent when it is back, so nothing is lost.
2. When you turn Murmur on in the middle of a session, the plugin **imports the history** so far.
   Your own Claude writes a short summary and titles for up to 5 recent requests, on your machine.
3. The **server** stores events, streams them live to the browser and deletes old sessions after your retention period.
4. The **web app** runs one shared function, `reduce(events)`, that turns raw events into the journey, plan, story, flow and flags.
   Claude can also describe its plan and the parts it is building through two small tools the plugin adds (`map` and `narrate`), which makes the pages richer.

## Quick start

This runs everything on your own computer.
It takes about five minutes.

### Requirements

- [Node.js](https://nodejs.org) 22 or newer.
- [pnpm](https://pnpm.io) 12: `npm install -g pnpm@12`.
- [Claude Code](https://claude.com/claude-code).
- Git, and access to this repository (it is private for now; ask the owner to add you as a collaborator).

### 1. Get the code and build it

```bash
git clone https://github.com/sarthak-johnson/murmur.git
cd murmur
pnpm install
pnpm --filter @murmur/web build
```

### 2. Start the server

```bash
cd server
MURMUR_DEV_LOGIN=1 pnpm dev
```

It prints `murmur listening on 127.0.0.1:8787`.
Leave this terminal open.
Data is stored in `server/.data/pglite`, so it survives restarts.

`MURMUR_DEV_LOGIN=1` turns on a simple local sign-in (a name, no password).
It only listens on this machine and is refused in production; never expose this server to the internet.

### 3. Sign in

Open <http://localhost:8787>, type a name and choose **Sign in locally**.

### 4. Install the plugin in Claude Code

In Claude Code, add the marketplace and install the plugin.
Either from GitHub:

```
/plugin marketplace add sarthak-johnson/murmur
/plugin install murmur@murmur
```

Or from the folder you cloned in step 1:

```
/plugin marketplace add /path/to/murmur
/plugin install murmur@murmur
```

Restart Claude Code after installing so the plugin's hooks load.

### 5. Connect and turn it on

```
/murmur:login
```

It prints a link and a short code.
Open the link in the browser where you signed in, and approve the code.
Then, in the project you want to watch:

```
/murmur:on
```

Open <http://localhost:8787> and use Claude Code as usual.
The session appears within a few seconds and updates live.

## Commands

| Command | What it does |
| --- | --- |
| `/murmur:login [server]` | Connects this machine to a Murmur server. With no address it uses `http://localhost:8787`. |
| `/murmur:on` | Starts showing the current project. Nothing is sent for projects you have not turned on. |
| `/murmur:off` | Stops showing the current project. |
| `/murmur:pause` | Pauses this session. What happens while paused is never sent, not even later. |
| `/murmur:resume` | Resumes this session. |
| `/murmur:status` | Shows whether you are logged in, which server, and whether this project is on. |
| `/murmur:logout` | Disconnects this machine. |

`/murmur:login` accepts only a plain address (scheme, host, optional port), for example `/murmur:login https://my-mac.tail1234.ts.net`.

## Privacy

- **Opt-in per project.** Nothing is sent until you run `/murmur:on` in a project.
- **What is sent.** Your prompts, Claude's replies and narration, tool calls with their inputs, file paths, the changes Claude's edits make, and the start of other results such as command output.
- **Secrets are scrubbed on your machine** before anything is sent: API keys, tokens, `.env` values and similar.
- **Summaries run locally.** Imported history is summarised by your own Claude, on your machine.
- **You control deletion.** Sessions are deleted after your retention period (90 days by default, set in Settings), and you can delete any session or your whole account at any time.

## Configuration

### Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on. |
| `HOST` | `127.0.0.1` with dev login or behind a proxy | Address to listen on. |
| `BASE_URL` | `http://localhost:<PORT>` | Public address; used for sign-in links. Required in production. |
| `MURMUR_DATA_DIR` | `server/.data/pglite` | Folder for the built-in PGlite database. |
| `DATABASE_URL` | none | A Postgres connection string instead of PGlite. Set this or `MURMUR_DATA_DIR`, not both. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | GitHub OAuth app for "Sign in with GitHub". Required in production. |
| `MURMUR_ALLOWED_LOGINS` | anyone | Comma-separated GitHub logins that may sign in (`login` or `login:id`). `*` means anyone. |
| `MURMUR_DEV_LOGIN` | off | `1` turns on local sign-in. Ignored when `NODE_ENV=production`. |
| `TRUST_PROXY` | off | `1` when the server sits behind a proxy such as Tailscale Funnel. |
| `NODE_ENV` | none | `production` for a hosted server. |

### Plugin

| Variable | Default | Purpose |
| --- | --- | --- |
| `MURMUR_SERVER` | `http://localhost:8787` | Server to use when `/murmur:login` is given no address. |
| `MURMUR_HOME` | `$XDG_CONFIG_HOME/murmur` or `~/.config/murmur` | Where the plugin keeps its login, settings and queue. |

## Host it on your Mac for friends

This runs Murmur on your Mac and puts it on the internet with Tailscale Funnel, behind a GitHub sign-in that only lets in the people you list.
It costs nothing and needs no card.
The hosted server listens on `127.0.0.1:8788`, so it never clashes with a dev server on 8787.

> [!WARNING]
> Never point Funnel at a dev server (port 8787, or anything run with `MURMUR_DEV_LOGIN=1`).
> Dev login lets anyone sign in as anyone.
> The server refuses dev login through a proxy, but do not rely on that: Funnel only ever goes to 8788.

### Set it up once

1. Clone a separate copy of the repository on `main` just for hosting, so your own work never changes what your friends run:

   ```bash
   git clone https://github.com/sarthak-johnson/murmur.git ~/murmur-host
   cd ~/murmur-host
   ```

   Every command below runs from this folder.
2. Install Tailscale from <https://tailscale.com/download/mac> and sign in.
   The commands below use the `tailscale` CLI; if it is not on your PATH, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.
3. Find your Mac's Tailscale name, without turning Funnel on yet:

   ```bash
   tailscale status --json --peers=false | grep DNSName
   ```

   It prints something like `"DNSName": "my-mac.tail1234.ts.net."`.
   Your URL is `https://` plus that name without the final dot, for example `https://my-mac.tail1234.ts.net`.
   Below, `<URL>` means that address.
4. Create a GitHub OAuth app at <https://github.com/settings/developers> (OAuth Apps, New OAuth App):
   - Homepage URL: `<URL>`
   - Authorization callback URL: `<URL>/auth/github/callback`

   Copy the Client ID, then generate a client secret and copy it too.
5. Run the installer once to create the settings file:

   ```bash
   server/ops/install-mac.sh
   ```

   It checks for Node.js 22 or newer, writes `~/.murmur-server/env` (only you can read it) and stops.
   It never overwrites that file later.
6. Fill in `~/.murmur-server/env`:
   - `BASE_URL=<URL>`
   - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from step 4
   - `MURMUR_ALLOWED_LOGINS=` your GitHub name first, then your friends', comma-separated, for example `MURMUR_ALLOWED_LOGINS=you,friend-one,friend-two` (case does not matter)

   Leave `NODE_ENV=production`, `MURMUR_DATA_DIR`, `TRUST_PROXY=1` and `PORT=8788` as they are.
   The installer refuses an empty `MURMUR_ALLOWED_LOGINS`; `MURMUR_ALLOWED_LOGINS=*` lets anyone with a GitHub account in, on purpose.
7. Run the installer again:

   ```bash
   server/ops/install-mac.sh
   ```

   It installs dependencies, builds the web app, installs the LaunchAgent `~/Library/LaunchAgents/in.murmur.server.plist`, starts the server, and waits until `http://127.0.0.1:8788/healthz` answers `ok`.
   Go on only when it prints `Up: http://127.0.0.1:8788/healthz answers ok.`
   From now on the server starts when you log in to the Mac and restarts if it stops.
   `server/ops/install-mac.sh --dry-run` shows what it would write and run, and changes nothing.
8. Now turn on Funnel, for port 8788 only:

   ```bash
   tailscale funnel --bg 8788
   ```

   The first time, it prints a link to enable HTTPS and Funnel for your tailnet; open it, approve, and run the command again.
   `--bg` keeps the Funnel on across restarts.
   `tailscale funnel status` should show `<URL>` going to `http://127.0.0.1:8788`.
9. Check it from outside: `curl <URL>/healthz` prints `ok`.
   Open `<URL>` and sign in with GitHub.
10. Connect your own Claude Code to it with `/murmur:login <URL>`, then `/murmur:on` in a project.

The server listens only on `127.0.0.1`, so the Funnel is the only way in from outside the Mac.
Its data lives in `~/.murmur-server/data`, readable only by you.

### How a friend joins

1. Add their GitHub name to `MURMUR_ALLOWED_LOGINS` and restart (see below).
2. The repository is private, so give them access to `sarthak-johnson/murmur` on GitHub (Settings, Collaborators).
3. In Claude Code, they run:

   ```
   /plugin marketplace add sarthak-johnson/murmur
   /plugin install murmur@murmur
   /murmur:login <URL>
   ```

4. `/murmur:login` prints a link and a short code.
   They open the link, sign in with GitHub, and approve the code.
5. They run `/murmur:on` in each project they want to show, and watch it at `<URL>`.

Someone who signs in with GitHub but is not on the list sees "This Murmur is invite-only. Ask its owner to add your GitHub name." and gets no account.

### Day to day

- **Add or remove a friend:** edit `MURMUR_ALLOWED_LOGINS` in `~/.murmur-server/env`, then restart:

  ```bash
  launchctl kickstart -k gui/$(id -u)/in.murmur.server
  ```

  The server logs `Murmur is invite-only: N GitHub logins may sign in.` when it starts.
  When it starts, it signs out anyone no longer on the list: their browser sessions end and their machines are disconnected.
  Their data stays: they can delete their account in Murmur's settings before you remove them, and otherwise their sessions expire after their retention period.
- **Pin a friend to their account:** GitHub names can be renamed, and someone else can then take the old name.
  Write `login:id` instead of `login`, for example `friend-one:583231`, with the `id` from `https://api.github.com/users/friend-one`.
  A `login:id` entry matches the GitHub id only, so it keeps working after a rename.
- **Logs:** `tail -f ~/.murmur-server/server.log`.
  The log is never rotated; empty it with `: > ~/.murmur-server/server.log` if it grows.
- **Update:** `cd ~/murmur-host && git pull && server/ops/install-mac.sh` (it rebuilds and restarts, and keeps your settings).
- **After you upgrade, move or remove Node.js,** run `server/ops/install-mac.sh` again: the LaunchAgent runs the exact `node` it found at install time.
  A `node` from nvm, volta, asdf or fnm gets a warning for this reason.
- **Stop until the next login:** `launchctl bootout gui/$(id -u)/in.murmur.server`.
- **Stop for good:** `server/ops/uninstall-mac.sh` and `tailscale funnel reset`.
  This keeps `~/.murmur-server`; delete it to remove everyone's data.
- **Back up:** copy `~/.murmur-server/data` while the server is stopped.

### Cost and limits

- It costs nothing: Tailscale's free plan includes Funnel, and GitHub OAuth apps are free.
- Murmur is only up while the Mac is awake and online.
  Keep it on power and stop it sleeping (System Settings, Battery or Energy, "Prevent automatic sleeping when the display is off").
  While it is down, each friend's plugin queues their events and sends them when it is back; only the live view pauses.
- Everything your friends watch goes through your home upload bandwidth.
  Tailscale does not publish a Funnel bandwidth limit, and Funnel is still labelled beta.
- The server runs as you, on your Mac, so only list people you trust.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `localhost refused to connect` | The server is not running, often after a restart. Start it again (Quick start, step 2), or use the hosting setup, which starts it at login. |
| `/murmur:status` says `This project: not set` | Run `/murmur:on` inside the project you want to watch. |
| `/murmur:status` says `Logged in: no` | Run `/murmur:login` and approve the code in the browser. |
| The plugin says it needs Node.js | Install Node.js 22 or newer and make sure `node` is on your PATH, then restart Claude Code. |
| A session does not appear | Check `/murmur:status`, then that the server address it shows opens in your browser. Events are queued while the server is unreachable and sent once it is back. |
| `Sign-in is not set up on this server yet` | Start a local server with `MURMUR_DEV_LOGIN=1`, or set the GitHub OAuth variables for a hosted one. |

## Development

### Layout

| Folder | What it holds |
| --- | --- |
| `packages/core` | The shared, pure `reduce(events)` that builds the journey, plan, story, flow and flags, plus secret scrubbing. |
| `plugin` | The Claude Code plugin: hooks, offline queue, history import, the `map` and `narrate` tools and the slash commands. `plugin/dist` is committed so the installed plugin needs no install step. |
| `server` | The Hono server: GitHub and device login, ingest, live stream (SSE), retention. |
| `web` | The React web app. |
| `e2e` | A real Claude Code session run against a local server. |

The stack is TypeScript (strict, ESM), React 19 with Vite, Hono on Node.js, Drizzle with PGlite or Postgres, Vitest and Biome.

### Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:plugin                 # rebuild plugin/dist after changing plugin or core code
pnpm --filter @murmur/web build
```

CI runs lint, typecheck and tests on every pull request, and fails if `plugin/dist` does not match a fresh build.

`pnpm e2e` runs a real Claude Code session against a local server.
It costs a little money and needs `claude` on PATH, so it is not part of `pnpm test` or CI; see [e2e/README.md](e2e/README.md).

### Working on the web app

Run the server (Quick start, step 2), then in another terminal:

```bash
cd web
npx vite
```

Vite serves the app with hot reload and forwards `/api` and `/auth` to the server on 8787.

### Design documents

- Design: [docs/superpowers/specs/2026-11-06-murmur-design.md](docs/superpowers/specs/2026-11-06-murmur-design.md)
- First build plan: [docs/superpowers/plans/2026-11-06-murmur-wave1.md](docs/superpowers/plans/2026-11-06-murmur-wave1.md) and its [decisions](docs/superpowers/plans/2026-11-06-murmur-wave1-rulings.md)
- The reshape (journey, rail, request and task pages, flow board): the `2026-11-0*-murmur-reshape-*` plans and reports in [docs/superpowers/plans](docs/superpowers/plans)
- Early design explorations: [docs/mockups](docs/mockups)
- What Claude Code's hooks send: [docs/hook-facts.md](docs/hook-facts.md)
