#!/bin/bash
# Stops Murmur and removes its LaunchAgent. Keeps ~/.murmur-server (env, data, log).
set -euo pipefail

LABEL=in.murmur.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> Stop the server and unload the LaunchAgent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "    Stopped." || echo "    Was not running."

echo "==> Remove $PLIST"
if [ -f "$PLIST" ]; then rm "$PLIST" && echo "    Removed."; else echo "    Already gone."; fi

echo
echo "Kept $HOME/.murmur-server (settings, database, log)."
echo "To delete everyone's Murmur data for good: rm -rf ~/.murmur-server"
