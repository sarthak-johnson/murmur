import { describe, expect, test } from "vitest";
import {
  keyMoments,
  type MapInput,
  type MurmurEvent,
  reduce,
} from "../src/index.js";
import {
  at,
  edit,
  MAP,
  mapCall,
  narrateCall,
  note,
  prompt,
  tool,
} from "./helpers.js";

const ts = (n: number) =>
  new Date(Date.parse("2026-11-06T00:00:00.000Z") + n * 1000).toISOString();
const said = (n: number, text: string) => at(n, "AssistantText", { text });
const call = (n: number, description: string, brief?: string) =>
  tool(
    n,
    "Agent",
    {
      description,
      prompt: brief ?? `Please ${description}`,
      subagent_type: "general-purpose",
    },
    "PreToolUse",
  );
const start = (n: number, id: string) =>
  at(n, "SubagentStart", { agent_id: id, agent_type: "general-purpose" });
const stop = (n: number, id: string) =>
  at(n, "SubagentStop", { agent_id: id, agent_type: "general-purpose" });
const by = (e: MurmurEvent, id: string): MurmurEvent => ({
  ...e,
  payload: { ...e.payload, agent_id: id },
});
/** A foreground helper: its call at `n`, start, stop, and its report at `n + 3`. */
const helper = (
  n: number,
  description: string,
  id: string,
  report = "Status: DONE\nAll good.",
  brief?: string,
) => [
  call(n, description, brief),
  start(n + 1, id),
  stop(n + 2, id),
  at(n + 3, "PostToolUse", {
    tool_name: "Agent",
    tool_use_id: `t${n}`,
    tool_input: { description },
    tool_response: {
      status: "completed",
      agentId: id,
      content: [{ type: "text", text: report }],
    },
  }),
];
const done = (n: number, task: string) =>
  narrateCall(n, note({ task, taskStatus: "done" }));
const recap = (e: MurmurEvent): MurmurEvent => ({
  ...e,
  payload: { ...e.payload, recap: true },
});

/** Phase 0 with tasks named for their subjects, and a docs task with none. */
const LIT: MapInput = {
  kind: "feature",
  goal: "Lit plate foundation",
  phases: [
    {
      id: "p0",
      title: "Phase 0: foundation",
      tasks: [
        { id: "t1", title: "Task 1: tokens", part: "tokens" },
        { id: "t2", title: "Task 2: hero", part: "hero" },
      ],
    },
    {
      id: "p1",
      title: "Write it up",
      tasks: [{ id: "t3", title: "Write the docs", part: "docs" }],
    },
  ],
  parts: [
    { id: "tokens", title: "Lit plate tokens", phase: "p0" },
    { id: "hero", title: "HeroMoney", phase: "p0" },
    { id: "docs", title: "The docs", phase: "p1" },
  ],
};

