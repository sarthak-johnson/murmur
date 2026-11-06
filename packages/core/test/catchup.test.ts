import { expect, test } from "vitest";
import { catchUp, reduce } from "../src/index.js";
import { at, MAP, mapCall, narrateCall, note, prompt } from "./helpers.js";

const base = [prompt(0, "Price alerts"), mapCall(1, MAP)];
const run = (...more: ReturnType<typeof at>[]) => [...base, ...more];
const sub = (n: number, id: string) =>
  at(n, "SubagentStart", { agent_id: id, agent_type: "general-purpose" });

const before = reduce(
  run(
    narrateCall(2, note({ task: "1.1", taskStatus: "running" })),
    sub(3, "a1"),
  ),
);

test('catch-up reads "finished Alerts table, started Endpoint to save an alert, 1 check failing, Agent 2 started"', () => {
  const after = reduce(
    run(
      narrateCall(2, note({ task: "1.1", taskStatus: "running" })),
      sub(3, "a1"),
      narrateCall(4, note({ task: "1.1", taskStatus: "done" })),
      narrateCall(
        5,
        note({
          task: "2.1",
          taskStatus: "running",
          checks: [{ check: "saves", status: "fail" }],
        }),
      ),
      sub(6, "a2"),
    ),
  );
  expect(catchUp(before, after, "e0")).toBe(
    "finished Alerts table, started Endpoint to save an alert, 1 check failing, Agent 2 started",
  );
});

test("catch-up is null when nothing changed, or the request is unknown", () => {
  expect(catchUp(before, before, "e0")).toBeNull();
  expect(catchUp(reduce([]), before, "e0")).toBeNull();
});
