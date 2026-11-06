import { expect, test } from "vitest";
import { type MurmurEvent, reduce } from "../src/index.js";
import {
  at,
  fixture,
  MAP,
  mapCall,
  narrateCall,
  note,
  prompt,
  tool,
} from "./helpers.js";

const agentCall = (n: number, description: string, type = "general-purpose") =>
  tool(
    n,
    "Agent",
    { description, prompt: `Please ${description}`, subagent_type: type },
    "PreToolUse",
  );
const byAgent = (e: MurmurEvent, id: string): MurmurEvent => ({
  ...e,
  payload: { ...e.payload, agent_id: id, agent_type: "general-purpose" },
});
const start = (n: number, id: string, type = "general-purpose") =>
  at(n, "SubagentStart", { agent_id: id, agent_type: type });
const stop = (n: number, id: string, text: string, type = "general-purpose") =>
  at(n, "SubagentStop", {
    agent_id: id,
    agent_type: type,
    last_assistant_message: text,
  });

test("subagent gets description and part", () => {
  const view = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "db" })),
    agentCall(4, "check the table"),
    agentCall(5, "write the endpoint"),
    start(6, "a1"),
    start(7, "a2"),
    byAgent(
      narrateCall(
        8,
        note({ task: "2.1", step: { text: "Wrote save", status: "done" } }),
      ),
      "a2",
    ),
    stop(9, "a1", "table is fine"),
  ]);
  const req = view.requests[0];
  expect(req?.agents).toEqual([
    {
      id: "a1",
      type: "general-purpose",
      description: "check the table",
      prompt: "Please check the table",
      part: "db",
      status: "done",
      startedAt: "2026-11-06T00:00:06.000Z",
      endedAt: "2026-11-06T00:00:09.000Z",
      lastText: "table is fine",
    },
    {
      id: "a2",
      type: "general-purpose",
      description: "write the endpoint",
      prompt: "Please write the endpoint",
      part: "api",
      status: "running",
      startedAt: "2026-11-06T00:00:07.000Z",
    },
  ]);
  expect(req?.parts[1]?.steps[0]?.agentId).toBe("a2");
  expect(req?.parts[1]?.agents).toEqual(["a2"]);
  expect(req?.phases[1]?.tasks[0]?.agents).toEqual(["a2"]);
});

test("an explicit agentId link beats start order", () => {
  const [req] = reduce([
    prompt(1, "go"),
    agentCall(2, "first"),
    agentCall(3, "second"),
    start(4, "b"),
    start(5, "a"),
    at(6, "PostToolUse", {
      tool_name: "Agent",
      tool_use_id: "t3",
      tool_input: { description: "second", prompt: "Please second" },
      tool_response: { agentId: "b" },
    }),
  ]).requests;
  expect(req?.agents.map((a) => [a.id, a.description])).toEqual([
    ["b", "second"],
    ["a", "first"],
  ]);
});

test("without a link, a start takes the oldest unclaimed call of its type", () => {
  const [req] = reduce([
    prompt(1, "go"),
    agentCall(2, "look around", "Explore"),
    agentCall(3, "build it"),
    start(4, "g", "general-purpose"),
    start(5, "x", "Explore"),
  ]).requests;
  expect(req?.agents.map((a) => [a.id, a.description])).toEqual([
    ["g", "build it"],
    ["x", "look around"],
  ]);
});

test("a background subagent that stops in a later request is closed", () => {
  const view = reduce([
    prompt(1, "go"),
    agentCall(2, "run tests"),
    start(3, "a1"),
    prompt(4, "next"),
    stop(5, "a1", "all pass"),
  ]);
  expect(view.requests[0]?.agents[0]).toMatchObject({
    status: "done",
    lastText: "all pass",
  });
  expect(view.requests[1]?.agents).toEqual([]);
});

test("feature.jsonl links its subagent; interactive prompt suggestions are ignored", () => {
  const [req] = reduce(fixture("feature.jsonl")).requests;
  expect(req?.agents).toEqual([
    {
      id: "aa6ff0aac020e7838",
      type: "general-purpose",
      description: "Read greet file",
      prompt:
        "Read greet.txt in the current directory and reply with its exact contents.",
      status: "done",
      startedAt: "2026-11-06T00:00:12.000Z",
      endedAt: "2026-11-06T00:00:16.000Z",
      lastText: "hello world",
    },
  ]);
  const view = reduce(fixture("interactive.jsonl"));
  expect(view.requests.flatMap((r) => r.agents)).toEqual([]);
});
