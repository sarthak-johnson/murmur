import { expect, test } from "vitest";
import { reduce } from "../src/index.js";
import {
  edit,
  fixture,
  MAP,
  mapCall,
  narrateCall,
  note,
  prompt,
  tool,
  write,
} from "./helpers.js";

test("edit counts plus and minus patch lines", () => {
  const [req] = reduce([
    prompt(1, "fix it"),
    edit(2, "a.ts", [" keep", "-old", "-older", "+new"]),
    edit(3, "a.ts", ["+more"]),
  ]).requests;
  expect(req?.looseFiles).toEqual([
    {
      path: "a.ts",
      added: 2,
      removed: 2,
      isNew: false,
      eventIds: ["e2", "e3"],
    },
  ]);
});

test("write create counts content lines", () => {
  const [req] = reduce([
    prompt(1, "add files"),
    write(2, "new.ts", "one\ntwo\nthree\n"),
    write(3, "flat.ts", "no newline"),
    write(4, "old.ts", "bye\nsee you\n", "update", [
      "-hello world",
      "+bye",
      "+see you",
    ]),
    edit(5, "new.ts", ["-one", "+uno"]),
  ]).requests;
  expect(req?.looseFiles).toEqual([
    {
      path: "new.ts",
      added: 4,
      removed: 1,
      isNew: true,
      eventIds: ["e2", "e5"],
    },
    { path: "flat.ts", added: 1, removed: 0, isNew: true, eventIds: ["e3"] },
    { path: "old.ts", added: 2, removed: 1, isNew: false, eventIds: ["e4"] },
  ]);
});

test("file attaches to the part narrated before it", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    edit(2, "early.ts", ["+x"]),
    mapCall(3, MAP),
    narrateCall(4, note({ part: "db" })),
    edit(5, "db.ts", ["+x"]),
    // Task-only narrate resolves to the task's part (api).
    narrateCall(6, note({ task: "2.1" })),
    edit(7, "api.ts", ["+x"]),
    // Failed tools and reads are not touches.
    tool(8, "Edit", { file_path: "/p/bad.ts" }, "PostToolUseFailure"),
    tool(9, "Read", { file_path: "/p/api.ts" }),
  ]).requests;
  const paths = (files: { path: string }[] | undefined) =>
    files?.map((f) => f.path);
  expect(paths(req?.looseFiles)).toEqual(["early.ts"]);
  expect(paths(req?.parts[0]?.files)).toEqual(["db.ts"]);
  expect(paths(req?.parts[1]?.files)).toEqual(["api.ts"]);
});

test("a narrate naming the file wins and lends its role, before or after", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(
      3,
      note({
        part: "db",
        files: [
          { path: "/p/schema.sql", role: "the alerts table" },
          { path: "README.md", role: "only described" },
        ],
      }),
    ),
    narrateCall(4, note({ part: "api" })),
    edit(5, "schema.sql", ["+x"]),
    edit(6, "api.ts", ["+x"]),
    narrateCall(
      7,
      note({
        part: "api",
        files: [{ path: "./api.ts", role: "the endpoint" }],
      }),
    ),
  ]).requests;
  expect(req?.parts[0]?.files).toEqual([
    {
      path: "schema.sql",
      role: "the alerts table",
      added: 1,
      removed: 0,
      isNew: false,
      eventIds: ["e5"],
    },
  ]);
  expect(req?.parts[1]?.files).toEqual([
    {
      path: "api.ts",
      role: "the endpoint",
      added: 1,
      removed: 0,
      isNew: false,
      eventIds: ["e6"],
    },
  ]);
});

test("feature.jsonl counts the write then the edit of greet.txt", () => {
  const [req] = reduce(fixture("feature.jsonl")).requests;
  expect(req?.looseFiles).toEqual([
    {
      path: "greet.txt",
      added: 2,
      removed: 1,
      isNew: true,
      eventIds: ["e5", "e7"],
    },
  ]);
});

