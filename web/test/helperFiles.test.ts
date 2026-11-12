import type { AgentView, MurmurEvent } from "@murmur/core";
import { describe, expect, it } from "vitest";
import { helperFiles } from "../src/fileIndex";

const bash = (id: string, command: string, paths: string[]): MurmurEvent => ({
  id,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/p",
  ts: `2026-11-11T13:3${id}:00.000Z`,
  hook: "PostToolUse",
  payload: {
    agent_id: "a1",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: {
      bashEditDiff: {
        files: paths.map((filePath) => ({
          filePath,
          hunks: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] },
          ],
        })),
      },
    },
  },
});

describe("a helper's files", () => {
  it("come from its own commands: another helper's concurrent writes in the same diff are not its", () => {
    const a = { id: "a1", files: ["tests/app.test.js"] } as unknown as AgentView;
    const files = helperFiles(a, [
      // Its own append, while two other builders wrote in the same folder.
      bash("1", "cat >> tests/app.test.js <<'EOF'\nit()\nEOF", [
        "/p/tests/app.test.js",
        "/p/frontend/src/screenerPage.js",
        "/p/contracts/useScreener.js",
      ]),
      // A script that names its file by name only, from inside its folder.
      bash("2", "cd /p/contracts; sed -i '' s/x/y/ portfolioPage.js", [
        "/p/contracts/portfolioPage.js",
        "/p/contracts/tradara-stock-page-thin.json",
      ]),
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "tests/app.test.js",
      "contracts/portfolioPage.js",
    ]);
  });
});
