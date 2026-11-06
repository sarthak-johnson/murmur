import { expect, test } from "vitest";
import { assumptionKey, isRisky, reduce } from "../src/index.js";
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

const bash = (
  n: number,
  command: string,
  hook:
    | "PostToolUse"
    | "PostToolUseFailure"
    | "PreToolUse" = "PostToolUseFailure",
) => tool(n, "Bash", { command }, hook);

test("permission prompt sets needs-you and the next tool call clears it", () => {
  const events = [
    prompt(1, "go"),
    tool(2, "Write", { file_path: "/p/a" }, "PreToolUse"),
    at(3, "PermissionRequest", {
      tool_name: "Write",
      tool_input: { file_path: "/p/a" },
    }),
    at(4, "Notification", {
      message: "Claude needs your permission",
      notification_type: "permission_prompt",
    }),
  ];
  expect(reduce(events).needsYou).toEqual({
    reason: "permission",
    text: "Claude needs your permission to use Write",
    since: "2026-11-06T00:00:03.000Z",
  });
  expect(reduce([...events, tool(5, "Write", {})]).needsYou).toBeNull();
});

test("approved tool that fails clears needs-you", () => {
  const view = reduce([
    prompt(1, "go"),
    bash(2, "pnpm test", "PreToolUse"),
    at(3, "PermissionRequest", { tool_name: "Bash" }),
    bash(4, "pnpm test"),
  ]);
  expect(view.needsYou).toBeNull();
});

test.each([
  ["elicitation_dialog", "question"],
  ["idle_prompt", "idle"],
  ["agent_needs_input", "input"],
])("notification %s is needs-you %s until the next prompt", (type, reason) => {
  const events = [
    prompt(1, "go"),
    at(2, "Notification", { message: "hello", notification_type: type }),
  ];
  expect(reduce(events).needsYou).toEqual({
    reason,
    text: "hello",
    since: "2026-11-06T00:00:02.000Z",
  });
  expect(reduce([...events, prompt(3, "more")]).needsYou).toBeNull();
});

test("interactive.jsonl ends with nothing needing you", () => {
  const events = fixture("interactive.jsonl");
  expect(reduce(events.slice(0, 7)).needsYou?.reason).toBe("permission");
  expect(reduce(events.slice(0, 20)).needsYou?.reason).toBe("idle");
  expect(reduce(events).needsYou).toBeNull();
});

test("three same failures make a stuck flag", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "api", task: "2.1" })),
    bash(4, "pnpm test"),
    tool(5, "Edit", { file_path: "/p/a.ts" }),
    bash(6, "pnpm test"),
    bash(7, "pnpm lint"),
    bash(8, "pnpm test"),
    bash(9, "pnpm test"),
  ]).requests;
  expect(req?.flags).toEqual([
    {
      kind: "stuck",
      text: "Tried a fix 4 times",
      part: "api",
      ts: "2026-11-06T00:00:08.000Z",
      pending: true,
    },
  ]);
  expect(req?.parts[1]?.failures).toBe(4);
  expect(req?.phases[1]?.tasks[0]?.problem).toBe("Tried a fix 4 times");
});

test("two failures do not", () => {
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "api", task: "2.1" })),
    bash(4, "pnpm test"),
    bash(5, "pnpm test"),
    bash(6, "pnpm test", "PostToolUse"),
    bash(7, "pnpm test"),
    bash(8, "pnpm test"),
    tool(9, "Edit", { file_path: "/p/a.ts" }, "PostToolUseFailure"),
  ]).requests;
  expect(req?.flags).toEqual([]);
  expect(req?.parts[1]?.failures).toBe(0);
  expect(req?.phases[1]?.tasks[0]?.problem).toBeUndefined();
});

test("a success after a stuck run ends it and clears the problem", () => {
  const [req] = reduce([
    prompt(1, "go"),
    bash(2, "pnpm test"),
    bash(3, "pnpm test"),
    bash(4, "pnpm test"),
    bash(5, "pnpm test", "PostToolUse"),
  ]).requests;
  expect(req?.flags).toEqual([
    {
      kind: "stuck",
      text: "Tried a fix 3 times",
      ts: "2026-11-06T00:00:04.000Z",
      pending: false,
    },
  ]);
});

test("three failed narrate steps on a part are stuck; a done step resets", () => {
  const step = (n: number, status: string) =>
    narrateCall(n, note({ task: "1.1", step: { text: status, status } }));
  const run = (...statuses: string[]) =>
    reduce([
      prompt(1, "add alerts"),
      mapCall(2, MAP),
      ...statuses.map((s, i) => step(3 + i, s)),
    ]).requests[0];
  const two = run("failed", "failed");
  expect(two?.flags).toEqual([]);
  expect(two?.parts[0]?.failures).toBe(2);
  const stuck = run("failed", "done", "failed", "failed", "failed");
  expect(stuck?.flags).toEqual([
    {
      kind: "stuck",
      text: "Tried a fix 3 times",
      part: "db",
      ts: "2026-11-06T00:00:07.000Z",
      pending: true,
    },
  ]);
  expect(stuck?.parts[0]?.failures).toBe(3);
  expect(stuck?.phases[0]?.tasks[0]?.problem).toBe("Tried a fix 3 times");
  const fixed = run("failed", "failed", "failed", "running");
  expect(fixed?.flags[0]?.pending).toBe(false);
  expect(fixed?.parts[0]?.failures).toBe(0);
  expect(fixed?.phases[0]?.tasks[0]?.problem).toBeUndefined();
});

