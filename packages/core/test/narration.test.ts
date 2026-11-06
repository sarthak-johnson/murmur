import { expect, test } from "vitest";
import { MapInput, NarrateInput } from "../src/index.js";

test("NarrateInput rejects a 201-char now and accepts a minimal note", () => {
  expect(
    NarrateInput.safeParse({ now: "x".repeat(201), why: "y" }).success,
  ).toBe(false);
  expect(
    NarrateInput.safeParse({
      now: "Building the endpoint",
      why: "the screen needs it",
    }).success,
  ).toBe(true);
});

test("NarrateInput caps arrays at 20 and other text at 300", () => {
  const file = { path: "a", role: "r" };
  const base = { now: "n", why: "w" };
  expect(
    NarrateInput.safeParse({ ...base, files: Array(21).fill(file) }).success,
  ).toBe(false);
  expect(
    NarrateInput.safeParse({ ...base, files: Array(20).fill(file) }).success,
  ).toBe(true);
  expect(
    NarrateInput.safeParse({
      ...base,
      aim: { aim: "x".repeat(301), doneWhen: "d" },
    }).success,
  ).toBe(false);
});

test("MapInput accepts a bug map and rejects an unknown kind", () => {
  const ok = {
    kind: "bug",
    goal: "fix login",
    phases: [
      { id: "p1", title: "Find", tasks: [{ id: "t1", title: "Repro" }] },
    ],
    parts: [
      {
        id: "a",
        title: "Login form",
        tag: "symptom",
        links: [{ to: "b", label: "calls" }],
      },
    ],
  };
  expect(MapInput.safeParse(ok).success).toBe(true);
  expect(MapInput.safeParse({ ...ok, kind: "nope" }).success).toBe(false);
});
