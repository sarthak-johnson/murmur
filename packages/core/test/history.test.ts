import { describe, expect, test } from "vitest";
import { displayPath, type MurmurEvent, reduce } from "../src/index.js";
import { at, edit, MAP, mapCall, prompt, tool, write } from "./helpers.js";

const call = (n: number, description: string) =>
  tool(
    n,
    "Agent",
    {
      description,
      prompt: `Please ${description}`,
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
  payload: { ...e.payload, agent_id: id, agent_type: "general-purpose" },
});
/** A helper run: its Agent call at `n`, its start at `n + 1`. */
const run = (n: number, description: string, id: string) => [
  call(n, description),
  start(n + 1, id),
];

describe("parts from helpers", () => {
  const events = [
    prompt(0, "go"),
    ...run(10, "Implement Task 1: Lit plate tokens", "a1"),
    ...run(12, "Review Task 1 (spec + quality)", "a2"),
    ...run(14, "Re-review Task 1 fix round 1", "a3"),
    ...run(16, "Implement Tasks 13-14: book plate, agent cards", "a4"),
    ...run(18, "Review Tasks 13-14 agent cards", "a5"),
    ...run(20, "Fix bug B1: closed trades disagree", "a6"),
    ...run(22, "Review b1 fix", "a7"),
    ...run(24, "Fix B7: agent money speed", "a8"),
    ...run(26, "Build style A, lit plate", "a9"),
    ...run(28, "Build style B, departure board", "a10"),
    ...run(30, "Review Task 2 (spec + quality)", "a11"),
    ...run(32, "Implement Task 12: fast agent list", "a12"),
  ];
  const req = reduce(events).requests[0];

  test("one part per subject, titled without the work verb", () => {
    expect(req?.parts.map((p) => p.title)).toEqual([
      "Task 1: Lit plate tokens",
      "Tasks 13-14: book plate, agent cards",
      "Bug B1: closed trades disagree",
      "B7: agent money speed",
      "Style A, lit plate",
      "Style B, departure board",
      "Task 2 (spec + quality)",
      "Task 12: fast agent list",
    ]);
  });

  test("each run is a step labelled by its verb, and an agent of the part", () => {
    const steps = (i: number) => req?.parts[i]?.steps.map((s) => s.text);
    expect(steps(0)).toEqual(["Built", "Reviewed", "Re-reviewed"]);
    expect(steps(1)).toEqual(["Built", "Reviewed"]);
    expect(steps(2)).toEqual(["Fixed", "Reviewed"]);
    expect(steps(4)).toEqual(["Built"]);
    expect(req?.parts[0]?.agents).toEqual(["a1", "a2", "a3"]);
    expect(req?.parts[0]?.steps[1]).toEqual({
      ts: "2026-11-06T00:00:12.000Z",
      text: "Reviewed",
      status: "running",
      agentId: "a2",
      eventIds: ["e12"],
    });
  });

  test("runs with no subject stay apart, and a label outside the verb list is the description", () => {
    const [r] = reduce([
      prompt(0, "go"),
      ...run(1, "Phase 0 review against prototype", "a1"),
      ...run(3, "Phase 0 review against prototype", "a2"),
    ]).requests;
    expect(r?.parts.map((p) => [p.title, p.steps.map((s) => s.text)])).toEqual([
      [
        "Phase 0 review against prototype",
        ["Phase 0 review against prototype"],
      ],
      [
        "Phase 0 review against prototype",
        ["Phase 0 review against prototype"],
      ],
    ]);
    expect(new Set(r?.parts.map((p) => p.id)).size).toBe(2);
  });

  test("status: now while a run runs, done when all finished, failed only if the last run failed", () => {
    const [r] = reduce([
      prompt(0, "go"),
      ...run(1, "Implement Task 1: tokens", "a1"),
      stop(3, "a1"),
      ...run(4, "Review Task 1", "a2"),
      ...run(6, "Implement Task 2: money", "a3"),
      stop(8, "a3"),
      ...run(9, "Implement Task 3: rail", "a4"),
      at(11, "PostToolUseFailure", { tool_name: "Agent", tool_use_id: "t9" }),
    ]).requests;
    expect(r?.parts.map((p) => [p.title, p.status])).toEqual([
      ["Task 1: tokens", "now"],
      ["Task 2: money", "done"],
      ["Task 3: rail", "done"],
    ]);
    expect(r?.parts[0]?.steps.map((s) => s.status)).toEqual([
      "done",
      "running",
    ]);
    expect(r?.parts[2]?.steps.map((s) => s.status)).toEqual(["failed"]);
    expect(r?.phases[0]?.tasks.map((t) => t.status)).toEqual([
      "now",
      "done",
      "failed",
    ]);
  });

  test("a part's files are the Edit and Write touches inside its helpers", () => {
    const [r] = reduce([
      prompt(0, "go"),
      ...run(1, "Implement Task 1: tokens", "a1"),
      by(edit(3, "web/src/tokens.css", ["+a", "+b"]), "a1"),
      by(write(4, "web/src/new.ts", "x\ny\n"), "a1"),
      ...run(5, "Review Task 1", "a2"),
      by(edit(7, "web/src/tokens.css", ["-a", "+c"]), "a2"),
      by(edit(8, "stray.ts", ["+x"]), "zz"),
    ]).requests;
    expect(r?.parts[0]?.files).toEqual([
      {
        path: "web/src/tokens.css",
        added: 3,
        removed: 1,
        isNew: false,
        eventIds: ["e3", "e7"],
      },
      {
        path: "web/src/new.ts",
        added: 2,
        removed: 0,
        isNew: true,
        eventIds: ["e4"],
      },
    ]);
    expect(r?.looseFiles.map((f) => f.path)).toEqual(["stray.ts"]);
  });

  test("a helper's touches after the next prompt stay with the request that started it", () => {
    const view = reduce([
      prompt(0, "go"),
      ...run(1, "Implement Task 12: list", "a1"),
      prompt(3, "next"),
      by(edit(4, "web/src/list.ts", ["+a"]), "a1"),
      edit(5, "docs/a.md", ["+a"]),
      stop(6, "a1"),
    ]);
    expect(view.requests[0]?.parts[0]?.files.map((f) => f.path)).toEqual([
      "web/src/list.ts",
    ]);
    expect(view.requests[0]?.parts[0]?.status).toBe("done");
    const next = view.requests[1];
    expect(next?.parts.flatMap((p) => p.files).map((f) => f.path)).toEqual([
      "docs/a.md",
    ]);
    expect(next?.looseFiles).toEqual([]);
  });
});