describe("phases own messages by time", () => {
  test("a message joins the phase whose window holds it; a named task wins", () => {
    const [req] = reduce([
      prompt(0, "add alerts"),
      mapCall(1, MAP),
      said(2, "Starting with the data."),
      narrateCall(3, note({ task: "1.1", taskStatus: "running" })),
      said(4, "Writing the table."),
      narrateCall(5, note({ task: "2.1", taskStatus: "running" })),
      said(6, "Now the save endpoint."),
      said(7, "The Alerts table needs one more index."),
    ]).requests;
    expect(req?.messages?.map((m) => [m.id, m.task, m.phase])).toEqual([
      ["e2", undefined, "1"],
      ["e4", undefined, "1"],
      ["e6", undefined, "2"],
      ["e7", "1.1", "1"],
    ]);
  });

  test("a recap's narrates have no real time, so its helpers set the windows", () => {
    const [req] = reduce([
      prompt(0, "go"),
      recap(mapCall(1, LIT)),
      recap(done(2, "t1")),
      recap(done(3, "t2")),
      recap(done(4, "t3")),
      // The recap ends on a narrate with no part, as the plugin writes it.
      recap(narrateCall(5, { now: "Lit plate foundation", why: "" })),
      said(6, "Starting on the tokens."),
      ...helper(10, "Implement Task 1: tokens", "a1"),
      said(14, "Tokens are in."),
      ...helper(20, "Write the docs page", "a2"),
      said(30, "Docs next."),
    ]).requests;
    // a2 has no subject and no part, so phase p1 has no window yet.
    expect(req?.messages?.map((m) => m.phase)).toEqual(["p0", "p0", "p0"]);
    expect(req?.beyond).toBeUndefined();
  });

  test("phases side by side: the narrowest window holding a message wins", () => {
    const [req] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      // Phase p0 runs from 2 to 20; p1's one burst of work sits inside it.
      narrateCall(2, note({ task: "t1", taskStatus: "running" })),
      said(5, "Task work goes on."),
      narrateCall(8, note({ task: "t3", taskStatus: "running" })),
      said(9, "The docs page is up."),
      narrateCall(10, note({ task: "t3", taskStatus: "done" })),
      said(15, "Still on the tokens."),
      narrateCall(20, note({ task: "t1", taskStatus: "done" })),
      said(25, "All quiet."),
    ]).requests;
    // After every window, the phase begun last.
    expect(req?.messages?.map((m) => m.phase)).toEqual([
      "p0",
      "p1",
      "p0",
      "p1",
    ]);
  });

  test("a message that only names a later task does not open its phase", () => {
    const [req] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      narrateCall(2, note({ task: "t1", taskStatus: "running" })),
      said(3, "First the tokens, then Write the docs at the end."),
      said(4, "Tokens half done."),
      narrateCall(5, note({ task: "t1", taskStatus: "done" })),
      narrateCall(6, note({ task: "t3", taskStatus: "running" })),
      said(7, "Writing it up now."),
    ]).requests;
    expect(req?.messages?.map((m) => [m.task, m.phase])).toEqual([
      ["t3", "p1"],
      [undefined, "p0"],
      [undefined, "p1"],
    ]);
  });

  test("a request with no plan leaves phase unset", () => {
    const [req] = reduce([prompt(0, "hi"), said(1, "Hello.")]).requests;
    expect(req?.messages?.[0]?.phase).toBeUndefined();
  });
});

describe("beyond the plan", () => {
  const base = [
    prompt(0, "add alerts"),
    mapCall(1, MAP),
    done(2, "1.1"),
    tool(3, "Bash", { command: "ls" }, "PreToolUse"),
    done(4, "2.1"),
    done(5, "2.2"),
  ];

  test("unset when only a closing message follows", () => {
    const [req] = reduce([
      ...base,
      said(6, "All done."),
      at(7, "Stop"),
    ]).requests;
    expect(req?.beyond).toBeUndefined();
    expect(req?.messages?.[0]?.phase).toBe("2");
  });

  test("work after the last task turned done goes beyond, with its messages", () => {
    const [req] = reduce([
      ...base,
      said(6, "The plan is finished."),
      tool(7, "Bash", { command: "pnpm test" }, "PreToolUse"),
      ...helper(8, "Fix Task 9 typo", "h1"),
      said(12, "Fixed a typo too."),
    ]).requests;
    expect(req?.beyond).toEqual({
      since: ts(5),
      agents: ["h1"],
      messages: ["e6", "e12"],
      rounds: 0,
    });
    expect(req?.messages?.map((m) => m.phase)).toEqual([undefined, undefined]);
  });

  test("unset while a task is not done", () => {
    const [req] = reduce([
      ...base.slice(0, 5),
      tool(6, "Bash", { command: "pnpm test" }, "PreToolUse"),
    ]).requests;
    expect(req?.beyond).toBeUndefined();
  });

  test("a task going back to running moves the start to the last time all were done", () => {
    const [req] = reduce([
      ...base,
      narrateCall(6, note({ task: "2.2", taskStatus: "running" })),
      tool(7, "Bash", { command: "pnpm test" }, "PreToolUse"),
      done(8, "2.2"),
      tool(9, "Bash", { command: "git push" }, "PreToolUse"),
    ]).requests;
    expect(req?.beyond?.since).toBe(ts(8));
  });

  test("a helper still working after the plan is done counts", () => {
    const [req] = reduce([
      prompt(0, "add alerts"),
      mapCall(1, MAP),
      call(2, "Build Task 38: capture"),
      start(3, "h1"),
      done(4, "1.1"),
      done(5, "2.1"),
      done(6, "2.2"),
      by(tool(7, "Bash", { command: "pnpm test" }, "PreToolUse"), "h1"),
    ]).requests;
    expect(req?.beyond).toEqual({
      since: ts(6),
      agents: ["h1"],
      messages: [],
      rounds: 0,
    });
  });
});

