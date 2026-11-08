import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAP_TOOL, type MurmurEvent, NARRATE_TOOL, reduce } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { readBackfill } from "../src/backfill.js";
import {
  clearCredentials,
  queueDir,
  readRefresh,
  readSession,
  setPaused,
  setProjectState,
  updateSession,
  writeCredentials,
  writeSession,
} from "../src/local.js";
import { runRecap, runRefresh } from "../src/recap.js";

const SID = "44444444-2222-4333-8444-555555555555";
const T0 = Date.parse("2026-11-07T09:00:00.000Z");
/** `m` minutes after the request's prompt. */
const t = (m: number) => new Date(T0 + m * 60_000).toISOString();
const at = (m: number) => new Date(T0 + m * 60_000);

const MAP = {
  kind: "feature",
  goal: "The agent page",
  phases: [
    {
      id: "p1",
      title: "Build",
      tasks: [
        { id: "t1", title: "Task 1: header", part: "head" },
        { id: "t2", title: "Task 2: chart", part: "chart" },
      ],
    },
  ],
  parts: [
    { id: "head", title: "Header", phase: "p1" },
    { id: "chart", title: "Chart", phase: "p1" },
  ],
};

let dir: string;
let bin: string;
let cwd: string;
let transcript: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-refresh-"));
  process.env.MURMUR_HOME = path.join(dir, "murmur");
  bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  cwd = path.join(dir, "repo");
  transcript = path.join(dir, `${SID}.jsonl`);
  writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
  setProjectState(cwd, "on");
  updateSession(SID, {
    backfill: "done",
    cwd,
    project: cwd,
    transcriptPath: transcript,
  });
});

/** A tool call and its result, as Claude Code writes them. */
function call(
  id: string,
  m: number,
  name: string,
  input: unknown,
  result: Record<string, unknown> = {},
) {
  return [
    {
      type: "assistant",
      uuid: `${id}-use`,
      timestamp: t(m),
      message: { content: [{ type: "tool_use", id, name, input }] },
    },
    {
      type: "user",
      uuid: `${id}-result`,
      timestamp: t(m + 0.01),
      toolUseResult: result,
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
      },
    },
  ];
}
const narrate = (id: string, m: number, task: string, taskStatus: string) =>
  call(id, m, NARRATE_TOOL, {
    now: `${task} is ${taskStatus}`,
    why: "",
    part: task === "t1" ? "head" : "chart",
    task,
    taskStatus,
  });
/** A background helper's report, as the live hook and the backfill both send it. */
const report = (m: number, text: string) => ({
  type: "user",
  uuid: `report-${m}`,
  timestamp: t(m),
  origin: { kind: "task-notification" },
  message: {
    content: `<task-notification><task-id>b1</task-id><tool-use-id>toolu_agent</tool-use-id><status>completed</status><summary>Agent "Builder" finished</summary><result>Status: DONE\n${text}</result></task-notification>`,
  },
});
const text = (m: number, said: string) => ({
  type: "assistant",
  uuid: `text-${m}`,
  timestamp: t(m),
  message: { content: [{ type: "text", text: said }] },
});

/** The request: prompt, map, t1 running at minute 2, a background helper, then `rest`. */
function write(rest: unknown[] = [], { mapped = true } = {}) {
  const lines = [
    {
      type: "user",
      uuid: "prompt",
      timestamp: t(0),
      origin: { kind: "human" },
      message: { content: "Build the agent page" },
    },
    ...(mapped ? call("toolu_map", 1, MAP_TOOL, MAP) : []),
    ...(mapped ? narrate("toolu_n1", 2, "t1", "running") : []),
    ...call(
      "toolu_agent",
      3,
      "Agent",
      { description: "Build Task 1: header", prompt: "Build the header." },
      { status: "async_launched", agentId: "a1" },
    ),
    text(4, "Task 1 is with a builder."),
    ...rest,
  ];
  fs.writeFileSync(
    transcript,
    `${lines.map((l) => JSON.stringify({ cwd, ...(l as object) })).join("\n")}\n`,
  );
}
const reports = (...minutes: number[]) =>
  minutes.map((m) => report(m, `Round at minute ${m} finished.`));

const ANSWER = {
  tasks: [
    { id: "t1", status: "done", ended: "Header built and reviewed." },
    { id: "t2", status: "running", ended: "Chart builder started." },
  ],
  parts: [
    {
      id: "head",
      aim: { aim: "A header with the agent's name", doneWhen: "It shows" },
      checks: [{ check: "Header tests", status: "pass" }],
    },
  ],
};