describe("main-thread changes", () => {
  test("grouped by folder, one-file folders join their parent, root files stay loose", () => {
    const [r] = reduce([
      prompt(0, "go"),
      edit(1, "web/src/live/a.tsx", ["+a"]),
      edit(2, "web/src/live/b.tsx", ["+a"]),
      edit(3, "web/src/live/deep/c.tsx", ["+a"]),
      edit(4, "docs/x.md", ["+a"]),
      edit(5, "root.ts", ["+a"]),
      edit(6, "web/src/live/a.tsx", ["+b"]),
    ]).requests;
    expect(r?.parts.map((p) => [p.title, p.files.map((f) => f.path)])).toEqual([
      [
        "web/src/live",
        ["web/src/live/a.tsx", "web/src/live/b.tsx", "web/src/live/deep/c.tsx"],
      ],
      ["docs", ["docs/x.md"]],
    ]);
    expect(r?.parts[0]?.files[0]?.added).toBe(2);
    expect(r?.looseFiles.map((f) => f.path)).toEqual(["root.ts"]);
  });

  test("temp paths group by their readable folder", () => {
    const tmp =
      "/private/tmp/claude-501/-Users-me-app/27a000a1-7dbc-4dd1-ab83-961149fc03ae/scratchpad/style/a";
    const abs = (n: number, path: string) =>
      at(n, "PostToolUse", {
        tool_name: "Write",
        tool_use_id: `t${n}`,
        tool_input: { file_path: path },
        tool_response: { type: "create", filePath: path, content: "x\n" },
      });
    const [r] = reduce([
      prompt(0, "go"),
      abs(1, `${tmp}/style.css`),
      abs(2, `${tmp}/chrome.js`),
    ]).requests;
    expect(r?.parts.map((p) => p.title)).toEqual(["scratchpad/style/a"]);
    expect(r?.parts[0]?.files.map((f) => f.path)).toEqual([
      `${tmp}/style.css`,
      `${tmp}/chrome.js`,
    ]);
  });

  test("at most 6 folder parts, the biggest; the rest stay loose", () => {
    const events = [prompt(0, "go")];
    let n = 1;
    for (let d = 1; d <= 8; d++)
      for (let f = 0; f < (d === 2 ? 1 : d === 5 ? 1 : 2); f++)
        events.push(edit(n++, `dir${d}/f${f}.ts`, ["+a"]));
    const [r] = reduce(events).requests;
    expect(r?.parts.map((p) => p.title)).toEqual([
      "dir1",
      "dir3",
      "dir4",
      "dir6",
      "dir7",
      "dir8",
    ]);
    expect(r?.looseFiles.map((f) => f.path)).toEqual([
      "dir2/f0.ts",
      "dir5/f0.ts",
    ]);
  });
});