describe("request state", () => {
  test("running: the last request with no Stop", () => {
    const [req] = reduce([
      prompt(0, "x"),
      tool(1, "Bash", { command: "ls" }),
    ]).requests;
    expect(req?.state).toBe("running");
  });

  test("done: a Stop ends it", () => {
    const [req] = reduce([
      prompt(0, "x"),
      said(1, "Done."),
      at(2, "Stop"),
    ]).requests;
    expect(req?.state).toBe("done");
    expect(req?.waiting).toBeUndefined();
  });

  test("waiting, with the questions of a pending AskUserQuestion", () => {
    const [req] = reduce([
      prompt(0, "x"),
      tool(
        1,
        "AskUserQuestion",
        {
          questions: [
            { question: "Dark only or keep light?", header: "Light" },
            { question: "Ship today?", header: "When" },
          ],
        },
        "PreToolUse",
      ),
      at(2, "Notification", {
        notification_type: "elicitation_dialog",
        message: "Claude has a question",
      }),
    ]).requests;
    expect(req?.state).toBe("waiting");
    expect(req?.waiting).toEqual(["Dark only or keep light?", "Ship today?"]);
  });

  test("waiting, with the question sentences of the last message", () => {
    const [req] = reduce([
      prompt(0, "x"),
      said(
        1,
        "I made two styles. Which one do you like? Or should I make a third?",
      ),
      at(2, "Stop"),
      at(3, "Notification", {
        notification_type: "idle_prompt",
        message: "Claude is waiting for your input",
      }),
    ]).requests;
    expect(req?.state).toBe("waiting");
    expect(req?.waiting).toEqual([
      "Which one do you like?",
      "Or should I make a third?",
    ]);
  });

  test("left-open: a later request came while plan tasks remain", () => {
    const [a, b] = reduce([
      prompt(0, "a"),
      mapCall(1, MAP),
      done(2, "1.1"),
      at(3, "Stop"),
      prompt(4, "b"),
    ]).requests;
    expect(a?.state).toBe("left-open");
    expect(b?.state).toBe("running");
  });

  test("done: a refresh queued after the Stop does not reopen it", () => {
    const refresh = (n: number, input: unknown): MurmurEvent => {
      const e = narrateCall(n, input);
      return { ...e, payload: { ...e.payload, recap: true, refresh: true } };
    };
    const [req] = reduce([
      prompt(0, "x"),
      mapCall(1, MAP),
      said(2, "Done."),
      at(3, "Stop"),
      refresh(9, note({ task: "1.1", taskStatus: "done" })),
    ]).requests;
    expect(req?.state).toBe("done");
  });

  test("failed: its last helper failed and nothing passed after", () => {
    const [req] = reduce([
      prompt(0, "x"),
      call(1, "Build it"),
      at(2, "PostToolUseFailure", { tool_name: "Agent", tool_use_id: "t1" }),
      at(3, "Stop"),
    ]).requests;
    expect(req?.state).toBe("failed");
    const [late] = reduce([prompt(0, "x"), at(1, "StopFailure")]).requests;
    expect(late?.state).toBe("failed");
  });

  test("a finished request runs while its helper does, until it goes quiet", () => {
    const events = [
      prompt(0, "a"),
      call(1, "Build it"),
      start(2, "h1"),
      prompt(3, "b"),
      by(tool(4, "Bash", { command: "ls" }), "h1"),
    ];
    expect(reduce(events).requests[0]?.state).toBe("running");
    const quiet = reduce([...events, tool(700, "Read", { file_path: "/p/a" })]);
    expect(quiet.requests[0]?.state).toBe("done");
  });
});

