# Murmur screens: report

Branch `feat/screens`, web only (`web/src`, `web/test`, `web/index.html`).
No change to `packages/core`, `plugin` or `server`, and no new dependency.

## What I built, by file

- `web/src/markdown.tsx` (new): a small safe Markdown renderer that builds React elements only, never `dangerouslySetInnerHTML`.
  Headings (set below the page heading level), paragraphs that keep a single line break, fenced code, nested lists, ordered lists, quotes, tables, rules, bold, italic, inline code, links (http, https and mailto only, new tab, `noopener`) and bare web addresses.
  `Fold` shows the first lines of a long text with "Show more"; in a real layout it measures, so a text that fits never folds.
  `plainText` drops the marks for one-line summaries.
- `web/src/story.ts` (new): the plain readings the screens share.
  Moment badges (the brief's rules, in its order, matched from word starts on the text without Markdown marks), verdict label and tone, `Commit:` line parsing, the bullets under a `Concerns:` heading, a report's lead paragraph, fix rounds, tasks sent back after review, durations, clock times, and each task's outcome line (recap line, else last linked message, else last helper verdict).
- `web/src/Pill.tsx` (new): one status pill; tone shows by colour and by its marker's shape together (done circle, warn diamond, bad square, now ring, plain dash).
- `web/src/part/Diff.tsx` (new): the diff view with old and new line numbers, tinted added and removed lines, a separator per hunk ("Lines 584 to 606"), long diffs folded after 60 lines.
  It reads Edit and Write patches, created files, and a command's `bashEditDiff`, so it works the moment core counts command edits.
- `web/src/part/EventView.tsx` (new): every event as what it is.
  A command is a terminal block (description, `$ command`, first 12 output lines with "Show all N lines", and Succeeded, Failed with its exit code, Interrupted or No result yet).
  Edit and Write are a diff, Read is "Read path, lines a to b", a helper call is its description, model, brief and report, a narrate call is its text, a map call is its goal and plan, any other tool (MCP or not) is its name, its server and its main inputs, plus its text result.
  The raw event is only behind a small "Event data" toggle at the bottom.
- `web/src/live/Story.tsx` (new): `RequestHead` (Claude's opening line with "Claude, 10:06", then the summary band: Running, Done or Needs you, tasks, sent back after review, helpers, duration) and `Story` (What happened: time, task chip that opens the task, moment badge, the message as formatted text, folded after 4 lines; newest first while running, oldest first once done).
- `web/src/pages/Session.tsx`: the request page puts the head first; with messages it lays out the story beside a side column (Now while running, the plan, assumptions) and the map full width below; with no messages it keeps today's grid unchanged.
  The duration runs from the prompt to the request's last event before the next prompt.
- `web/src/live/PlanPanel.tsx`: each started task carries its outcome line; a recapped plan says "Recap by Claude" where an inferred one says "inferred".
- `web/src/live/NowCard.tsx`: an inferred now opens as the tool call it was read from (Details, then the terminal block); a command reads as its description, else in full (clamped to 3 lines), never cut at 60 characters; a finished request never shows a stale inferred now, it shows its Done line.
- `web/src/live/Notices.tsx`: the notice row now shares the band's line (still reserved, so nothing below moves); when the band already says "Needs you", the notice does not repeat the chip.
- `web/src/live/RequestList.tsx`: kinds in sentence case.
- `web/src/part/PartDetail.tsx`: the task page, rebuilt to mock 2.
  Title with status pill and problem pill, a band (time span, helpers, fix rounds, commit hashes), What it was for (recap or narration aim, else the first helper's brief, with its source), How it went (one card per step: model, time, verdict pill, Claude's message from that moment or the report's lead, "Helper's full report" and "Brief" opening as formatted Markdown in a readable panel; narrated steps open as event views), Who's on it (helpers that are not steps, as the same cards), Files changed (rows open the diff view), Choices it made, and a side column with Left open (report concerns plus Claude's assumptions), Checked so far, Words used here, What goes in and out, and In this request (the request's parts, to move between them).
  Recap steps carry made-up times, so they show none and the band leaves them out.
  Every section with nothing to show is not drawn.
- `web/src/theme.css`, `web/index.html`: the design pass (below) and the Google Fonts link.

## Design choices

- One hierarchy per screen: the request (or task) title, then Claude's words, then facts, then detail.
- Type: Instrument Sans for the interface, Newsreader for Claude's own words (messages, opening line, briefs, reports), JetBrains Mono for code, commands, paths and diffs.
  The serif is the one bold choice: the story reads as prose written by Claude, the chrome around it stays quiet.
  Scale 12.5 / 13 / 14 / 15.5 (reading) / 16 (story) / 17 (lead) / 22 and 24 (titles).
- Tokens keep their meaning (now blue, done green, agent amber, bad red), slightly lifted for contrast on the dark base; new `--sunk` for code, terminal, diff and report panels, `--text-2` for reading text, `--lift` for the step cards and plan only.
- Labels are sentence case, not tracked capitals; spacing on a 4 px grid; thin dark scrollbars; focus rings unchanged; reduced motion respected (the only motion is the existing fade).
- The task page drops its tiny map (its labels were unreadable at 340 px) for a plain list of the request's parts; the request page keeps the full map below the story.
- Checked at 1440 × 900 and 1280 × 800: no horizontal scroll (scroll width 1269 at 1280 with the scrollbar).
- A layout bug fixed on the way: the classic grid's `grid-area` rules leaked into the new side column and pushed the plan 16 px down; they now apply to `.live-grid` children only.

## Tests

173 web tests, all written before the code they cover:

- `web/test/markdown.test.tsx`: inline marks as elements and never raw symbols, code stays literal, unsafe links not linked, bare links, heading levels, nested and ordered lists, code blocks, tables, line breaks, quotes, Fold.
- `web/test/story.test.tsx`: badge rules, sent back and fix rounds, duration, commit parsing, concerns parsing, verdicts, report lead, outcome lines (recap, message, verdict), clock; the request page head, band (Done, Running, Needs you, zero counts skipped), timeline order while running and done, time and chip and badge per moment, chip opens the task, Markdown rendered, folding, plan outcome lines, map below the story, the no-messages fallback (no story, no opening line, today's Now card), opening line only, an inferred command now and its terminal block, no stale now on a finished request, a long command read in full, the recap label.
- `web/test/events.test.tsx`: command (output folding, exit status, failure, no result yet), Edit with and without a result, Write create, Read, helper call, narrate, map, MCP tool, the Event data toggle, no JSON visible by default, an unknown event, the diff view's numbers, tints, hunk separators and folding.
- `web/test/part.test.tsx`: updated for the new page (Details instead of raw, the diff view, sentence-case pills, Files changed) plus the band, What it was for (brief fallback, recap aim, inline code), step cards (model, time, verdict, Claude's message, report lead), the report panel as formatted Markdown, a running helper, Left open, hidden sections, a command's `bashEditDiff`, recap step times and helper cards.
- `web/test/live.test.tsx`: two existing tests adjusted to the new head row (the notice row now sits on the band's line; the needs-you chip is not repeated).

## Checks

Run from the worktree root, each on its own:

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 0 |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 (core 206, plugin 112, server 92, web 173) |
| `pnpm --filter @murmur/web -s build` | 0 |

## Screenshots

All 1440 × 900 unless named 1280, in `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/`.

The real session (`27a000a1-…`) through a Vite dev server on the real :8787 server.
The other builder re-imported it while I worked, so its old requests are now mapped by Claude's recap ("Yes please go ahead" is "Restyle the logged-in app to the Lit plate design…", "I love it, let's build it" is "Plan the Lit plate redesign…"); my branch's core does not compute messages or reports, so these show the fallback screens:

- `screens-real-newest.png`: the newest request (running), band, phase strip, Now card, helpers.
- `screens-real-command.png`: the newest request's Now opened as a command's terminal block.
- `screens-real-goahead.png`: "Yes please go ahead", Done band with 6 sent back after review, the Done card instead of a stale now.
- `screens-real-love.png`: "I love it, let's build it".
- `screens-real-task1.png`: the Task 1 page (recap part "Design tokens"): band, What it was for, How it went, Who's on it as cards, checks, words, the part list.
- `screens-real-diff.png`: Task 1's file diff.

The story and report parts with data: the same session's events plus Claude's real messages and helper reports, which I read from his transcript and attached to the view in a scratch page that is not committed (deleted after use):

- `screens-story-goahead.png`: "Yes please go ahead" story first, done, oldest first, plan with outcome lines.
- `screens-story-running.png`: the same request while running: newest first, Now in the side column.
- `screens-story-task1.png`: the inferred Task 1 page with its three step cards, Left open from the report's concerns, one commit.
- `screens-story-report.png`: Task 1's full report open.
- `screens-story-1280.png`, `screens-story-task1-1280.png`: both at 1280 × 800.

## Needs the real data to verify

- The story, opening line, plan outcome lines, step card messages, verdict pills, report panel, Left open and commits on the real page: all wait for core to fill `messages`, `report` and `brief` (other builder).
  I checked them with his real words in the scratch page, but core's own task and agent links will differ a little from my stand-in matching.
- "Recap by Claude", "From Claude's recap" and hidden recap step times: wait for core to set `RequestView.recap`; today his recapped requests read as narrated ("From Claude's narration", step times 15:35 that are really the prompt's time).
- A file diff from `bashEditDiff`: tested with hand-made data, not seen on real data yet.

## Suggestions for core (not changed)

- Helper report text arrives HTML-escaped from the task notification (`useStoredChoice &gt; survives…` in Task 1's report); core should unescape `&lt;`, `&gt;`, `&amp;`, `&quot;` and `&#39;` when it parses `<result>`.
- The recap leaves tasks of finished requests in progress ("Get approval" in "I love it", "Phase 1: My Agents" in "Yes please go ahead"), so a Done band sits over a running phase; the recap or the reducer should close a finished request's open tasks.
- `inferNow` cuts a command at 60 characters mid-word with no ellipsis; the web now shows the description or the full command itself, but core could prefer `tool_input.description` too.
- The moment badges follow the brief's rules exactly; on real messages "fix" fires often ("A commit I fixed", "small fixes") and wins over "not two" decisions because Problem and Fixing come first. If that reads as noise to the author, the next step is word lists tuned on his 190 messages rather than more rules.

## Round 2: fixes on real data

Done on `fix/backfill-whole-transcript` (core fills messages, reports, briefs and recap), checked on the author's re-imported session at http://localhost:8787 at 1440 × 900.

### What I fixed

1. **Overlapping side column on the running request.**
   The classic grid's named `grid-area` rules for the Now card, helpers, files and start line still applied inside the story's side column, where those areas do not exist, so all four landed in one cell.
   They now apply to `.live-grid` children only; beside the story the column stacks Now, then running helpers, then files, with the file counts in their own columns.
   Checked with two helpers running and with a long Now line (clamped to three lines with an ellipsis).
   CSS only, so no unit test; checked in the browser.
2. **Badges are decided from the first sentence only, and conservatively** (`web/src/story.ts`).
   - Problem found: "review found", "found a/one/two … problem", "failed" (but not "none failed").
   - Fixing: "send/sending/sent (it) back", "back to the (same) builder".
   - Done: a task or phase that "is/are/was done/finished/complete", or "Task N passed".
   - Decision: "I/we … instead of / rather than", "decided", "changed the plan", or a choice with its reason ("X, not Y: …").
   - Plan changed: "added a/an … task".
   - Otherwise no badge.
     Over all 201 real messages (opening lines excluded): **no badge 165, Done 23, Problem found 12, Decision 1, Fixing 0, Plan changed 0**.
     Fixing is 0 because "I'm sending it back" always comes after a first sentence that already says the review found a problem.
3. **The timeline groups runs of messages about one task** (`web/src/live/Story.tsx`).
   A block shows the task title, its outcome line (left out when it only repeats a message shown in full), the first and last message, and "N more" for the middle.
   A message counts as about a task when core linked it to the task, or linked it to a helper whose part belongs to exactly one task: core sets that `agent` link when a report arrives, so this guesses nothing.
   Messages about no task stand alone; order stays newest first while running, oldest first when done.
   "Yes please go ahead": 83 messages now read as 53 items, 15 of them blocks.
4. **A folded finished phase reads "10 tasks, all done"** (or "N of M tasks done") with the expand toggle, instead of a run-on list of titles.
5. **Helper cards never show the prompt.**
   A card reads Claude's first message after that helper's report, else the report's lead paragraph (or its summary when that says more than "Agent X finished"), else the helper's brief when it is about the work, else nothing.
   A brief that only addresses the helper ("You are re-reviewing one task's fix round…", "Your job…") counts as prompt and is never shown, here or under What it was for.
   The card also takes Claude's first message after the report, not a later aside ("Logged on the tracker…").
6. **Report entities.**
   Core already decodes the notification's `<result>` once (`unentity` in `packages/core/src/view/words.ts`), and the real Task 1 report reads `useStoredChoice > survives…` on the page, with no entity left anywhere.
   I widened the core test to all five entities and to "decoded once, so `&amp;lt;` stays `&lt;`".
   No core code changed, so `plugin/dist` did not change.
7. **"Done when" has its own label style**, a small muted label before the condition, on its own line under the aim.

### Tests

New or changed, each seen failing first:
- badge rules with real false positives as cases ("The build has started…", "Still waiting: Task 20's second fix round…", "Applying the re-review's small fixes…", "…none failed", "…instead of about 20");
- task blocks (first, last, "N more", outcome line, standalone messages, a one-message task, newest first while running, an outcome that would repeat a shown message);
- a helper-linked message joining its task's block;
- the folded phase count;
- helper card text (message, report lead, a brief that addresses the helper hidden, a brief about the work shown, first message after the report);
- the Done when label;
- the core entities test.

### Checks

| Check | Exit code |
| --- | --- |
| `pnpm -s lint` | 0 |
| `pnpm -s typecheck` | 0 |
| `pnpm -s test` | 0 (core 241, plugin 140, server 92, web 180) |
| `pnpm -s build:plugin` | 0 (no change to `plugin/dist`) |
| `pnpm --filter @murmur/web -s build` | 0 |

### Screenshots

In `/Users/sarprasa/.claude/jobs/0a6793ec/tmp/`, 1440 × 900:
- `round2-newest.png`: the running request: story newest first, Now, two helpers running, files, no overlap.
- `round2-newest-long-now.png`: the side column with a long Now line.
- `round2-goahead.png`, `round2-goahead-groups.png`: "Yes please go ahead", the folded Phase 0 ("10 tasks, all done") and a Task 1 block.
- `round2-love.png`: "I love it, let's build it".
- `round2-task1.png`: the Task 1 page ("Lit plate tokens", Recap by Claude, Done when label, recap steps without made-up times, helper cards, 6 files).
- `round2-report.png`: the reviewer's full report open.

### Still open, for core

- Core links a message to a task only when the whole message names one subject, so "Task 1 is now in review. Once it passes, I'll start Task 2" stays unlinked and splits Task 1's block.
  Linking by the one subject named in the first sentence would shorten "Yes please go ahead" further; that belongs in core's linker, not in the web.
- Core's brief for reviewers is the prompt's role paragraph ("You are reviewing one task's implementation…"); the web now hides it, but `briefOf` should skip paragraphs that address the helper.
- On the newest request all helpers sit on the one mapped task "Dispatch the first builder and review its work", so their messages group under that title although they are about Tasks 20 to 26; a finer plan from narration would fix that.