describe("plan and map", () => {
  test("parts that changed the same file are linked, and the plan is one phase of the parts in start order", () => {
    const [r] = reduce([
      prompt(0, "go"),
      edit(1, "web/src/a.ts", ["+a"]),
      edit(2, "web/src/b.ts", ["+a"]),
      ...run(3, "Implement Task 1: tokens", "a1"),
      by(edit(5, "web/src/a.ts", ["+a"]), "a1"),
      stop(6, "a1"),
      ...run(7, "Implement Task 2: money", "a2"),
      by(edit(9, "web/src/money.ts", ["+a"]), "a2"),
    ]).requests;
    expect(r?.parts.map((p) => [p.title, p.links])).toEqual([
      ["web/src", []],
      ["Task 1: tokens", [{ to: "dir:web/src", label: "same files" }]],
      ["Task 2: money", []],
    ]);
    expect(r?.planInferred).toBe(true);
    expect(r?.phases).toEqual([
      {
        id: "did",
        title: "What Claude did",
        status: "now",
        tasks: [
          {
            id: "dir:web/src",
            title: "web/src",
            part: "dir:web/src",
            status: "done",
            agents: [],
          },
          {
            id: "task:1",
            title: "Task 1: tokens",
            part: "task:1",
            status: "done",
            agents: [],
          },
          {
            id: "task:2",
            title: "Task 2: money",
            part: "task:2",
            status: "now",
            agents: [],
          },
        ],
      },
    ]);
  });

  test("TaskCreated inference still wins the plan, parts are still drawn", () => {
    const [r] = reduce([
      prompt(0, "go"),
      at(1, "TaskCreated", { task_id: "1", subject: "Alerts table" }),
      ...run(2, "Implement Task 1: tokens", "a1"),
    ]).requests;
    expect(r?.phases.map((p) => p.title)).toEqual(["Tasks"]);
    expect(r?.parts.map((p) => p.title)).toEqual(["Task 1: tokens"]);
  });

  test("a request with a map is left alone", () => {
    const [r] = reduce([
      prompt(0, "go"),
      mapCall(1, MAP),
      ...run(2, "Implement Task 1: tokens", "a1"),
      edit(4, "web/src/a.ts", ["+a"]),
    ]).requests;
    expect(r?.parts.map((p) => p.id)).toEqual(["db", "api"]);
    expect(r?.looseFiles.map((f) => f.path)).toEqual(["web/src/a.ts"]);
    expect(r?.phases.map((p) => p.id)).toEqual(["1", "2"]);
  });

  test("nothing done leaves no parts and no plan", () => {
    const [r] = reduce([prompt(0, "go"), tool(1, "Read", {})]).requests;
    expect(r?.parts).toEqual([]);
    expect(r?.phases).toEqual([]);
  });
});

describe("finished requests", () => {
  const events = [
    prompt(0, "go"),
    ...run(1, "Build style A, lit plate", "a1"),
    by(edit(3, "style/a/x.css", ["+a"]), "a1"),
    tool(4, "Bash", { command: "ls" }, "PreToolUse"),
    edit(5, "docs/a.md", ["+a"]),
    prompt(6, "next"),
    ...run(7, "Build style B, quiet", "a2"),
    tool(9, "Bash", { command: "ls" }, "PreToolUse"),
  ];

  test("a later request finishes one; a helper that never stopped and went quiet counts as done", () => {
    const view = reduce(events);
    const [first, last] = view.requests;
    expect(first?.finished).toBe(true);
    expect(first?.parts.map((p) => p.status)).toEqual(["done", "done"]);
    expect(first?.tally).toEqual({ helpers: 1, files: 2, commands: 1 });
    expect(last?.finished).toBe(false);
    expect(last?.parts.map((p) => p.status)).toEqual(["now"]);
    expect(last?.tally).toEqual({ helpers: 1, files: 0, commands: 1 });
  });

  test("the session ending finishes the last request", () => {
    const view = reduce([...events, at(10, "SessionEnd")]);
    expect(view.requests.map((r) => r.finished)).toEqual([true, true]);
    expect(view.requests[1]?.parts[0]?.status).toBe("done");
  });

  test("a helper still active after the next prompt keeps running", () => {
    const view = reduce([
      prompt(0, "go"),
      ...run(1, "Build style A, lit plate", "a1"),
      prompt(3, "next"),
      by(tool(4, "Read", { file_path: "/p/a" }), "a1"),
    ]);
    expect(view.requests[0]?.parts[0]?.status).toBe("now");
  });
});

describe("displayPath", () => {
  const cwd = "/Users/me/app";
  test.each([
    ["web/src/live/NowCard.tsx", "web/src/live/NowCard.tsx"],
    [`${cwd}/web/src/a.ts`, "web/src/a.ts"],
    [".claude/worktrees/lit-plate/docs/plans/plan.md", "docs/plans/plan.md"],
    [
      "/private/tmp/claude-501/-Users-me-app/27a000a1-7dbc-4dd1-ab83-961149fc03ae/scratchpad/style/a/style.css",
      "scratchpad/style/a/style.css",
    ],
    ["/private/tmp/claude-501/t12/measure.mjs", "t12/measure.mjs"],
    ["/tmp/claude-501/gen/lib-head.js", "gen/lib-head.js"],
    [
      "/Users/me/.claude/projects/-Users-me-app/memory/MEMORY.md",
      "memory/MEMORY.md",
    ],
    ["/Users/me/notes/todo.md", "~/notes/todo.md"],
    ["/Users/me/Projects/other/src/deep/file.ts", "~/…/src/deep/file.ts"],
    ["/etc/hosts", "/etc/hosts"],
    ["/opt/a/b/c/d.txt", "…/b/c/d.txt"],
  ])("%s shows as %s", (path, shown) => {
    expect(displayPath(path, cwd)).toBe(shown);
  });
});