describe("outcome", () => {
  test("the first sentence of the last message that reads as done", () => {
    const [req] = reduce([
      prompt(0, "x"),
      said(1, "Task 1 is done and pushed. The tests pass."),
      said(2, "Next I will tidy the docs."),
      at(3, "Stop"),
    ]).requests;
    expect(req?.outcome).toBe("Task 1 is done and pushed.");
  });

  test("else the last message's first sentence, cut at a word", () => {
    const outcome = (text: string) =>
      reduce([prompt(0, "x"), said(1, text)]).requests[0]?.outcome;
    expect(outcome("Half agree, **bro**. The landing page is fine.")).toBe(
      "Half agree, bro.",
    );
    const long = outcome(`${"word ".repeat(60)}end.`) ?? "";
    expect(long.length).toBeLessThanOrEqual(240);
    expect(long).toMatch(/word…$/);
    expect(reduce([prompt(0, "x")]).requests[0]?.outcome).toBeUndefined();
  });
});

describe("short title", () => {
  const shortOf = (goal: string, short?: string) =>
    reduce([
      prompt(0, "x"),
      mapCall(1, { ...MAP, goal, ...(short ? { short } : {}) }),
    ]).requests[0]?.short;

  test("the map's own short wins", () => {
    expect(shortOf("Price alerts for the app", "Price alerts")).toBe(
      "Price alerts",
    );
  });

  test("else cut from the goal", () => {
    expect(
      shortOf(
        "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
      ),
    ).toBe("Restyle the logged-in app");
    expect(
      shortOf("Start Phase 2 of the Lit plate redesign: the agent page"),
    ).toBe("Phase 2");
    expect(shortOf("Continue the agent pages work")).toBe(
      "Continue the agent pages work",
    );
    expect(shortOf("Fix the login - it fails on Safari")).toBe("Fix the login");
    expect(shortOf("Write the plan and then build it")).toBe("Write the plan");
    expect(shortOf("Price alerts")).toBe("Price alerts");
    expect(
      shortOf(
        "Review the internal (logged-in) pages of Tradara, which look mid",
      ),
    ).toBe("Review the internal pages");
  });

  test("a cut ends on a whole phrase, before its last small word, never under two words", () => {
    expect(
      shortOf(
        "Track every phase of the Lit plate redesign in more detail, and carry the work",
      ),
    ).toBe("Track every phase");
    expect(
      shortOf(
        "Review the inside of the Tradara app (logged in by the user) and say why",
      ),
    ).toBe("Review the inside");
    // Backing off to before "the" would leave one word, so the cut stays.
    expect(shortOf("Restart the two stopped Phase 3 jobs and publish")).toBe(
      "Restart the two stopped Phase 3",
    );
    // No cut, no back-off.
    expect(shortOf("Compare the app with the site")).toBe(
      "Compare the app with the site",
    );
  });

  test("a request with no map cuts its prompt", () => {
    const [req] = reduce([
      prompt(0, "fix the login button, it is broken"),
    ]).requests;
    expect(req?.short).toBe("Fix the login button");
  });
});

