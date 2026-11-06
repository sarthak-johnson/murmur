import { expect, test } from "vitest";
import { MAP_TOOL, type MapInput, reduce } from "../src/index.js";
import { at, fixture, mapCall, narrateCall, prompt, tool } from "./helpers.js";

const MAP: MapInput = {
  kind: "feature",
  goal: "Price alerts",
  phases: [
    {
      id: "1",
      title: "Data",
      tasks: [{ id: "1.1", title: "Alerts table", part: "db" }],
    },
    {
      id: "2",
      title: "API",
      tasks: [
        { id: "2.1", title: "Endpoint to save an alert", part: "api" },
        { id: "2.2", title: "Endpoint to list alerts", part: "api" },
      ],
    },
  ],
  parts: [
    { id: "db", title: "Alerts table", phase: "1", tag: "source" },
    {
      id: "api",
      title: "Alerts API",
      phase: "2",
      links: [{ to: "db", label: "writes" }],
    },
  ],
};

const note = (extra: Record<string, unknown> = {}) => ({
  now: "Writing the save endpoint",
  why: "the screen needs it",
  ...extra,
});

test("splits requests on each prompt", () => {
  const long = "a".repeat(100);
  const view = reduce([
    at(0, "SessionStart", { source: "startup" }),
    prompt(1, long),
    tool(2, "Bash", { command: "ls" }),
    prompt(3, "second"),
    tool(4, "Read", { file_path: "/p/x" }),
  ]);
  expect(view.requests.map((r) => [r.id, r.prompt])).toEqual([
    ["e1", long],
    ["e3", "second"],
  ]);
  expect(view).toMatchObject({
    sessionId: "s1",
    cwd: "/p",
    title: "a".repeat(80),
    startedAt: "2026-11-06T00:00:00.000Z",
    lastEventAt: "2026-11-06T00:00:04.000Z",
    ended: false,
    needsYou: null,
  });
  expect(view.requests[0]).toMatchObject({
    startedAt: "2026-11-06T00:00:01.000Z",
    kind: "feature",
    kindInferred: true,
    planInferred: true,
    goal: "a".repeat(80),
    phases: [],
    parts: [],
    looseFiles: [],
    now: null,
    agents: [],
    assumptions: [],
    flags: [],
  });
  expect(reduce([prompt(1, "x"), at(2, "SessionEnd")]).ended).toBe(true);
});

test("map builds phases and parts", () => {
  const [req] = reduce([prompt(1, "add alerts"), mapCall(2, MAP)]).requests;
  expect(req).toMatchObject({
    kind: "feature",
    kindInferred: false,
    goal: "Price alerts",
    planInferred: false,
  });
  expect(req?.phases).toEqual([
    {
      id: "1",
      title: "Data",
      status: "todo",
      tasks: [
        {
          id: "1.1",
          title: "Alerts table",
          part: "db",
          status: "todo",
          agents: [],
        },
      ],
    },
    {
      id: "2",
      title: "API",
      status: "todo",
      tasks: [
        {
          id: "2.1",
          title: "Endpoint to save an alert",
          part: "api",
          status: "todo",
          agents: [],
        },
        {
          id: "2.2",
          title: "Endpoint to list alerts",
          part: "api",
          status: "todo",
          agents: [],
        },
      ],
    },
  ]);
  expect(req?.parts[0]).toEqual({
    id: "db",
    title: "Alerts table",
    phase: "1",
    tag: "source",
    status: "todo",
    links: [],
    steps: [],
    files: [],
    choices: [],
    checks: [],
    words: [],
    agents: [],
    failures: 0,
  });
  expect(req?.parts[1]?.links).toEqual([{ to: "db", label: "writes" }]);
});

test("a failed map call is ignored", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    tool(2, MAP_TOOL, MAP, "PostToolUseFailure"),
  ]).requests;
  expect(req?.planInferred).toBe(true);
});

test("narrate marks task 2.2 now and phase 2 now, 2.1 done", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "db", task: "1.1", taskStatus: "done" })),
    narrateCall(4, note({ part: "api", task: "2.1", taskStatus: "running" })),
    narrateCall(5, note({ part: "api", task: "2.1", taskStatus: "done" })),
    narrateCall(
      6,
      note({
        now: "Listing alerts",
        part: "api",
        task: "2.2",
        taskStatus: "running",
      }),
    ),
  ]).requests;
  const status = (i: number) => req?.phases[i]?.tasks.map((t) => t.status);
  expect(status(0)).toEqual(["done"]);
  expect(status(1)).toEqual(["done", "now"]);
  expect(req?.phases.map((p) => p.status)).toEqual(["done", "now"]);
  expect(req?.parts.map((p) => p.status)).toEqual(["done", "now"]);
  expect(req?.now).toEqual({
    text: "Listing alerts",
    why: "the screen needs it",
    part: "api",
    ts: "2026-11-06T00:00:06.000Z",
  });
});

test("only the latest narrate makes a part or task now by naming it", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "db", task: "1.1" })),
    narrateCall(4, note({ part: "api", task: "2.1" })),
  ]).requests;
  expect(req?.phases.map((p) => p.status)).toEqual(["todo", "now"]);
  expect(req?.parts.map((p) => p.status)).toEqual(["todo", "now"]);
});

test("a done step finishes a part unless a later step runs", () => {
  const step = (status: string) => ({ text: status, status });
  const parts = (...steps: string[]) =>
    reduce([
      prompt(1, "add alerts"),
      mapCall(2, MAP),
      ...steps.map((s, i) =>
        narrateCall(3 + i, note({ part: "db", step: step(s) })),
      ),
      narrateCall(9, note({ part: "api" })),
    ]).requests[0]?.parts[0]?.status;
  expect(parts("running", "done")).toBe("done");
  expect(parts("done", "running")).toBe("todo");
});

