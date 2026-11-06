import { expect, test } from "vitest";
import { reduce } from "../src/index.js";
import { at, fixture, MAP, mapCall, prompt } from "./helpers.js";

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

test.each([
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