describe("helper roles and rounds", () => {
  const run = (n: number, description: string, id: string) => [
    call(n, description),
    start(n + 1, id),
  ];
  const view = reduce([
    prompt(0, "go"),
    ...run(2, "Implement Task 2", "a1"),
    ...run(4, "Review Task 2 (spec + quality)", "a2"),
    ...run(6, "Implement Task 1: tokens", "a3"),
    ...run(8, "Review Task 1", "a4"),
    ...run(10, "Re-review Task 1 fix round 1", "a5"),
    ...run(12, "Review B7 money speed fix", "a6"),
    ...run(14, "Fix B7: agent money speed", "a7"),
    ...run(16, "Re-review B7", "a8"),
    ...run(18, "Implement Tasks 13-14: book plate", "a9"),
    ...run(20, "Build Task 18a: server fields", "a10"),
    ...run(22, "Phase 1 review: My Agents", "a11"),
    ...run(24, "Phase 1 review fix round", "a12"),
    ...run(26, "Draft Phase 2 plan: agent page", "a13"),
    ...run(28, "Re-review Task 29 rounds 2-3", "a14"),
    ...run(30, "Lit plate: chat screens", "a15"),
    prompt(40, "more"),
    ...run(42, "Re-review Task 2", "b1"),
  ]);
  const [first, second] = view.requests;

  test("role, subject and round from each description", () => {
    expect(
      first?.agents.map((a) => [a.description, a.role, a.subject, a.round]),
    ).toEqual([
      ["Implement Task 2", "build", "Task 2", 1],
      ["Review Task 2 (spec + quality)", "review", "Task 2", 1],
      ["Implement Task 1: tokens", "build", "Task 1", 1],
      ["Review Task 1", "review", "Task 1", 1],
      ["Re-review Task 1 fix round 1", "recheck", "Task 1", 2],
      ["Review B7 money speed fix", "review", "B7", 1],
      ["Fix B7: agent money speed", "fix", "B7", 2],
      ["Re-review B7", "recheck", "B7", 2],
      ["Implement Tasks 13-14: book plate", "build", "Tasks 13-14", 1],
      ["Build Task 18a: server fields", "build", "Task 18a", 1],
      ["Phase 1 review: My Agents", "review", "Phase 1", 1],
      ["Phase 1 review fix round", "fix", "Phase 1", 2],
      ["Draft Phase 2 plan: agent page", "plan", "Phase 2", 1],
      ["Re-review Task 29 rounds 2-3", "recheck", "Task 29", 4],
      ["Lit plate: chat screens", "other", undefined, undefined],
    ]);
  });

  test("rounds carry across requests", () => {
    expect(second?.agents[0]).toMatchObject({ subject: "Task 2", round: 2 });
    expect(second?.sentBack).toEqual(["Task 2"]);
  });

  test("a new build of a task number an older plan used starts over at round 1", () => {
    const [a, b] = reduce([
      prompt(0, "first plan"),
      ...run(2, "Implement Task 1: tokens", "a1"),
      ...run(4, "Review Task 1", "a2"),
      ...run(6, "Fix Task 1 review findings", "a3"),
      ...run(8, "Re-review Task 1", "a4"),
      prompt(20, "second plan"),
      ...run(22, "Implement Task 1: alerts table", "b1"),
      ...run(24, "Review Task 1", "b2"),
    ]).requests;
    expect(a?.sentBack).toEqual(["Task 1"]);
    expect(b?.agents.map((x) => x.round)).toEqual([1, 1]);
    expect(b?.sentBack).toEqual([]);
  });

  test("counts by role, and the subjects sent back", () => {
    expect(first?.helperCounts).toEqual({
      build: 4,
      review: 4,
      recheck: 3,
      fix: 2,
      other: 2,
    });
    expect(first?.sentBack).toEqual(["Task 1", "B7", "Phase 1", "Task 29"]);
  });

  test("tasks and parts count the fix rounds of their subject", () => {
    const [req] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      ...run(2, "Implement Task 1: tokens", "a1"),
      ...run(4, "Review Task 1", "a2"),
      ...run(6, "Re-review Task 1 fix round 1", "a3"),
      ...run(8, "Implement Task 2: hero", "a4"),
    ]).requests;
    const tasks = req?.phases.flatMap((ph) => ph.tasks);
    expect(tasks?.map((t) => t.rounds)).toEqual([1, 0, undefined]);
    expect(req?.parts.map((p) => p.rounds)).toEqual([1, 0, undefined]);
  });

  test("a builder sent fix rounds in a later request counts them there", () => {
    // Task 1's builder and reviewer start in the first request; after a pause the review
    // restarts, the builder is resumed twice with fixes and a recheck sits between them.
    const send = (n: number, to: string, message: string) =>
      tool(n, "SendMessage", { to, message }, "PreToolUse");
    const [a, b] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      ...run(2, "Build Task 1: tokens", "a1"),
      ...run(4, "Review Task 1 tokens", "a2"),
      prompt(20, "restart the stopped jobs"),
      mapCall(21, LIT),
      send(22, "a2", "Your session ended. Pick up where you stopped."),
      ...run(24, "Review Task 1 tokens", "b1"),
      send(26, "a1", "Task 1 fix round 1: read the review and fix it."),
      ...run(28, "Re-review Task 1 fix round", "b2"),
      send(30, "a1", "Task 1 fix round 2 (small): three items left."),
      // Neither a follow-up after it passed nor a word mid-round is another round.
      send(32, "a1", "One more change in this round, before the re-review."),
      send(34, "a1", "Task 1 follow-up (small): the captures now exist."),
    ]).requests;
    expect(a?.phases[0]?.tasks[0]?.rounds).toBe(0);
    expect(b?.phases[0]?.tasks[0]?.rounds).toBe(2);
    expect(b?.parts[0]?.rounds).toBe(2);
    expect(b?.sentBack).toEqual(["Task 1"]);
    // Resumes are not new helpers.
    expect(b?.helperCounts).toMatchObject({ build: 0, review: 1, recheck: 1 });
  });

  test("a builder told the review found issues is in a fix round", () => {
    const send = (n: number, to: string, message: string) =>
      tool(n, "SendMessage", { to, message }, "PreToolUse");
    const events = [
      prompt(0, "go"),
      mapCall(1, LIT),
      ...run(2, "Implement Task 1: tokens", "a1"),
      ...run(4, "Review Task 1 (spec + quality)", "a2"),
      // Only the opening is read: Task 2 further on is not what it is about.
      send(
        6,
        "a1",
        "Task review found issues. Fix these. Then rerun Task 2's tests.",
      ),
      ...run(8, "Re-review Task 1 fix round 1", "a3"),
      send(
        10,
        "a1",
        "The re-review found two new issues in round 1's fix. Fix them.",
      ),
      // Another task's work sent to the same helper is not Task 1's.
      send(12, "a1", "Follow-up for Task 2: Fix these captures too."),
    ];
    const rounds = (n: number) =>
      reduce(events.slice(0, n)).requests[0]?.phases[0]?.tasks.map(
        (t) => t.rounds,
      );
    expect(rounds(7)).toEqual([1, undefined]);
    expect(rounds(events.length)).toEqual([2, undefined]);
  });

  test("a fix sent for a pair of tasks counts for the pair", () => {
    const [req] = reduce([
      prompt(0, "go"),
      ...run(2, "Implement Tasks 13-14: book plate", "a1"),
      ...run(4, "Review Tasks 13-14 agent cards", "a2"),
      tool(
        6,
        "SendMessage",
        {
          to: "a1",
          message: "Tasks 13+14 fix round 1: the review asked for fixes.",
        },
        "PreToolUse",
      ),
    ]).requests;
    expect(req?.sentBack).toEqual(["Tasks 13-14"]);
  });
});

