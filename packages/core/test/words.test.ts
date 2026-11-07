import { describe, expect, test } from "vitest";
import { type MurmurEvent, reduce } from "../src/index.js";
import { at, MAP, mapCall, prompt, tool } from "./helpers.js";

const call = (n: number, description: string, text = `Please ${description}`) =>
  tool(
    n,
    "Agent",
    { description, prompt: text, subagent_type: "general-purpose" },
    "PreToolUse",
  );
const start = (n: number, id: string) =>
  at(n, "SubagentStart", { agent_id: id, agent_type: "general-purpose" });
const said = (n: number, text: string, extra = {}) =>
  at(n, "AssistantText", { text, ...extra });
/** A notification for the Agent call at `n` (tool use id `t<n>`), as Claude Code sends it. */
const notice = (
  n: number,
  use: number,
  {
    status = "completed",
    summary = 'Agent "x" finished',
    note = "",
    result = "All done.",
  } = {},
) =>
  prompt(
    n,
    `<task-notification>\n<task-id>a${use}</task-id>\n<tool-use-id>t${use}</tool-use-id>\n<output-file>/tmp/x.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n${note ? `<note>${note}</note>\n` : ""}<result>${result}</result>\n</task-notification>`,
  );
const WAITING =
  "This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports, and the same task-id notifies again if it does; the result below may be interim.";

const agent = (events: MurmurEvent[], id = "a1") =>
  reduce(events)
    .requests.flatMap((r) => r.agents)
    .find((a) => a.id === id);

describe("helper reports", () => {
  test("a notification attaches to the helper its Agent call started, unescaped", () => {
    const a = agent([
      prompt(0, "go"),
      call(1, "Implement Task 1: tokens"),
      start(2, "a1"),
      notice(9, 1, {
        result:
          "Status: DONE\n\nRun `node shoot.mjs &lt;page&gt;` &amp; look at &quot;it&quot;, it&#39;s fine. Keep `&amp;lt;` as written.",
      }),
    ]);
    expect(a?.report).toEqual({
      status: "completed",
      summary: 'Agent "x" finished',
      // Decoded once, so an escaped entity in the report stays as the helper wrote it.
      text: 'Status: DONE\n\nRun `node shoot.mjs <page>` & look at "it", it\'s fine. Keep `&lt;` as written.',
      verdict: "DONE",
      ts: "2026-11-06T00:00:09.000Z",
      interim: false,
    });
  });

  test("an interim report is replaced by the final one, even in a later request", () => {
    const events = [
      prompt(0, "go"),
      call(1, "Build style A"),
      start(2, "a1"),
      notice(5, 1, {
        summary: 'Agent "Build style A" is waiting on its own background work',
        note: WAITING,
        result: "Waiting for the suite.",
      }),
    ];
    expect(agent(events)?.report).toMatchObject({
      interim: true,
      text: "Waiting for the suite.",
    });
    const later = agent([
      ...events,
      prompt(6, "next thing"),
      notice(8, 1, { result: "**Status:** DONE_WITH_CONCERNS\nOne gap." }),
    ]);
    expect(later?.report).toMatchObject({
      interim: false,
      text: "**Status:** DONE_WITH_CONCERNS\nOne gap.",
      verdict: "DONE_WITH_CONCERNS",
      ts: "2026-11-06T00:00:08.000Z",
    });
  });

  test("a failed helper reports failed; a first line that is not a verdict gives none", () => {
    const a = agent([
      prompt(0, "go"),
      call(1, "Fix bug B1"),
      start(2, "a1"),
      notice(4, 1, { status: "failed", result: "**Status:** All five fixed." }),
    ]);
    expect(a?.report?.status).toBe("failed");
    expect(a?.report).not.toHaveProperty("verdict");
  });

  test("a notification for an unknown call attaches nowhere", () => {
    const view = reduce([
      prompt(0, "go"),
      call(1, "Fix bug B1"),
      start(2, "a1"),
      notice(4, 77),
    ]);
    expect(view.requests[0]?.agents[0]).not.toHaveProperty("report");
  });

  test("a foreground helper's report is its Agent result text", () => {
    const a = agent([
      prompt(0, "go"),
      call(1, "Review Task 2"),
      start(2, "a1"),
      at(6, "PostToolUse", {
        tool_name: "Agent",
        tool_use_id: "t1",
        tool_response: {
          status: "completed",
          agentId: "a1",
          content: [
            {
              type: "text",
              text: "<tools-used-before-summary>Read</tools-used-before-summary>\n",
            },
            { type: "text", text: "Status: BLOCKED\nThe brief is missing." },
          ],
        },
      }),
    ]);
    expect(a?.report).toEqual({
      status: "completed",
      summary: "",
      text: "Status: BLOCKED\nThe brief is missing.",
      verdict: "BLOCKED",
      ts: "2026-11-06T00:00:06.000Z",
      interim: false,
    });
  });

  test("a background launch result is not a report", () => {
    const a = agent([
      prompt(0, "go"),
      call(1, "Review Task 2"),
      start(2, "a1"),
      at(3, "PostToolUse", {
        tool_name: "Agent",
        tool_use_id: "t1",
        tool_response: {
          status: "async_launched",
          agentId: "a1",
          content: [{ type: "text", text: "Async agent launched" }],
        },
      }),
    ]);
    expect(a).not.toHaveProperty("report");
  });

  test("notifications stay out of requests and titles", () => {
    const view = reduce([
      prompt(0, "go"),
      call(1, "x"),
      start(2, "a1"),
      notice(3, 1),
    ]);
    expect(view.requests).toHaveLength(1);
    expect(view.title).toBe("go");
  });
});

