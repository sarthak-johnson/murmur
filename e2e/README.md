# End-to-end with real Claude Code

`pnpm e2e` from the repo root runs one real Claude Code session through the whole chain: plugin hooks and narration, server, reducer, web page.
It is not part of `pnpm -r test` or CI, because it costs money and needs a logged-in `claude` CLI.

## What it does

1. Builds `web/dist` and starts the server on a random free port with `DATABASE_URL=memory://` and `MURMUR_DEV_LOGIN=1`.
2. Signs in as `e2e` through `/auth/dev`, runs `murmur login` with `MURMUR_HOME` in a temp dir, and approves the code through the API.
3. Makes a fresh git repo in a temp dir with a fake `ANTHROPIC_API_KEY` in `.env`, and runs `murmur on` for it.
4. Runs `claude -p` there with `--plugin-dir plugin`, `--setting-sources project,local` (so your own plugins and hooks stay out), `--permission-mode acceptEdits`, `--model sonnet` and `--max-budget-usd 1`.
5. Asserts on `reduce` over the session's events: one request, a plan from `map`, at least one part, a `now` from `narrate`, `math.js` touched with lines added, and no event carrying the fake key.
6. Opens the live page (1440x900 and 375x812) and the first part's drill-down (1440x900) in Chromium and saves screenshots.

At the end it stops the server, kills the login poller and deletes the temp dirs.

## Output

Everything lands in `e2e/screens/` (git-ignored): the screenshots, `claude-result.json` (Claude's JSON output, with `total_cost_usd`), `events.json` (what the server stored) and `transcript.jsonl` (the Claude Code transcript).

## Needs

- `claude` on the PATH and logged in. One run costs about 0.10 to 0.25 USD.
- A Chromium build for `playwright` 1.64.1 (revision 1248) in `~/Library/Caches/ms-playwright`.
  If it is missing, run `npx playwright@1.64.1 install chromium` once.
