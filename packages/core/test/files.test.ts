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
