# Murmur: screens that explain, designed like a product

The author on 7 Nov 2026, after using the app on his real session: "the data is all raw", "looks like a college project", "we made AlphaTake and Tradara look great, why is this one so plain".
Clicking a step's "raw ›" shows the event JSON; "See the brief" shows a 2,800-character prompt in a cramped monospace box; nothing says what happened or why.
Audit and the approved direction, with mocks built from his real session: `reports/audit/murmur-audit.html` (open it in a browser and read it before you start; the two mocks are the target).

## Data you can rely on

From the data-layer change (already merged into your base, read `packages/core/src/view/types.ts`):
`RequestView.messages` (Claude's own messages in order, with `task` / `agent` links when known), `AgentView.report` (status, summary, full text, verdict line like `DONE_WITH_CONCERNS`), `AgentView.brief` (the brief's opening paragraph), Bash `bashEditDiff` file changes, and requests recapped by the user's own Claude (`recap: true` map and narrate events, drawn on the narrated path).

## What to build (web only: `web/src`, `web/test`, `web/index.html`, theme)

1. **Request page, story first** (mock 1).
   - Header: the request, then Claude's opening line for it (its first message after the prompt) with "Claude · 10:06".
   - A summary band: status pill (Running / Done / Needs you), tasks, how many were sent back after review, helpers, duration.
   - "What happened": Claude's messages as a timeline (time, task chip, a moment badge, the message). Badge rules, plain and conservative: "review found", "problem", "failed", "broke" → Problem found; "fix", "sent back", "fixing" → Fixing; "done", "passed", "verified" → Done; "instead of", "not ", "changed", "decided", "rather than" → Decision; "added a task", "added an" → Plan changed; otherwise no badge.
     Show the newest first while the request runs, oldest first once it is done; long messages fold after 4 lines with "Show more".
     Markdown in messages (bold, lists, code, links) renders as formatted text, never as raw symbols.
   - Right column: the plan, each task with a one-line outcome (from the recap's line, else the last linked message, else the last helper's verdict).
   - The map stays, below the story, unchanged in behaviour.
2. **Task / part page** (mock 2).
   - Title, status pill, a band (time span, helpers, fix rounds, commits parsed from `Commit: <hash>` lines in reports).
   - "What it was for": the recap's aim, else the first helper's brief paragraph, with its source in small type.
   - "How it went": one card per step (Built, Reviewed, Fixed, Re-reviewed …) with the model, the time, a verdict pill from the report, Claude's message from that moment, and "Helper's full report" opening the report rendered as formatted Markdown in a readable panel (not monospace, comfortable width).
   - "Left open": the bullets under a report's `Concerns:` heading, plus recap choices marked as assumptions.
   - "Files": the files with +/− counts; clicking one opens its diff in a proper diff view (line numbers, added and removed lines tinted, hunks separated), long diffs folded.
3. **No raw data anywhere by default.**
   Every event a user can open reads as what it is: a command shows as a terminal block (the command, its output's first lines, exit status), an Edit or Write as a diff, a Read as "Read `path`", a helper call as its brief and report, a narrate or map call as its text, an MCP tool as its name and main inputs.
   The JSON stays reachable only behind a small "Event data" toggle at the bottom of that view.
4. **Design quality.**
   Use the frontend-design skill before you start.
   Dark only (the product's decision), calm and ordered, never a wall of data; one clear hierarchy per screen; a real type scale (pick a characterful but readable pairing from Google Fonts, self-hosted is not needed since the server serves `web/dist`), consistent spacing on a 4 px grid, status shown by shape and colour together, subtle depth on the two or three surfaces that matter, focus states, `prefers-reduced-motion`.
   Keep the existing tokens' meaning (now / done / agent / bad colours) but feel free to refine values and add tokens.
   Everything must fit at 1440 × 900 and 1280 × 800 without horizontal scroll; nothing cut mid-word; no empty boxes (a section with nothing to show is not drawn).
5. **Markdown.** Render with a small safe renderer that builds React elements (headings, bold, italic, inline code, code blocks, lists, links opening in a new tab); never `dangerouslySetInnerHTML`. Write it yourself in a few dozen lines unless a tiny well-known dependency is clearly better; justify any dependency in the report.

## Tests (test first)

Web tests for: the story timeline (order while running and when done, badges, folding, markdown rendered), the summary band, plan outcome lines, the task page sections (each section hidden when empty), the report panel, commit parsing, the diff view, readable event views per tool, the "Event data" toggle, and no JSON text visible by default.

## Checks before you report

`pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, `pnpm --filter @murmur/web -s build`, each exit code checked on its own.
Then look at the real page with Playwright: open `http://localhost:8787/auth/dev?login=Sarthak` first, then `/s/27a000a1-7dbc-4dd1-ab83-961149fc03ae`; the server serves `web/dist` fresh, so a build is enough.
Screenshot at 1440 × 900: the newest request, "Yes please go ahead", "I love it, let's build it", the Task 1 page, Task 1's full report open, one file diff, and one command step.
Compare each with the mocks and fix what does not match or looks off before reporting; be picky (alignment, spacing, truncation, contrast).
Save them as `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/screens-*.png` and list them in the report.