/** A fake `claude` on PATH: logs its args and stdin, then answers `result`. */
function fake(result: unknown, before = "") {
  const out = JSON.stringify([
    { type: "system", subtype: "init" },
    {
      type: "result",
      is_error: false,
      total_cost_usd: 0.02,
      result: JSON.stringify(result),
    },
  ]);
  const file = path.join(bin, "claude");
  fs.writeFileSync(
    file,
    `#!/bin/sh\necho "$@" >> "${dir}/args.log"\ncat > "${dir}/stdin.txt"\n${before}\ncat <<'JSON'\n${out}\nJSON\n`,
  );
  fs.chmodSync(file, 0o755);
}
const env = (extra: Record<string, string> = {}) => ({
  PATH: `${bin}:/usr/bin:/bin`,
  CLAUDE_CODE_ENTRYPOINT: "cli",
  ...extra,
});
const calls = () =>
  fs.existsSync(`${dir}/args.log`)
    ? fs.readFileSync(`${dir}/args.log`, "utf8").trim().split("\n")
    : [];
const queued = () => {
  let names: string[] = [];
  try {
    names = fs.readdirSync(queueDir()).sort();
  } catch {}
  return names.map(
    (n) =>
      JSON.parse(
        fs.readFileSync(path.join(queueDir(), n), "utf8"),
      ) as MurmurEvent,
  );
};
/** The session as the server would hold it: the transcript's events and what was queued. */
const onServer = (now: Date) => {
  const history = readBackfill({
    sessionId: SID,
    machineId: "m1",
    cwd,
    transcriptPath: transcript,
    cutoff: now.toISOString(),
  });
  return reduce([...history, ...queued()]).requests.at(-1);
};
const quiet = { log: () => {} };

