import { type MurmurEvent, reduce } from "@murmur/core";
import { describe, expect, it } from "vitest";
import {
  actionText,
  countAt,
  doingLogOf,
  fileLogOf,
  mainLogOf,
} from "../src/office/feed";

let n = 0;
const ev = (
  ts: number,
  hook: MurmurEvent["hook"],
  payload: Record<string, unknown>,
): MurmurEvent => ({
  id: `e${++n}`,
  sessionId: "s",
  machineId: "m",
  cwd: "/repo",
  ts: new Date(Date.UTC(2026, 10, 6, 0, 0, ts)).toISOString(),
  hook,
  payload: { session_id: "s", ...payload },
});
const call = (
  ts: number,
  tool: string,
  input: Record<string, unknown>,
  extra = {},
) =>
  ev(ts, "PreToolUse", {
    tool_name: tool,
    tool_input: input,
    tool_use_id: `t${ts}`,
    ...extra,
  });

describe("mainLogOf", () => {
  it("keeps Claude's own calls and turns, not its helpers'", () => {
    const log = mainLogOf([
      ev(1, "UserPromptSubmit", { prompt: "add alerts" }),
      call(2, "Read", { file_path: "/repo/src/a.ts" }),
      call(3, "Bash", { command: "pnpm test", description: "Run the tests" }),
      call(4, "Read", { file_path: "/repo/b.ts" }, { agent_id: "h1" }),
      call(5, "Agent", {
        description: "Build alerts",
        prompt: "p",
        model: "sonnet",
      }),
      call(6, "mcp__plugin_murmur_murmur__narrate", {
        task: "2.1",
        now: "Building",
      }),
      ev(7, "UserPromptSubmit", {
        prompt: "<task-notification>done</task-notification>",
      }),
      ev(8, "Stop", {}),
    ]);
    expect(log.map((e) => [e.k, e.tool, e.label])).toEqual([
      ["prompt", undefined, undefined],
      ["tool", "Read", "a.ts"],
      ["tool", "Bash", "Run the tests"],
      ["tool", "Agent", "Build alerts"],
      ["tool", "murmur:narrate", "Building"],
      ["report", undefined, undefined],
      ["stop", undefined, undefined],
    ]);
    expect(log[3]).toMatchObject({ desc: "Build alerts", model: "sonnet" });
    expect(log[4]?.task).toBe("2.1");
  });
});

describe("countAt", () => {
  it("counts the events at or before a moment", () => {
    const evs = [
      ev(1, "Stop", {}),
      ev(2, "Stop", {}),
      ev(2, "Stop", {}),
      ev(5, "Stop", {}),
    ];
    const at = (s: number) =>
      new Date(Date.UTC(2026, 10, 6, 0, 0, s)).toISOString();
    expect(countAt(evs, at(0))).toBe(0);
    expect(countAt(evs, at(2))).toBe(3);
    expect(countAt(evs, at(4))).toBe(3);
    expect(countAt(evs, at(9))).toBe(4);
  });
});

describe("fileLogOf", () => {
  it("lists every edit and read, oldest first", () => {
    const evs = [
      ev(1, "UserPromptSubmit", { prompt: "fix the readme" }),
      call(2, "Read", { file_path: "/repo/README.md" }, { agent_id: "h1" }),
      call(3, "Edit", {
        file_path: "/repo/README.md",
        old_string: "a",
        new_string: "b",
      }),
      ev(4, "PostToolUse", {
        tool_name: "Edit",
        tool_use_id: "t3",
        tool_input: { file_path: "/repo/README.md" },
        tool_response: {
          filePath: "/repo/README.md",
          structuredPatch: [{ oldStart: 1, newStart: 1, lines: ["-a", "+b"] }],
        },
      }),
    ];
    const log = fileLogOf(reduce(evs), evs);
    expect(log.map((f) => [f.kind, f.path, f.agent])).toEqual(
      expect.arrayContaining([
        ["read", "README.md", "h1"],
        ["edit", "README.md", undefined],
      ]),
    );
    expect(log.map((f) => f.t)).toEqual([...log.map((f) => f.t)].sort());
  });
});

describe("actionText", () => {
  it("says a helper's action in plain words", () => {
    expect(actionText("Read", { file_path: "/repo/src/App.jsx" })).toBe(
      "Reading App.jsx",
    );
    expect(
      actionText("Bash", { command: "cd web && pnpm vitest run a.test.ts" }),
    ).toBe("Running tests · a.test.ts");
    expect(actionText("Bash", { command: "sed -n 1,40p src/x.css" })).toBe(
      "Reading x.css",
    );
    expect(actionText("Bash", { command: "cat > out.log <<EOF" })).toBe(
      "Writing out.log",
    );
    expect(
      actionText("Bash", { command: "ls", description: "List the plans" }),
    ).toBe("List the plans");
    expect(actionText("Bash", { command: "make" })).toBeUndefined();
  });
  it("keeps each helper's actions, not Claude's", () => {
    const log = doingLogOf([
      call(1, "Read", { file_path: "/repo/a.ts" }, { agent_id: "h1" }),
      call(2, "Read", { file_path: "/repo/b.ts" }),
      call(3, "Grep", { pattern: "x" }, { agent_id: "h1" }),
    ]);
    expect(log.get("h1")?.map((d) => d.text)).toEqual([
      "Reading a.ts",
      "Searching the code",
    ]);
    expect(log.size).toBe(1);
  });
});