/** A Bash result whose command changed `files`, as Claude Code reports it. */
const bashEdit = (
  n: number,
  files: { filePath: string; hunks: Record<string, unknown>[] }[],
  extra: Record<string, unknown> = {},
) => ({
  ...tool(n, "Bash", { command: "python3 - <<'EOF' ..." }),
  payload: {
    tool_name: "Bash",
    tool_use_id: `t${n}`,
    tool_input: { command: "python3 - <<'EOF' ..." },
    tool_response: { stdout: "", stderr: "", bashEditDiff: { files } },
    ...extra,
  },
});

test("a Bash result's bashEditDiff counts as a change to each file", () => {
  const [req] = reduce([
    prompt(1, "fix it"),
    bashEdit(2, [
      {
        filePath: "/p/index.css",
        hunks: [
          {
            oldStart: 140,
            oldLines: 2,
            newStart: 140,
            newLines: 3,
            lines: [" a", "-b", "+c", "+d"],
          },
        ],
      },
      {
        filePath: "/p/new.test.js",
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 2,
            lines: ["+x", "+y"],
          },
        ],
      },
    ]),
    tool(3, "Bash", { command: "ls" }),
  ]).requests;
  expect(req?.looseFiles).toEqual([
    {
      path: "index.css",
      added: 2,
      removed: 1,
      isNew: false,
      eventIds: ["e2"],
    },
    {
      path: "new.test.js",
      added: 2,
      removed: 0,
      isNew: true,
      eventIds: ["e2"],
    },
  ]);
  expect(req?.tally.files).toBe(2);
});

test("Task 1's helper changed files only through Bash in a worktree: they are its part's", () => {
  const cwd = "/Users/me/app";
  // Claude Code records a subagent working in a worktree with the worktree as its cwd.
  const wt = `${cwd}/.claude/worktrees/lit-plate`;
  const sub = (e: ReturnType<typeof tool>) => ({
    ...e,
    cwd: wt,
    payload: {
      ...e.payload,
      agent_id: "a1",
      agent_type: "general-purpose",
      cwd: wt,
    },
  });
  const diff = (path: string) => ({
    filePath: `${wt}/frontend/${path}`,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-a", "+b"],
      },
    ],
  });
  const at = (e: ReturnType<typeof tool>) => ({ ...e, cwd });
  const [req] = reduce([
    at(prompt(1, "Yes please go ahead")),
    at(
      tool(
        2,
        "Agent",
        {
          description: "Implement Task 1: Lit plate tokens",
          prompt: "Build it",
          subagent_type: "general-purpose",
        },
        "PreToolUse",
      ),
    ),
    at({
      ...tool(3, "x", {}),
      hook: "SubagentStart",
      payload: { agent_id: "a1", agent_type: "general-purpose" },
    }),
    sub(bashEdit(4, [diff("src/styles/index.css"), diff("index.html")])),
    sub(bashEdit(5, [diff("src/context/ThemeContext.jsx")])),
  ]).requests;
  const part = req?.parts.find((p) => p.title === "Task 1: Lit plate tokens");
  expect(part?.files.map((f) => f.path)).toEqual([
    "frontend/src/styles/index.css",
    "frontend/index.html",
    "frontend/src/context/ThemeContext.jsx",
  ]);
  expect(req?.looseFiles).toEqual([]);
});

test("a helper's change goes to the part it narrated, even when another part names the file", () => {
  const as = (e: ReturnType<typeof tool>, id: string) => ({
    ...e,
    payload: { ...e.payload, agent_id: id, agent_type: "general-purpose" },
  });
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    // The recap says which part each helper worked on, as if the helper said it.
    as(narrateCall(3, note({ part: "db" })), "a1"),
    as(narrateCall(4, note({ part: "api" })), "a2"),
    narrateCall(
      5,
      note({ part: "api", files: [{ path: "shared.ts", role: "both" }] }),
    ),
    as(edit(6, "shared.ts", ["+db"]), "a1"),
    as(edit(7, "shared.ts", ["+api", "+api"]), "a2"),
    edit(8, "shared.ts", ["+main"]),
  ]).requests;
  const files = (id: string) =>
    req?.parts.find((p) => p.id === id)?.files.map((f) => [f.path, f.added]);
  expect(files("db")).toEqual([["shared.ts", 1]]);
  expect(files("api")).toEqual([["shared.ts", 3]]);
});
