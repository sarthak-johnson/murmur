import type { RequestView } from "@murmur/core";
import { describe, expect, it } from "vitest";
import { phaseSpan, taskTimes } from "../src/session";

const step = (ts: string, agentId?: string) => ({
  ts,
  text: "x",
  status: "done" as const,
  eventIds: [],
  ...(agentId ? { agentId } : {}),
});
const agent = (id: string, startedAt: string, endedAt: string) => ({
  id,
  startedAt,
  endedAt,
});

describe("a task's own span", () => {
  // Three tasks in one part, 12:52 to 16:29; only the second has a helper of its own.
  const tasks = [
    { id: "t1", title: "Pick", part: "p", status: "done", agents: [] },
    { id: "t2", title: "Run", part: "p", status: "done", agents: ["a2"] },
    { id: "t3", title: "Fix", part: "p", status: "done", agents: [] },
  ];
  const req = {
    phases: [{ id: "ph", title: "Agent tests", tasks }],
    parts: [
      {
        id: "p",
        agents: ["a2"],
        steps: [step("2026-11-12T12:52:00Z"), step("2026-11-12T16:29:00Z")],
        span: { start: "2026-11-12T12:52:00Z", end: "2026-11-12T16:29:00Z" },
      },
    ],
    agents: [agent("a2", "2026-11-12T13:10:00Z", "2026-11-12T13:40:00Z")],
    messages: [],
  } as unknown as RequestView;

  it("is not the part's span when the part is shared", () => {
    expect(taskTimes(req, tasks[0] as never)).toEqual([]);
    expect(taskTimes(req, tasks[1] as never)).toEqual([
      "2026-11-12T13:10:00Z",
      "2026-11-12T13:40:00Z",
    ]);
  });

  it("leaves the phase its whole span", () => {
    expect(phaseSpan(req, req.phases[0] as never)).toEqual({
      from: "2026-11-12T12:52:00Z",
      to: "2026-11-12T16:29:00Z",
    });
  });
});
