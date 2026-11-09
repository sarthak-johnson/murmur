---
description: Connect this machine to your Murmur account
argument-hint: "[server URL]"
allowed-tools: Bash(murmur login:*)
---
Connect this machine to Murmur.

The server address the user typed after the command, which may be empty:
<server>$ARGUMENTS</server>

1. If it is empty, run `murmur login` with the Bash tool.
2. Otherwise, check that the whole address matches `^https?://[A-Za-z0-9.-]+(:\d+)?/?$`: a scheme, a host, an optional port, and nothing else.
   If it does not match, reply only "That is not a Murmur server address. Use one like https://my-mac.tail1234.ts.net." and run nothing.
3. If it matches, run `murmur login <address>` with the Bash tool, with the address exactly as checked and nothing else on the command line.

Show the command's output to the user exactly as written, with nothing added or changed.
