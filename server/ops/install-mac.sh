#!/bin/bash
# Installs Murmur as a LaunchAgent on this Mac: it starts at login and restarts if it dies.
# Safe to run again: it rebuilds, keeps your env file, and restarts the server.
#   server/ops/install-mac.sh            install or update
#   server/ops/install-mac.sh --dry-run  print what it would write and run, change nothing
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "Usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

REPO=$(cd "$(dirname "$0")/../.." && pwd -P)
HOME_DIR="$HOME/.murmur-server"
ENV_FILE="$HOME_DIR/env"
LOG="$HOME_DIR/server.log"
LABEL=in.murmur.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE=$(command -v node || true)

step() { printf '\n==> %s\n' "$*"; }
run() {
  echo "    \$ $*"
  if [ "$DRY" = 0 ]; then "$@"; fi
}

[ -n "$NODE" ] || { echo "Murmur needs Node.js 22 or newer on PATH." >&2; exit 1; }

env_template() {
  cat <<EOF
# Murmur server settings, read by the LaunchAgent when the server starts.
# After a change, restart it: launchctl kickstart -k gui/\$(id -u)/$LABEL
NODE_ENV=production
# Your Tailscale Funnel URL, no trailing slash, e.g. https://my-mac.tail1234.ts.net
BASE_URL=
# From your GitHub OAuth app (github.com/settings/developers)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
# The database folder, owner-only
MURMUR_DATA_DIR=$HOME_DIR/data
# GitHub logins that may sign in, comma-separated, yours first. Empty lets anyone with GitHub in.
MURMUR_ALLOWED_LOGINS=
# Funnel is a proxy on this Mac: listen on 127.0.0.1 only and read the client from X-Forwarded-For
TRUST_PROXY=1
PORT=8787
EOF
}

# Values are XML-escaped: a repo path may hold & or <.
xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>--env-file=$(xml "$ENV_FILE")</string>
    <string>--import</string>
    <string>tsx</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$REPO/server")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
}

echo "Murmur from $REPO, run by $NODE ($("$NODE" -v))"
[ "$DRY" = 1 ] && echo "Dry run: nothing is written, built or started."

step "1/5 Settings folder $HOME_DIR (owner-only)"
run mkdir -p -m 700 "$HOME_DIR"

step "2/5 Env file $ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  echo "    Kept: it already exists."
else
  echo "    Writing this template (0600):"
  env_template | sed 's/^/    | /'
  if [ "$DRY" = 0 ]; then
    (umask 077 && env_template >"$ENV_FILE")
    echo
    echo "Fill in BASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and MURMUR_ALLOWED_LOGINS"
    echo "in $ENV_FILE, then run this script again."
    exit 0
  fi
fi
if [ "$DRY" = 0 ]; then
  for k in BASE_URL GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET MURMUR_DATA_DIR; do
    grep -Eq "^$k=.+" "$ENV_FILE" || { echo "    $k is empty in $ENV_FILE. Fill it in and run this script again." >&2; exit 1; }
  done
  grep -Eq "^MURMUR_ALLOWED_LOGINS=.+" "$ENV_FILE" ||
    echo "    Warning: MURMUR_ALLOWED_LOGINS is empty, so anyone with a GitHub account can sign in."
fi

step "3/5 Install dependencies and build the web app"
command -v pnpm >/dev/null || [ "$DRY" = 1 ] || { echo "    pnpm is not on PATH (npm i -g pnpm)." >&2; exit 1; }
run pnpm -C "$REPO" install --frozen-lockfile
run pnpm -C "$REPO" --filter @murmur/web build

step "4/5 LaunchAgent $PLIST"
echo "    Writing:"
plist | sed 's/^/    | /'
if [ "$DRY" = 0 ]; then
  mkdir -p "$(dirname "$PLIST")"
  plist >"$PLIST"
fi

step "5/5 Start (or restart) the server"
run launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
PORT=$( (grep -E '^PORT=' "$ENV_FILE" 2>/dev/null || true) | tail -1 | cut -d= -f2)
PORT=${PORT:-8787}
if [ "$DRY" = 0 ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "    Something else is listening on port $PORT:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  echo "    Stop it (or change PORT here and in tailscale funnel), then run this script again." >&2
  exit 1
fi
run launchctl bootstrap "gui/$(id -u)" "$PLIST"
[ "$DRY" = 1 ] && exit 0

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  echo "    Up: http://127.0.0.1:$PORT/healthz answers ok."
  tail -n 3 "$LOG" | sed 's/^/    log: /'
else
  echo "    The server did not answer within 30 s. Last lines of $LOG:" >&2
  tail -n 20 "$LOG" >&2
  exit 1
fi