describe("live plan refresh", () => {
  it("refreshes a stale plan (3 helper reports since the last task change) and keeps its ids", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    expect(
      await runRefresh(SID, { env: env(), now: at(10), ...quiet }),
    ).toEqual({ ran: 1, ok: 1 });
    // The recap's own call: same flags.
    expect(calls()[0]).toContain("--model sonnet");
    expect(calls()[0]).toContain("--safe-mode");
    const stdin = fs.readFileSync(`${dir}/stdin.txt`, "utf8");
    for (const s of [
      '"id":"t1"',
      '"id":"head"',
      "Task 1: header",
      "Build the agent page",
      "Task 1 is with a builder.",
      "Round at minute 7 finished.",
    ])
      expect(stdin).toContain(s);

    const out = queued();
    expect(out.length).toBeGreaterThan(0);
    expect(
      out.every(
        (e) =>
          e.hook === "PostToolUse" &&
          e.payload.tool_name === NARRATE_TOOL &&
          e.payload.recap === true &&
          e.ts >= t(10),
      ),
    ).toBe(true);
    const req = onServer(at(10));
    // The request keeps the map Claude drew: same ids, not a recap.
    expect(req?.planInferred).toBe(false);
    expect(req?.recap).toBeUndefined();
    expect(req?.phases.map((ph) => ph.id)).toEqual(["p1"]);
    expect(req?.phases[0]?.tasks.map((x) => [x.id, x.status])).toEqual([
      ["t1", "done"],
      ["t2", "now"],
    ]);
    expect(req?.parts.map((p) => p.id)).toEqual(["head", "chart"]);
    const head = req?.parts[0];
    expect(head?.aim?.aim).toBe("A header with the agent's name");
    expect(head?.checks).toEqual([{ check: "Header tests", status: "pass" }]);
    expect(head?.steps.map((s) => s.text)).toEqual([
      "Header built and reviewed.",
    ]);
    expect(readRefresh(SID)).toMatchObject({
      request: req?.id,
      tried: t(10),
    });
  });

  it("the same refresh twice gives the same events", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    const first = queued().map((e) => e.id);
    fs.rmSync(path.join(dir, "murmur", "sessions", `${SID}.refresh.json`));
    fs.rmSync(queueDir(), { recursive: true });
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    expect(queued().map((e) => e.id)).toEqual(first);
  });

  it("refreshes once 20 minutes pass with no task change", async () => {
    write(reports(5));
    fake(ANSWER);
    expect(
      (await runRefresh(SID, { env: env(), now: at(17), ...quiet })).ran,
    ).toBe(0);
    expect(
      (await runRefresh(SID, { env: env(), now: at(23), ...quiet })).ok,
    ).toBe(1);
  });

  it("leaves a fresh plan alone, and one whose tasks are all done", async () => {
    write(reports(5, 6));
    fake(ANSWER);
    expect(
      (await runRefresh(SID, { env: env(), now: at(10), ...quiet })).ran,
    ).toBe(0);
    // A task change resets the count: two reports since t2 started.
    write([...reports(5, 6), ...narrate("toolu_n2", 6.5, "t2", "running")]);
    expect(
      (await runRefresh(SID, { env: env(), now: at(16), ...quiet })).ran,
    ).toBe(0);
    write([
      ...narrate("toolu_n2", 4.5, "t1", "done"),
      ...narrate("toolu_n3", 4.6, "t2", "done"),
      ...reports(5, 6, 7),
    ]);
    expect(
      (await runRefresh(SID, { env: env(), now: at(40), ...quiet })).ran,
    ).toBe(0);
    expect(calls()).toEqual([]);
  });

  it("refreshes a request at most once every 30 minutes, and never says a status twice", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    write(reports(5, 6, 7, 12, 13, 14, 15));
    expect(
      (await runRefresh(SID, { env: env(), now: at(25), ...quiet })).ran,
    ).toBe(0);
    // Past 30 minutes, and 4 reports since the first refresh changed t1: asked again.
    expect(
      (await runRefresh(SID, { env: env(), now: at(41), ...quiet })).ok,
    ).toBe(1);
    expect(calls()).toHaveLength(2);
    // t1 is done since the first refresh, so it is not asked about again.
    expect(fs.readFileSync(`${dir}/stdin.txt`, "utf8")).not.toContain(
      '"id":"t1"',
    );
    const req = onServer(at(41));
    expect(req?.parts[0]?.steps.map((s) => s.text)).toEqual([
      "Header built and reviewed.",
    ]);
    expect(req?.phases[0]?.tasks.map((x) => x.status)).toEqual(["done", "now"]);
  });

  it("a later answer that leaves a task out keeps what an earlier one said of it", async () => {
    // Seen on the author's session: the second answer named t2 only, and the third said
    // t1's outcome again because t1 read as not started.
    write(reports(5, 6, 7));
    fake(ANSWER);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    write(reports(5, 6, 7, 20));
    fake({ tasks: [ANSWER.tasks[1]], parts: [] });
    expect(
      (await runRefresh(SID, { env: env(), now: at(41), ...quiet })).ok,
    ).toBe(1);
    write(reports(5, 6, 7, 20, 50));
    fake(ANSWER);
    expect(
      (await runRefresh(SID, { env: env(), now: at(72), ...quiet })).ok,
    ).toBe(1);
    expect(fs.readFileSync(`${dir}/stdin.txt`, "utf8")).not.toContain(
      '"id":"t1"',
    );
    const req = onServer(at(72));
    expect(req?.parts[0]?.steps.map((s) => s.text)).toEqual([
      "Header built and reviewed.",
    ]);
  });

  it.each([
    [
      "a task the plan does not have",
      {
        ...ANSWER,
        tasks: [...ANSWER.tasks, { id: "t9", status: "done", ended: "x" }],
      },
    ],
    [
      "a part the plan does not have",
      { ...ANSWER, parts: [{ id: "footer", checks: [] }] },
    ],
    [
      "a new plan instead of statuses",
      { map: MAP, parts: [], tasks: [{ id: "t1" }] },
    ],
  ])(
    "refuses an answer that names %s, and does not ask again within 30 minutes",
    async (_, answer) => {
      write(reports(5, 6, 7));
      fake(answer);
      const logged: string[] = [];
      expect(
        await runRefresh(SID, {
          env: env(),
          now: at(10),
          log: (l) => logged.push(l),
        }),
      ).toEqual({ ran: 1, ok: 0 });
      expect(queued()).toEqual([]);
      expect(logged).toHaveLength(1);
      expect(
        (await runRefresh(SID, { env: env(), now: at(20), ...quiet })).ran,
      ).toBe(0);
      expect(calls()).toHaveLength(1);
    },
  );

  it("runs one refresh at a time per session", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER, "sleep 0.3");
    const both = await Promise.all([
      runRefresh(SID, { env: env(), now: at(10), ...quiet }),
      runRefresh(SID, { env: env(), now: at(10), ...quiet }),
    ]);
    expect(both.map((r) => r.ran).sort()).toEqual([0, 1]);
    expect(calls()).toHaveLength(1);
  });

  it("never from a headless run, the recap's own run, or with MURMUR_RECAP=0", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    for (const extra of [
      { MURMUR_RECAP: "0" },
      { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
      { CLAUDE_CODE_SESSION_ATTENDED: "0" },
      { MURMUR_RECAP_RUN: "1" },
    ])
      expect(
        (await runRefresh(SID, { env: env(extra), now: at(10), ...quiet })).ran,
      ).toBe(0);
    expect(calls()).toEqual([]);
    expect(readRefresh(SID)).toBeUndefined();
  });

  it("asks nothing once the project is off or the session paused", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    setProjectState(cwd, "off");
    expect(
      (await runRefresh(SID, { env: env(), now: at(10), ...quiet })).ran,
    ).toBe(0);
    setProjectState(cwd, "on");
    setPaused(cwd, true, SID);
    expect(
      (await runRefresh(SID, { env: env(), now: at(10), ...quiet })).ran,
    ).toBe(0);
    expect(calls()).toEqual([]);
  });

  it("leaves a request with no narrated map to the recap", async () => {
    write(reports(5, 6, 7), { mapped: false });
    fake(ANSWER);
    expect(
      (await runRefresh(SID, { env: env(), now: at(40), ...quiet })).ran,
    ).toBe(0);
    expect(calls()).toEqual([]);
  });
});

