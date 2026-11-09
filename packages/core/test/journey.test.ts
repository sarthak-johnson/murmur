import { describe, expect, test } from "vitest";
import { type MapInput, reduce } from "../src/index.js";
import { at, edit, mapCall, prompt, tool } from "./helpers.js";

const ts = (n: number) =>
  new Date(Date.parse("2026-11-06T00:00:00.000Z") + n * 1000).toISOString();
const said = (n: number, text: string) => at(n, "AssistantText", { text });
const plan = (goal: string, phase: string, task: string): MapInput => ({
  kind: "feature",
  goal,
  phases: [{ id: "p1", title: phase, tasks: [{ id: "t1", title: task }] }],
  parts: [],
});

const HOUR = 3600;
const view = reduce([
  // Two questions, the second after a two-hour gap.
  prompt(0, "Why is the app slow?"),
  tool(1, "Bash", { command: "ls" }, "PreToolUse"),
  edit(2, "src/list.ts", ["+a"]),
  said(3, "The list renders every row."),
  prompt(2 * HOUR, "What about the list?"),
  said(2 * HOUR + 1, "It could be paged."),
  // A gap of 70 minutes inside the request.
  said(2 * HOUR + 1 + 70 * 60, "Paging would help most."),
  // Phase 1, approved by the user.
  prompt(4 * HOUR, "Yes please go ahead"),
  mapCall(
    4 * HOUR + 1,
    plan("Speed up the list", "Phase 1: the list", "Task 1: rows"),
  ),
  said(4 * HOUR + 2, "I'll use the dark style instead of the light one."),
  said(4 * HOUR + 3, "I'll use a map instead of a list."),
  edit(4 * HOUR + 4, "src/list.ts", ["+b"]),
  edit(4 * HOUR + 5, "src/rows.ts", ["+b"]),
  // The same task, no phase named.
  prompt(4 * HOUR + 10, "fix the rows"),
  mapCall(
    4 * HOUR + 11,
    plan("Fix the rows", "Follow-ups", "Task 1 follow-up"),
  ),
  // Phase 2.
  prompt(4 * HOUR + 20, "next"),
  mapCall(
    4 * HOUR + 21,
    plan("Start Phase 2: the page", "Build", "Task 2: page"),
  ),
  tool(4 * HOUR + 22, "Bash", { command: "pnpm test" }, "PreToolUse"),
]);
const ids = view.requests.map((r) => r.id);

describe("journey", () => {
  test("chapters group requests by shared phases and tasks, then by kind", () => {
    expect(view.journey?.chapters).toEqual([
      {
        title: "Why is the app slow?",
        requestIds: ids.slice(0, 2),
        state: "done",
      },
      {
        title: "Phase 1: the list",
        requestIds: ids.slice(2, 4),
        state: "left-open",
      },
      { title: "Phase 2", requestIds: ids.slice(4), state: "running" },
    ]);
  });

  test("pauses over an hour, between requests and inside one", () => {
    expect(view.journey?.pauses).toEqual([
      { after: ids[0], from: ts(3), to: ts(2 * HOUR), inside: false },
      {
        after: ids[1],
        from: ts(2 * HOUR + 1),
        to: ts(2 * HOUR + 1 + 70 * 60),
        inside: true,
      },
    ]);
  });

  test("decisions: a style chosen by Claude and an approving prompt", () => {
    expect(view.journey?.decisions).toEqual([
      {
        ts: ts(4 * HOUR),
        requestId: ids[2],
        text: "Yes please go ahead",
        by: "user",
      },
      {
        ts: ts(4 * HOUR + 2),
        requestId: ids[2],
        text: "I'll use the dark style instead of the light one.",
        by: "claude",
      },
    ]);
  });

  test("totals", () => {
    expect(view.journey?.totals).toEqual({
      helpers: 0,
      files: 2,
      commands: 2,
      sentBack: 0,
      pauses: 2,
    });
  });
});
