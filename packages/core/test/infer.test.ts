import { describe, expect, test } from "vitest";
import { reduce } from "../src/index.js";
import {
  at,
  edit,
  fixture,
  MAP,
  mapCall,
  narrateCall,
  note,
  prompt,
  tool,
} from "./helpers.js";

const req = (...e: ReturnType<typeof at>[]) => reduce(e).requests[0];

test("no map and no tasks still gives a feature request with an empty inferred plan", () => {
  expect(req(prompt(0, "Add price alerts"))).toMatchObject({
    kind: "feature",
    kindInferred: true,
    planInferred: true,
    goal: "Add price alerts",
    phases: [],
  });
});

test("native tasks become one inferred phase", () => {
  const r = req(
    prompt(0, "Add price alerts"),
    at(1, "TaskCreated", { task_id: "1", subject: "Alerts table" }),
    at(2, "TaskCreated", { task: { id: "2", subject: "Endpoint" } }),
    at(3, "TaskCompleted", { task_id: "1" }),
  );
  expect(r?.planInferred).toBe(true);
  expect(r?.phases).toHaveLength(1);
  expect(r?.phases[0]).toMatchObject({ title: "Tasks", status: "now" });
  expect(r?.phases[0]?.tasks.map((t) => [t.id, t.title, t.status])).toEqual([
    ["1", "Alerts table", "done"],
    ["2", "Endpoint", "todo"],
  ]);
});

test("documented task_subject becomes the title", () => {
  const r = req(
    prompt(0, "Add price alerts"),
    at(1, "TaskCreated", { task_id: "1", task_subject: "Alerts table" }),
  );
  expect(r?.phases[0]?.tasks[0]?.title).toBe("Alerts table");
});

test.each([
  ["refactor the error handler", "bug"],
  ["why does login fail?", "bug"],
  ["rename the helper", "refactor"],
  ["how does the router work", "question"],
  ["ship it?", "question"],
  ["add a button", "feature"],
])("%s infers %s", (text, kind) => {
  expect(req(prompt(0, text))?.kind).toBe(kind);
});

test("a map call keeps its kind and plan", () => {
  const r = req(
    prompt(0, "fix it"),
    mapCall(1, MAP),
    at(2, "TaskCreated", { task_id: "9", subject: "x" }),
  );
  expect(r).toMatchObject({
    kind: "feature",
    kindInferred: false,
    planInferred: false,
  });
  expect(r?.phases.map((p) => p.title)).toEqual(["Data", "API"]);
});

test("interactive fixture still reduces", () => {
  expect(reduce(fixture("interactive.jsonl")).requests.length).toBeGreaterThan(
    0,
  );
});

describe("now without narrate", () => {
  const nowOf = (...e: ReturnType<typeof at>[]) =>
    req(prompt(0, "Add price alerts"), ...e)?.now;
  const inferred = (text: string, ts: number) => ({
    text,
    why: "",
    ts: new Date(
      Date.parse("2026-11-06T00:00:00.000Z") + ts * 1000,
    ).toISOString(),
    inferred: true,
  });

  test("each tool reads in plain words", () => {
    expect(nowOf(edit(1, "src/math.js", ["+a"]))).toEqual(
      inferred("Editing math.js", 1),
    );
    expect(
      nowOf(tool(1, "Write", { file_path: "/p/a/b.ts" }, "PreToolUse")),
    ).toEqual(inferred("Editing b.ts", 1));
    expect(nowOf(tool(1, "Read", { file_path: "/p/README.md" }))).toEqual(
      inferred("Reading README.md", 1),
    );
    expect(
      nowOf(tool(1, "Bash", { command: `npm  test\n${"x".repeat(80)}` })),
    ).toEqual(inferred(`Running npm test ${"x".repeat(51)}`, 1));
    expect(
      nowOf(tool(1, "Agent", { description: "Read greet file" }, "PreToolUse")),
    ).toEqual(inferred("Started a helper: Read greet file", 1));
    expect(nowOf(tool(1, "Grep", { pattern: "x" }))).toEqual(
      inferred("Using Grep", 1),
    );
    expect(nowOf(tool(1, "Bash", {}, "PostToolUseFailure"))).toEqual(
      inferred("Using Bash", 1),
    );
  });

  test("a Stop with no later tool call finishes the request", () => {
    expect(nowOf(edit(1, "a.js", ["+a"]), at(2, "Stop"))).toEqual(
      inferred("Finished this request", 2),
    );
    expect(
      nowOf(at(1, "Stop"), tool(2, "Read", { file_path: "/p/a.js" })),
    ).toEqual(inferred("Reading a.js", 2));
  });

  test("the latest narrate wins over earlier tools and a later Stop", () => {
    const narrated = {
      text: "Writing the save endpoint",
      why: "the screen needs it",
    };
    expect(
      nowOf(edit(1, "a.js", ["+a"]), narrateCall(2, note()), at(3, "Stop")),
    ).toMatchObject(narrated);
    expect(
      nowOf(edit(1, "a.js", ["+a"]), narrateCall(2, note()), at(3, "Stop"))
        ?.inferred,
    ).toBeUndefined();
    expect(nowOf(narrateCall(1, note()), edit(2, "a.js", ["+a"]))).toEqual(
      inferred("Editing a.js", 2),
    );
  });

  test("map and narrate are not tool events, and nothing at all leaves now null", () => {
    expect(nowOf(mapCall(1, MAP))).toBeNull();
    expect(nowOf()).toBeNull();
  });

  test("housekeeping tools keep the previous now", () => {
    for (const name of ["ToolSearch", "TaskList", "TaskGet"]) {
      expect(
        nowOf(tool(1, "Read", { file_path: "/p/a.js" }), tool(2, name, {})),
      ).toEqual(inferred("Reading a.js", 1));
      expect(nowOf(narrateCall(1, note()), tool(2, name, {}))?.inferred).toBe(
        undefined,
      );
    }
  });
});

describe("a refresh's narrate (recap: true, refresh: true)", () => {
  const refresh = (n: number, input: unknown) => {
    const e = narrateCall(n, input);
    return { ...e, payload: { ...e.payload, recap: true, refresh: true } };
  };
  const events = [
    prompt(0, "Add price alerts"),
    mapCall(1, MAP),
    narrateCall(2, note({ part: "api", task: "2.1", taskStatus: "running" })),
    refresh(3, {
      now: "Table made",
      why: "",
      task: "1.1",
      taskStatus: "done",
      step: { text: "Table made", status: "done" },
    }),
  ];

  test("sets statuses and steps but leaves now where Claude put it", () => {
    const r = req(...events);
    expect(r?.now).toMatchObject({
      text: "Writing the save endpoint",
      ts: at(2, "Stop").ts,
    });
    expect(r?.phases[0]?.tasks[0]?.status).toBe("done");
    expect(
      r?.parts.find((p) => p.id === "db")?.steps.map((s) => s.text),
    ).toEqual(["Table made"]);
  });

  test("a change after it goes to the part Claude last named", () => {
    const r = req(...events, edit(4, "src/api.ts", ["+a"]));
    expect(
      r?.parts.find((p) => p.id === "api")?.files.map((f) => f.path),
    ).toEqual(["src/api.ts"]);
    expect(r?.parts.find((p) => p.id === "db")?.files).toEqual([]);
  });
});