describe("full cards for every part", () => {
  const events = [
    prompt(0, "go"),
    mapCall(1, LIT),
    ...helper(
      10,
      "Implement Task 1: tokens",
      "a1",
      "Status: DONE\nBuilt the tokens.",
      "## Context\nAdd the design tokens every later part reads. Then wire them in.",
    ),
    ...helper(20, "Review Task 1", "a2", "Found two problems."),
    ...helper(30, "Re-review Task 1 fix round 1", "a3", "All fixed."),
    said(40, "Task 1 is done after one fix round."),
    ...helper(50, "Implement Task 2: hero", "a4", "Status: DONE_WITH_CONCERNS"),
    narrateCall(
      60,
      note({
        part: "docs",
        aim: { aim: "Explain the tokens", doneWhen: "README says how" },
        step: { text: "Wrote the README", status: "done" },
      }),
    ),
  ];
  const [req] = reduce(events).requests;
  const part = (id: string) => req?.parts.find((p) => p.id === id);

  test("aim from the builder's brief, done-when from the last done message", () => {
    expect(part("tokens")).toMatchObject({
      inferred: true,
      aim: {
        inferred: true,
        aim: "Add the design tokens every later part reads.",
        doneWhen: "Task 1 is done after one fix round.",
      },
      rounds: 1,
    });
  });

  test("steps from helpers by role and verdict, plus messages naming it", () => {
    expect(part("tokens")?.steps).toEqual([
      {
        ts: ts(11),
        text: "Built",
        status: "done",
        agentId: "a1",
        eventIds: ["e11"],
      },
      {
        ts: ts(21),
        text: "Sent back",
        status: "done",
        agentId: "a2",
        eventIds: ["e21"],
      },
      {
        ts: ts(31),
        text: "Passed",
        status: "done",
        agentId: "a3",
        eventIds: ["e31"],
      },
      {
        ts: ts(40),
        text: "Task 1 is done after one fix round.",
        status: "done",
        eventIds: ["e40"],
      },
    ]);
  });

  test("a review that failed reads as reviewed, not passed", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      ...helper(10, "Implement Task 2: hero", "a1"),
      call(20, "Review Task 2", "Review the hero."),
      start(21, "a2"),
      stop(22, "a2"),
      prompt(
        23,
        '<task-notification>\n<task-id>a2</task-id>\n<tool-use-id>t20</tool-use-id>\n<output-file>/tmp/x.output</output-file>\n<status>failed</status>\n<summary>Agent "Review Task 2" failed</summary>\n<result>Ran out of turns.</result>\n</task-notification>',
      ),
    ]).requests;
    const hero = r?.parts.find((p) => p.id === "hero");
    expect(r?.agents[1]?.report?.status).toBe("failed");
    expect(hero?.steps.map((s) => [s.text, s.status])).toEqual([
      ["Built", "done"],
      ["Reviewed", "failed"],
    ]);
    expect(hero?.aim?.doneWhen).toBe("Failed");
  });

  test("span from the first to the last event", () => {
    expect(part("tokens")?.span).toEqual({ start: ts(11), end: ts(40) });
  });

  test("done-when from the last report when no message says done", () => {
    expect(part("hero")?.aim?.doneWhen).toBe("Reported done, with concerns");
    expect(part("hero")?.steps.map((s) => s.text)).toEqual(["Built"]);
  });

  test("a narrated part keeps every narrated field", () => {
    expect(part("docs")).toMatchObject({
      aim: { aim: "Explain the tokens", doneWhen: "README says how" },
      steps: [{ ts: ts(60), text: "Wrote the README", status: "done" }],
    });
    expect(part("docs")?.inferred).toBeUndefined();
    expect(part("docs")?.aim?.inferred).toBeUndefined();
    expect(part("docs")?.steps).toHaveLength(1);
  });

  test("a brief that casts the helper gives the work after its colon", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      ...helper(
        2,
        "Review Task 2: hero",
        "a1",
        "Approved.",
        "You are a fresh reviewer for Task 2 of the redesign (Phase 0): the hero money line. Review it.",
      ),
      ...helper(
        10,
        "Re-review Task 1 fix round 1",
        "a2",
        "Approved.",
        "You are a scoped re-reviewer for Task 1 fix round 1.",
      ),
    ]).requests;
    expect(r?.parts.find((p) => p.id === "hero")?.aim).toEqual({
      inferred: true,
      aim: "The hero money line.",
      doneWhen: "Passed review",
    });
    // Casting with no colon says nothing of the work, so no aim.
    expect(r?.parts.find((p) => p.id === "tokens")?.aim).toBeUndefined();
  });

  test("a done message that leads with the part's subject counts, though it names another task", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      ...helper(
        2,
        "Implement Task 2: hero",
        "a1",
        "Status: DONE",
        "## Context\nDraw the hero.",
      ),
      said(10, "Task 2 is done. Task 1 waits on its numbers."),
    ]).requests;
    expect(r?.messages?.[0]?.task).toBeUndefined();
    expect(r?.parts.find((p) => p.id === "hero")?.aim).toEqual({
      inferred: true,
      aim: "Draw the hero.",
      doneWhen: "Task 2 is done.",
    });
  });

  test("a planner's brief gives the aim like a builder's", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      ...helper(
        2,
        "Draft Task 1 plan",
        "a1",
        "Done.",
        "You are planning Task 1 of the redesign: the colour tokens in both themes.",
      ),
    ]).requests;
    expect(r?.parts.find((p) => p.id === "tokens")?.aim?.aim).toBe(
      "The colour tokens in both themes.",
    );
  });

  test("a part Claude was on while helpers of many subjects ran lists them all, with no aim", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      narrateCall(2, note({ part: "docs", now: "Dispatching builders" })),
      ...helper(
        3,
        "Build Task 17: capture",
        "a1",
        "Status: DONE",
        "## Context\nCapture the reads.",
      ),
      ...helper(
        10,
        "Build Task 19: parts",
        "a2",
        "Status: DONE",
        "## Context\nBuild the parts.",
      ),
    ]).requests;
    const docs = r?.parts.find((p) => p.id === "docs");
    expect(docs?.steps.map((s) => s.text)).toEqual([
      "Dispatching builders",
      "Built",
      "Built",
    ]);
    expect(docs?.aim).toBeUndefined();
    expect(docs?.rounds).toBeUndefined();
  });

  test("live narrates naming a bare part become its steps", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      narrateCall(2, note({ part: "docs", now: "Writing the README" })),
      narrateCall(
        3,
        note({
          part: "docs",
          task: "t3",
          now: "README done",
          taskStatus: "done",
        }),
      ),
    ]).requests;
    const docs = r?.parts.find((p) => p.id === "docs");
    expect(docs?.inferred).toBe(true);
    expect(docs?.aim).toBeUndefined();
    expect(docs?.steps.map((s) => [s.text, s.status])).toEqual([
      ["Writing the README", "done"],
      ["README done", "done"],
    ]);
  });

  test("files with no narrated role are grouped by path", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, LIT),
      narrateCall(
        2,
        note({
          part: "tokens",
          files: [{ path: "src/a.ts", role: "the tokens" }],
        }),
      ),
      edit(3, "src/a.ts", ["+a"]),
      edit(4, "src/__tests__/a.test.ts", ["+a"]),
      edit(5, "src/styles/x.css", ["+a"]),
      edit(6, "README.md", ["+a"]),
      edit(7, "package.json", ["+a"]),
      edit(8, "src/b.ts", ["+a"]),
    ]).requests;
    const files = r?.parts.find((p) => p.id === "tokens")?.files;
    expect(files?.map((f) => [f.path, f.role, f.roleInferred])).toEqual([
      ["src/a.ts", "the tokens", undefined],
      ["src/__tests__/a.test.ts", "tests", true],
      ["src/styles/x.css", "styles", true],
      ["README.md", "docs", true],
      ["package.json", "config", true],
      ["src/b.ts", "source", true],
    ]);
  });

  test("an inferred request's parts keep their steps and gain an aim", () => {
    const [r] = reduce([
      prompt(0, "go"),
      ...helper(
        1,
        "Implement Task 1: tokens",
        "a1",
        "Status: DONE",
        "## Context\nAdd the tokens.",
      ),
    ]).requests;
    expect(r?.parts[0]).toMatchObject({
      inferred: true,
      aim: { aim: "Add the tokens.", doneWhen: "Reported done" },
      steps: [{ text: "Built" }],
    });
  });
});