describe("messages", () => {
  test("every AssistantText between this prompt and the next, in time order", () => {
    const view = reduce([
      said(0, "before any prompt"),
      prompt(1, "first"),
      said(3, "Second thing."),
      said(2, "First thing."),
      said(4, "   "),
      notice(5, 99),
      said(6, "After a notification."),
      prompt(7, "second"),
      said(8, "Next request."),
    ]);
    const [one, two] = view.requests;
    expect(one?.messages).toEqual([
      { id: "e2", ts: "2026-11-06T00:00:02.000Z", text: "First thing." },
      { id: "e3", ts: "2026-11-06T00:00:03.000Z", text: "Second thing." },
      {
        id: "e6",
        ts: "2026-11-06T00:00:06.000Z",
        text: "After a notification.",
      },
    ]);
    expect(two?.messages?.map((m) => m.text)).toEqual(["Next request."]);
  });

  test("a request with no messages has an empty list", () => {
    expect(reduce([prompt(0, "go")]).requests[0]?.messages).toEqual([]);
  });

  test("a message after a report, in the same turn, names its helper", () => {
    const view = reduce([
      prompt(0, "go"),
      call(1, "Build style A"),
      start(2, "a1"),
      said(3, "Started the builder."),
      notice(5, 1),
      said(6, "The builder is done; checking its shots."),
      tool(7, "Bash", { command: "ls" }),
      said(8, "Shots look right."),
      at(9, "Stop", {}),
      said(10, "Anything else?"),
    ]);
    expect(
      view.requests[0]?.messages?.map((m) => [m.text, m.agent ?? null]),
    ).toEqual([
      ["Started the builder.", null],
      ["The builder is done; checking its shots.", "a1"],
      ["Shots look right.", "a1"],
      ["Anything else?", null],
    ]);
  });

  test("a new helper starting ends the link to the last report", () => {
    const view = reduce([
      prompt(0, "go"),
      call(1, "Build style A"),
      start(2, "a1"),
      notice(3, 1),
      call(4, "Review style A"),
      said(5, "Sent it for review."),
    ]);
    expect(view.requests[0]?.messages?.[0]).not.toHaveProperty("agent");
  });
});