test("force push is risky and pending until it finishes", () => {
  const events = [
    prompt(1, "ship"),
    mapCall(2, MAP),
    narrateCall(3, note({ part: "api" })),
    bash(4, "git push --force origin main", "PreToolUse"),
  ];
  const flag = {
    kind: "risky",
    text: "About to run: git push --force origin main",
    part: "api",
    ts: "2026-11-06T00:00:04.000Z",
    pending: true,
  };
  expect(reduce(events).requests[0]?.flags).toEqual([flag]);
  const done = reduce([
    ...events,
    {
      ...bash(5, "git push --force origin main", "PostToolUse"),
      payload: { tool_name: "Bash", tool_use_id: "t4" },
    },
  ]);
  expect(done.requests[0]?.flags).toEqual([{ ...flag, pending: false }]);
  const long = `rm -rf ${"x".repeat(200)}`;
  const [cut] =
    reduce([prompt(1, "go"), bash(2, long, "PreToolUse")]).requests[0]?.flags ??
    [];
  expect(cut?.text).toBe(`About to run: ${long.slice(0, 120)}`);
});

const denied = [
  prompt(1, "ship"),
  bash(2, "git push --force", "PreToolUse"),
  at(3, "PermissionRequest", { tool_name: "Bash" }),
];

test("denied risky command stops being pending at the next Stop", () => {
  const [req] = reduce([...denied, at(4, "Stop")]).requests;
  expect(req?.flags.map((f) => f.pending)).toEqual([false]);
  const [ended] = reduce([...denied, at(4, "SessionEnd")]).requests;
  expect(ended?.flags.map((f) => f.pending)).toEqual([false]);
  const [live] = reduce(denied).requests;
  expect(live?.flags.map((f) => f.pending)).toEqual([true]);
});

test("denied risky command stops being pending at the next prompt", () => {
  const [req] = reduce([...denied, prompt(4, "never mind")]).requests;
  expect(req?.flags.map((f) => f.pending)).toEqual([false]);
});

test.each([
  ["rm -rf build", true],
  ["rm -fr build", true],
  ["rm -r -f build", true],
  ["rm -Rf build", true],
  ["cd x && rm --recursive --force y", true],
  ["rm -r build", false],
  ["rm -f a.txt", false],
  ["echo rm; ls -rf", false],
  ["git push -f", true],
  ["git -C repo push origin main --force-with-lease", true],
  ["git push origin main", false],
  ["git reset --hard HEAD~1", true],
  ["git reset --soft HEAD~1", false],
  ["psql -c 'DROP TABLE alerts'", true],
  ["psql -c 'drop database x'", true],
  ["deploy --env prod", true],
  ["kubectl apply -f production.yaml", true],
  ["cat products.json", false],
  ["pnpm test", false],
  [`bash -c "rm -rf x"`, true],
  ["ssh h 'rm -rf /tmp/x'", true],
  ["\\rm -rf x", true],
  [`echo $(git push -f)`, true],
])("isRisky(%j) is %s", (command, risky) => {
  expect(isRisky(command)).toBe(risky);
});

test("assumptions dedupe by key", () => {
  const choice = (
    n: number,
    part: string,
    assumption: boolean,
    reason = "simple",
  ) =>
    narrateCall(
      n,
      note({ part, choices: [{ choice: "Use REST", reason, assumption }] }),
    );
  const [req] = reduce([
    prompt(1, "add alerts"),
    mapCall(2, MAP),
    choice(3, "api", true),
    choice(4, "api", true, "said again"),
    choice(5, "db", true),
    choice(6, "db", false),
  ]).requests;
  expect(req?.assumptions).toEqual([
    {
      key: assumptionKey("e1", "api", "Use REST"),
      part: "api",
      choice: "Use REST",
      reason: "simple",
      ts: "2026-11-06T00:00:03.000Z",
    },
    {
      key: assumptionKey("e1", "db", "Use REST"),
      part: "db",
      choice: "Use REST",
      reason: "simple",
      ts: "2026-11-06T00:00:05.000Z",
    },
  ]);
  expect(assumptionKey("r1", undefined, "a")).toBe("r1:-:e40c292c");
  expect(assumptionKey("r1", "p", "b")).toBe("r1:p:e70c2de5");
});

test("a risky command whose Post arrives with an earlier ts is not pending", () => {
  const post = {
    ...bash(2, "rm -rf build", "PostToolUse"),
    payload: { tool_name: "Bash", tool_use_id: "t3" },
  };
  const [req] = reduce([
    prompt(1, "clean"),
    post,
    bash(3, "rm -rf build", "PreToolUse"),
  ]).requests;
  expect(req?.flags.map((f) => [f.kind, f.pending])).toEqual([
    ["risky", false],
  ]);
});

test.each([
  ["quotes", `"'\`);`.repeat(262144 / 5)],
  ["quoted word", `x${`'`.repeat(262144)}x`],
  ["parens word", `a${"();".repeat(262144 / 3)}b`],
  ["separators", ";&|\n".repeat(262144 / 4)],
  ["spaces", ` ${"a ".repeat(262144 / 2)}`],
  ["rm words", "rm -r ".repeat(262144 / 6)],
  ["git words", "git push reset ".repeat(262144 / 15)],
])("isRisky stays fast on hostile %s input", (_, cmd) => {
  const t = performance.now();
  isRisky(cmd);
  expect(performance.now() - t).toBeLessThan(200);
});