describe("key moments", () => {
  const [req] = reduce([
    prompt(0, "go"),
    said(1, "Review found two problems in Task 1."),
    said(2, "Sending it back to the builder."),
    said(3, "Task 1 is done."),
    said(4, "Nothing to say here."),
    said(5, "I'll keep the dark look instead of the light one."),
    said(6, "I added a task for the docs."),
    said(7, "Task 2 is done. It took a while."),
  ]).requests;

  test("up to five, newest last, marked new after the last look", () => {
    if (!req) throw new Error("no request");
    expect(keyMoments(req, ts(4))).toEqual([
      {
        ts: ts(2),
        mark: "fixing",
        text: "Sending it back to the builder.",
        new: false,
      },
      { ts: ts(3), mark: "done", text: "Task 1 is done.", new: false },
      {
        ts: ts(5),
        mark: "decision",
        text: "I'll keep the dark look instead of the light one.",
        new: true,
      },
      {
        ts: ts(6),
        mark: "plan",
        text: "I added a task for the docs.",
        new: true,
      },
      { ts: ts(7), mark: "done", text: "Task 2 is done.", new: true },
    ]);
    expect(keyMoments(req).every((m) => !m.new)).toBe(true);
  });

  test("a blocked report is a problem, and work beyond the plan a plan moment", () => {
    const [r] = reduce([
      prompt(0, "add alerts"),
      mapCall(1, MAP),
      done(2, "1.1"),
      done(3, "2.1"),
      done(4, "2.2"),
      ...helper(5, "Fix Task 9 typo", "h1", "Status: BLOCKED\nNo access."),
    ]).requests;
    if (!r) throw new Error("no request");
    expect(keyMoments(r).map((m) => [m.mark, m.text])).toEqual([
      ["plan", "The plan is done; work goes on beyond it"],
      ["problem", "Fix Task 9 typo: blocked"],
    ]);
  });
});