const steps = (now: Date, part: string) =>
  onServer(now)
    ?.parts.find((p) => p.id === part)
    ?.steps.map((x) => `${x.status}: ${x.text}`);
const statuses = (now: Date) =>
  onServer(now)?.phases[0]?.tasks.map((x) => `${x.id} ${x.status}`);

describe("review fixes", () => {
  it("a task Claude marked done stays done; done tasks are not asked about; a step only when a status moves forward", async () => {
    write([...narrate("toolu_n2", 4.5, "t1", "done"), ...reports(5, 6, 7)]);
    fake({
      tasks: [
        { id: "t1", status: "running", ended: "Header still being fixed." },
        { id: "t2", status: "running", ended: "Chart going." },
      ],
      parts: [],
    });
    expect(
      (await runRefresh(SID, { env: env(), now: at(10), ...quiet })).ok,
    ).toBe(1);
    expect(fs.readFileSync(`${dir}/stdin.txt`, "utf8")).not.toContain(
      '"id":"t1"',
    );
    expect(statuses(at(10))).toEqual(["t1 done", "t2 now"]);
    expect(steps(at(10), "head")).toEqual([]);
    expect(steps(at(10), "chart")).toEqual(["running: Chart going."]);

    // Running again is no news; failed moves it on.
    write([
      ...narrate("toolu_n2", 4.5, "t1", "done"),
      ...reports(5, 6, 7, 30, 31, 32),
    ]);
    fake({
      tasks: [{ id: "t2", status: "failed", ended: "Chart blocked on data." }],
      parts: [],
    });
    expect(
      (await runRefresh(SID, { env: env(), now: at(45), ...quiet })).ok,
    ).toBe(1);
    expect(statuses(at(45))).toEqual(["t1 done", "t2 failed"]);
    expect(steps(at(45), "chart")).toEqual([
      "running: Chart going.",
      "failed: Chart blocked on data.",
    ]);
  });

  it("failed is settled: a plan with every task done or failed is not asked about", async () => {
    write([
      ...narrate("toolu_n2", 4.5, "t1", "done"),
      ...narrate("toolu_n3", 4.6, "t2", "blocked"),
      ...reports(5, 6, 7),
    ]);
    fake(ANSWER);
    expect(
      (await runRefresh(SID, { env: env(), now: at(40), ...quiet })).ran,
    ).toBe(0);
  });

  it("Claude's blocked, read as failed, is no news for an answer that says failed", async () => {
    write([...narrate("toolu_n2", 4.5, "t2", "blocked"), ...reports(5, 6, 7)]);
    fake({
      tasks: [
        { id: "t1", status: "done", ended: "Header done." },
        { id: "t2", status: "failed", ended: "Chart blocked on data." },
      ],
      parts: [],
    });
    expect(
      (await runRefresh(SID, { env: env(), now: at(10), ...quiet })).ok,
    ).toBe(1);
    expect(steps(at(10), "chart")).toEqual([]);
    expect(steps(at(10), "head")).toEqual(["done: Header done."]);
  });

  it("keeps the newest of Claude's messages when a long request does not fit", async () => {
    const long = Array.from({ length: 60 }, (_, i) =>
      text(5 + i * 0.1, `Message ${i}: ${"x".repeat(1500)}`),
    );
    write([
      ...long,
      text(20, "Task 2 is done, the chart passed review."),
      ...reports(21, 22, 23),
    ]);
    fake({ tasks: [], parts: [] });
    await runRefresh(SID, { env: env(), now: at(30), ...quiet });
    const stdin = fs.readFileSync(`${dir}/stdin.txt`, "utf8");
    expect(stdin.length).toBeLessThanOrEqual(61_000);
    expect(stdin).toContain("Task 2 is done, the chart passed review.");
    expect(stdin).toContain("[earlier messages left out]");
    expect(stdin).not.toContain("Message 0:");
  });

  it.each([
    ["paused", () => setPaused(cwd, true, SID)],
    ["logged out", () => clearCredentials()],
    ["turned off", () => setProjectState(cwd, "off")],
  ])(
    "%s during the ask: nothing is queued, one line logged",
    async (_, change) => {
      write(reports(5, 6, 7));
      fake(ANSWER, "sleep 0.5");
      const logged: string[] = [];
      const running = runRefresh(SID, {
        env: env(),
        now: at(10),
        log: (l) => logged.push(l),
      });
      await new Promise((ok) => setTimeout(ok, 200));
      change();
      expect(await running).toEqual({ ran: 1, ok: 0 });
      expect(queued()).toEqual([]);
      expect(logged).toHaveLength(1);
    },
  );

  it("the recap too: paused during its ask, nothing is queued", async () => {
    write(reports(5, 6, 7), { mapped: false });
    const events = readBackfill({
      sessionId: SID,
      machineId: "m1",
      cwd,
      transcriptPath: transcript,
      cutoff: t(30),
    });
    const recap = {
      map: { ...MAP, phases: [], parts: [] },
      parts: [],
      tasks: [],
    };
    fake(recap, "sleep 0.5");
    const logged: string[] = [];
    const running = runRecap(SID, events, {
      env: env(),
      log: (l) => logged.push(l),
    });
    await new Promise((ok) => setTimeout(ok, 200));
    setPaused(cwd, true, SID);
    expect(await running).toEqual({ ran: 1, ok: 0 });
    expect(queued()).toEqual([]);
    expect(logged).toHaveLength(1);
  });

  it("asks at most once every 30 minutes per session, whatever the request", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    // A new request, mapped, with three reports.
    write([
      ...reports(5, 6, 7),
      {
        type: "user",
        uuid: "prompt2",
        timestamp: t(15),
        origin: { kind: "human" },
        message: { content: "Now the footer" },
      },
      ...call("toolu_map2", 16, MAP_TOOL, MAP),
      ...reports(17, 18, 19),
    ]);
    expect(
      (await runRefresh(SID, { env: env(), now: at(25), ...quiet })).ran,
    ).toBe(0);
    expect(
      (await runRefresh(SID, { env: env(), now: at(41), ...quiet })).ok,
    ).toBe(1);
  });

  it("asks again only when something new came since the last ask", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    // Stale by time (t2 still running), but nothing new since minute 10.
    expect(
      (await runRefresh(SID, { env: env(), now: at(41), ...quiet })).ran,
    ).toBe(0);
    write([...reports(5, 6, 7), text(42, "Chart is nearly there.")]);
    expect(
      (await runRefresh(SID, { env: env(), now: at(47), ...quiet })).ok,
    ).toBe(1);
  });

  it("its state survives the hook rewriting the whole session file", async () => {
    write(reports(5, 6, 7));
    fake(ANSWER);
    // The hook read the session file before the refresh and writes it back after.
    const before = readSession(SID);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    writeSession(SID, before);
    write(reports(5, 6, 7, 11, 12, 13));
    expect(
      (await runRefresh(SID, { env: env(), now: at(16), ...quiet })).ran,
    ).toBe(0);
    expect(calls()).toHaveLength(1);
  });

  it("leaves Claude's now as it was, rather than as fresh as the refresh", async () => {
    write(reports(5, 6, 7));
    const before = onServer(at(10))?.now;
    fake(ANSWER);
    await runRefresh(SID, { env: env(), now: at(10), ...quiet });
    expect(onServer(at(10))?.now).toEqual(before);
  });
});
