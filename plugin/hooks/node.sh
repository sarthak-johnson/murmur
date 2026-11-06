#!/bin/sh
# Starts a bundled entry point with node. Without node on PATH, the SessionStart hook
# says so and everything exits 0, so Claude is never blocked. Builtins only below.
if command -v node >/dev/null 2>&1; then exec node "$@"; fi
case $1 in
*/hook.cjs)
  input=
  while IFS= read -r line || [ -n "$line" ]; do input="$input$line"; done
  case $input in
  *'"SessionStart"'*) echo '{"systemMessage":"Murmur needs Node.js 22 or newer on PATH."}' ;;
  esac
  ;;
esac
exit 0
