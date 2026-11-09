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
For another server, run `/murmur:login <server>`, for example `/murmur:login https://my-mac.tail1234.ts.net`, or set `MURMUR_SERVER`.
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

## Host it on your Mac for friends

This runs Murmur on your Mac and puts it on the internet with Tailscale Funnel, behind a GitHub sign-in that only lets in the people you list.
It costs nothing and needs no card.
The hosted server listens on `127.0.0.1:8788`, so it never clashes with a dev server on 8787.

**Never point Funnel at a dev server** (port 8787, or anything run with `MURMUR_DEV_LOGIN=1`).
Dev login lets anyone sign in as anyone.
The server refuses dev login through a proxy, but do not rely on that: Funnel only ever goes to 8788.

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
    `/murmur:login` accepts only a plain address (scheme, host, optional port) and runs nothing else.

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

- Add or remove a friend: edit `MURMUR_ALLOWED_LOGINS` in `~/.murmur-server/env`, then restart:

  ```bash
  launchctl kickstart -k gui/$(id -u)/in.murmur.server
  ```

  The server logs `Murmur is invite-only: N GitHub logins may sign in.` when it starts.
  When it starts, it signs out anyone no longer on the list: their browser sessions end and their machines are disconnected.
  Their data stays: they can delete their account in Murmur's settings before you remove them, and otherwise their sessions expire after their retention period (90 days by default).
- GitHub names can be renamed, and someone else can then take the old name.
  To pin a friend to their account, write `login:id` instead of `login`, for example `friend-one:583231`, with the `id` from `https://api.github.com/users/friend-one`.
  A `login:id` entry matches the GitHub id only, so it keeps working after a rename.
- See the logs: `tail -f ~/.murmur-server/server.log`.
  The log is never rotated; empty it with `: > ~/.murmur-server/server.log` if it grows.
- Update: `cd ~/murmur-host && git pull && server/ops/install-mac.sh` (it rebuilds and restarts, and keeps your settings).
- After you upgrade, move or remove Node.js, run `server/ops/install-mac.sh` again: the LaunchAgent runs the exact `node` it found at install time.
  A `node` from nvm, volta, asdf or fnm gets a warning for this reason.
- Stop until the next login: `launchctl bootout gui/$(id -u)/in.murmur.server`.
- Stop for good: `server/ops/uninstall-mac.sh` and `tailscale funnel reset`.
  This keeps `~/.murmur-server`; delete it to remove everyone's data.
- Back up: copy `~/.murmur-server/data` while the server is stopped.

### Cost and limits

- It costs nothing: Tailscale's free plan includes Funnel, and GitHub OAuth apps are free.
- Murmur is only up while the Mac is awake and online.
  Keep it on power and stop it sleeping (System Settings, Battery or Energy, "Prevent automatic sleeping when the display is off").
  While it is down, each friend's plugin queues their events and sends them when it is back; only the live view pauses.
- Everything your friends watch goes through your home upload bandwidth.
  Tailscale does not publish a Funnel bandwidth limit, and Funnel is still labelled beta.
- The server runs as you, on your Mac, so only list people you trust.

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