describe("message task links", () => {
  // Inferred parts: task:1, task:4-5, item:B7, item:B1, and one with no subject.
  const inferred = (text: string) =>
    reduce([
      prompt(0, "go"),
      call(1, "Implement Task 1: Lit plate tokens"),
      start(2, "a1"),
      call(3, "Implement Tasks 4-5: surfaces, controls"),
      start(4, "a2"),
      call(5, "Fix B7: agent money speed"),
      start(6, "a3"),
      call(7, "Fix bug B1: closed trades disagree"),
      start(8, "a4"),
      call(9, "Phase 0 review against prototype"),
      start(10, "a5"),
      call(11, "Implement Task 10: shell sweep"),
      start(12, "a6"),
      said(20, text),
    ]).requests[0]?.messages?.[0]?.task;

  test.each([
    ["Task 1 is in: the plate tokens landed.", "task:1"],
    ["Tasks 4 and 5 both pass review.", "task:4-5"],
    ["Tasks 4-5 are merged.", "task:4-5"],
    ["Task 5 needs one more fix.", "task:4-5"],
    ["B7 is fixed: money loads first.", "item:B7"],
    ["The bug B1 fix is approved.", "item:B1"],
    ["Bug 1 is closed.", "item:B1"],
    ["Task 10 sweep is clean.", "task:10"],
    ["Task 1 and Task 1 again.", "task:1"],
  ])("%s -> %s", (text, want) => {
    expect(inferred(text)).toBe(want);
  });

  test.each([
    ["Task 1 and B7 are both done."],
    ["Task 3 has not started."],
    ["Phase 0 review is back."],
    ["All done, nothing named."],
    ["The Lit plate tokens are in."],
  ])("unsure: %s", (text) => {
    expect(inferred(text)).toBeUndefined();
  });

  const narrated = (text: string) =>
    reduce([prompt(0, "add alerts"), mapCall(1, MAP), said(5, text)])
      .requests[0]?.messages?.[0]?.task;

  test("on a narrated request, a task title or a one-task part title it contains", () => {
    expect(narrated("The endpoint to list alerts works now.")).toBe("2.2");
    expect(narrated("I made the alerts table first.")).toBe("1.1");
    // "Alerts API" has two tasks, so the part alone says too little.
    expect(narrated("The alerts API is next.")).toBeUndefined();
    expect(
      narrated("Endpoint to save an alert and endpoint to list alerts done."),
    ).toBeUndefined();
  });
});

describe("helper brief", () => {
  const briefOf = (text: string) =>
    agent([prompt(0, "go"), call(1, "x", text), start(2, "a1")])?.brief;

  test("skips pointer and rule sentences, keeps the work, as plain text", () => {
    expect(
      briefOf(
        [
          "You are re-reviewing one task's fix round in the **lit-plate** worktree. Read-only: never mutate the working tree. Do not dispatch subagents.",
          "",
          "Task brief: /Users/x/.superpowers/sdd/task-2-brief.md",
          "",
          "Findings under verification:",
          "1. Important: commas render as squares.",
        ].join("\n"),
      ),
    ).toBe(
      "You are re-reviewing one task's fix round in the lit-plate worktree.",
    );
    expect(
      briefOf(
        "Read this brief first and follow it exactly: /tmp/BRIEF.md\n\nPortfolio, Screener and Stock are already built in this style. Look at `check-portfolio.png` for consistency.",
      ),
    ).toBe("Portfolio, Screener and Stock are already built in this style.");
  });

  test("takes the paragraph under ## Context when there is one", () => {
    expect(
      briefOf(
        "# Task 3\n\nRead /tmp/plan.md first.\n\n## Context\n\nThe dot field sits behind the plate. It must never move on scroll.\n\n## Rules\n\nCommit often.",
      ),
    ).toBe(
      "The dot field sits behind the plate. It must never move on scroll.",
    );
  });

  test("at most 600 characters, cut at a sentence end", () => {
    const sentence = "The plate glows blue and carries one number. ";
    const b = briefOf(sentence.repeat(20)) as string;
    expect(b.length).toBeLessThanOrEqual(600);
    expect(b.endsWith("one number.")).toBe(true);
  });

  test("a prompt that only points at files has no brief", () => {
    expect(briefOf("Read the brief first: /tmp/BRIEF.md")).toBeUndefined();
  });
});

describe("recap", () => {
  test("a map marked recap: true marks its request; a later live map clears it", () => {
    const recap = {
      ...mapCall(1, MAP),
      payload: { ...mapCall(1, MAP).payload, recap: true },
    };
    const [req] = reduce([prompt(0, "add alerts"), recap]).requests;
    expect(req).toMatchObject({ recap: true, planInferred: false });
    const [live] = reduce([
      prompt(0, "add alerts"),
      recap,
      mapCall(2, MAP),
    ]).requests;
    expect(live).not.toHaveProperty("recap");
    expect(reduce([prompt(0, "go")]).requests[0]).not.toHaveProperty("recap");
  });
});