test("a failed task makes its phase now", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ task: "1.1", taskStatus: "failed" })),
    narrateCall(4, note({ task: "2.1", taskStatus: "done" })),
  ]).requests;
  expect(req?.phases[0]?.tasks[0]?.status).toBe("failed");
  expect(req?.phases.map((p) => p.status)).toEqual(["now", "todo"]);
});

test("narrate merges part detail", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(
      3,
      note({
        part: "api",
        aim: { aim: "save alerts", doneWhen: "POST returns 201" },
        io: { gets: "price", gives: "id" },
        files: [{ path: "src/api.ts", role: "the endpoint" }],
        choices: [{ choice: "REST", reason: "simple", assumption: true }],
        checks: [{ check: "saves", status: "untried" }],
        words: [{ term: "alert", meaning: "a price watch" }],
      }),
    ),
    narrateCall(
      4,
      note({
        part: "api",
        files: [{ path: "src/api.ts", role: "the save endpoint" }],
        choices: [
          { choice: "REST", reason: "the app uses REST", assumption: false },
        ],
        checks: [
          { check: "saves", status: "pass" },
          { check: "lists", status: "fail" },
        ],
      }),
    ),
  ]).requests;
  expect(req?.parts[1]).toMatchObject({
    aim: { aim: "save alerts", doneWhen: "POST returns 201" },
    io: { gets: "price", gives: "id" },
    files: [
      {
        path: "src/api.ts",
        role: "the save endpoint",
        added: 0,
        removed: 0,
        isNew: false,
        eventIds: [],
      },
    ],
    choices: [
      { choice: "REST", reason: "the app uses REST", assumption: false },
    ],
    checks: [
      { check: "saves", status: "pass" },
      { check: "lists", status: "fail" },
    ],
    words: [{ term: "alert", meaning: "a price watch" }],
  });
});

test("second map keeps steps already on a part", () => {
  const second: MapInput = {
    ...MAP,
    goal: "Price alerts v2",
    phases: [
      {
        id: "2",
        title: "API",
        tasks: [{ id: "2.1", title: "Save", part: "api" }],
      },
    ],
    parts: [
      { id: "ui", title: "Alerts screen" },
      { id: "api", title: "Alerts endpoint" },
    ],
  };
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(
      3,
      note({
        part: "api",
        task: "2.1",
        taskStatus: "done",
        step: { text: "Wrote save", status: "done" },
      }),
    ),
    mapCall(4, second),
  ]).requests;
  expect(req?.goal).toBe("Price alerts v2");
  expect(req?.parts.map((p) => [p.id, p.title])).toEqual([
    ["ui", "Alerts screen"],
    ["api", "Alerts endpoint"],
  ]);
  const api = req?.parts[1];
  expect(api?.phase).toBeUndefined();
  expect(api?.links).toEqual([]);
  expect(api?.steps).toEqual([
    {
      ts: "2026-11-06T00:00:03.000Z",
      text: "Wrote save",
      status: "done",
      eventIds: ["e3"],
    },
  ]);
  expect(req?.phases).toEqual([
    {
      id: "2",
      title: "API",
      status: "done",
      tasks: [
        { id: "2.1", title: "Save", part: "api", status: "done", agents: [] },
      ],
    },
  ]);
});

test("unknown part id in narrate keeps now but adds no step to any part", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(
      3,
      note({
        part: "nope",
        task: "9.9",
        taskStatus: "done",
        step: { text: "x", status: "done" },
      }),
    ),
  ]).requests;
  expect(req?.now).toEqual({
    text: "Writing the save endpoint",
    why: "the screen needs it",
    ts: "2026-11-06T00:00:03.000Z",
  });
  expect(req?.parts.flatMap((p) => p.steps)).toEqual([]);
  expect(req?.parts.map((p) => p.status)).toEqual(["todo", "todo"]);
});

test("malformed narrate input is skipped", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "api", step: { text: "ok", status: "done" } })),
    narrateCall(4, {
      now: "no why",
      part: "api",
      step: { text: "bad", status: "done" },
    }),
    narrateCall(5, note({ now: "x".repeat(201), part: "db" })),
    narrateCall(6, "not an object"),
  ]).requests;
  expect(req?.now?.ts).toBe("2026-11-06T00:00:03.000Z");
  expect(req?.parts[1]?.steps.map((s) => s.text)).toEqual(["ok"]);
  expect(req?.parts[0]?.status).toBe("todo");
});

test("duplicate and out-of-order events reduce to the same view as clean input", () => {
  const clean = [
    at(0, "SessionStart"),
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(
      3,
      note({
        part: "api",
        task: "2.1",
        taskStatus: "running",
        step: { text: "a", status: "running" },
      }),
    ),
    narrateCall(
      4,
      note({
        part: "api",
        task: "2.1",
        taskStatus: "done",
        step: { text: "b", status: "done" },
      }),
    ),
    prompt(5, "now list them"),
    narrateCall(6, note({ now: "Listing" })),
    at(7, "SessionEnd"),
  ];
  const messy = [...clean]
    .reverse()
    .flatMap((e, i) => (i % 2 ? [e, { ...e }] : [e]));
  expect(reduce(messy)).toEqual(reduce(clean));
});

test.each(["feature.jsonl", "write-update.jsonl", "interactive.jsonl"])(
  "%s reduces to one request per prompt",
  (name) => {
    const events = fixture(name);
    const view = reduce(events);
    const prompts = events.filter((e) => e.hook === "UserPromptSubmit");
    expect(view.requests.map((r) => r.id)).toEqual(prompts.map((e) => e.id));
    expect(view.sessionId).toBe(events[0]?.sessionId);
  },
);
