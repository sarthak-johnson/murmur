import {
  type HookName,
  MAP_TOOL,
  type MapInput,
  type MurmurEvent,
  NARRATE_TOOL,
  type RequestView,
  reduce,
} from "@murmur/core";
import { describe, expect, it } from "vitest";
import { firstAfter, nextEventAfter } from "../src/office/feed";
import {
  BOARD_INNER,
  blocked,
  cableRoute,
  findPath,
  JOB_BOARD,
  jobCards,
} from "../src/office/map";
import {
  openFor,
  readOpen,
  roomKey,
  toolWords,
} from "../src/office/panelState";
import {
  activeRequest,
  actOf,
  asDoing,
  cutWords,
  deriveScene,
  helperName,
  latestAt,
  type MainEntry,
  type OfficeLogs,
  type Scene,
  shortOf,
  spotForTool,
} from "../src/office/scene";

// Synthetic events, as core's own tests make them (packages/core/test/helpers.ts).
const BASE = Date.parse("2026-11-06T00:00:00.000Z");
const ts = (n: number) => new Date(BASE + n * 1000).toISOString();
const at = (
  n: number,
  hook: HookName,
  payload: Record<string, unknown> = {},
): MurmurEvent => ({
  id: `e${n}`,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/p",
  ts: ts(n),
  hook,
  payload,
});
const prompt = (n: number, text: string) =>
  at(n, "UserPromptSubmit", { prompt: text });
const tool = (
  n: number,
  name: string,
  input: unknown,
  hook: HookName = "PostToolUse",
) => at(n, hook, { tool_name: name, tool_input: input, tool_use_id: `t${n}` });
/** A successful Edit of `path` (relative to cwd `/p`). */
const edit = (n: number, path: string) =>
  at(n, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: `t${n}`,
    tool_input: { file_path: `/p/${path}` },
    tool_response: {
      filePath: `/p/${path}`,
      structuredPatch: [{ oldStart: 1, newStart: 1, lines: ["+a"] }],
    },
  });
const agentCall = (n: number, description: string) =>
  tool(
    n,
    "Agent",
    {
      description,
      prompt: `Please ${description}`,
      subagent_type: "general-purpose",
    },
    "PreToolUse",
  );
const start = (n: number, id: string) =>
  at(n, "SubagentStart", { agent_id: id, agent_type: "general-purpose" });
const stop = (n: number, id: string, text: string) =>
  at(n, "SubagentStop", {
    agent_id: id,
    agent_type: "general-purpose",
    last_assistant_message: text,
  });

const MAP: MapInput = {
  kind: "feature",
  goal: "Price alerts",
  phases: [
    {
      id: "1",
      title: "Phase 1 Data",
      tasks: [{ id: "1.1", title: "Alerts table", part: "db" }],
    },
    {
      id: "2",
      title: "Phase 2 API",
      tasks: [
        { id: "2.1", title: "Endpoint to save an alert", part: "api" },
        { id: "2.2", title: "Endpoint to list alerts", part: "api" },
      ],
    },
  ],
  parts: [
    { id: "db", title: "Alerts table", phase: "1" },
    { id: "api", title: "Alerts API", phase: "2" },
  ],
};

/** A request with a plan, a builder at work on task 1.1 and a reviewer that finished. */
const EVENTS: MurmurEvent[] = [
  prompt(1, "add price alerts"),
  tool(2, MAP_TOOL, MAP),
  tool(3, NARRATE_TOOL, {
    now: "Building the table",
    why: "alerts need somewhere to live",
    task: "1.1",
    taskStatus: "running",
  }),
  agentCall(4, "Build alerts table"),
  start(5, "a1"),
  agentCall(6, "Review alerts table"),
  start(7, "a2"),
  stop(8, "a2", "Status: DONE\nLooks right."),
];

const logs = (mainLog: MainEntry[] = []): OfficeLogs => ({
  mainLog,
  doing: (id) => (id === "a1" ? "Read the schema docs" : undefined),
  info: (id) => (id === "a1" ? { model: "opus" } : undefined),
});

function sceneOf(events: MurmurEvent[], mainLog: MainEntry[] = []): Scene {
  const view = reduce(events);
  const req = view.requests.at(-1);
  if (!req) throw new Error("no request");
  const scene = deriveScene(view, req.id, view.lastEventAt, logs(mainLog));
  if (!scene) throw new Error("no scene");
  return scene;
}

describe("words", () => {
  it("names a helper by what it works on", () => {
    expect(
      helperName({ description: "Build Task 67 Portfolio reads/styles" }),
    ).toBe("Portfolio reads/styles");
    expect(helperName({ description: "Fix Task 102 round 2" })).toBe(
      "Task 102 round 2",
    );
    expect(helperName({ description: "Task 105 fix round 4 (Opus)" })).toBe(
      "Task 105 fix round 4",
    );
    expect(
      helperName({ description: "Build Task 38: capture chat reads" }),
    ).toBe("Capture chat reads");
    expect(helperName({ description: "look around" })).toBe("Look around");
  });

  it("says an imperative as what is being done", () => {
    expect(asDoing("Read HeroMoney component")).toBe(
      "Reading HeroMoney component",
    );
    expect(asDoing("Run the tests")).toBe("Running the tests");
    expect(asDoing("Write the plan")).toBe("Writing the plan");
    expect(asDoing("See the log")).toBe("Seeing the log");
    expect(asDoing("Editing a.ts")).toBe("Editing a.ts");
    expect(asDoing(undefined)).toBeUndefined();
  });

  it("reads the kind of work from the doing text", () => {
    expect(
      [
        "Reading App.jsx",
        "Searching the code",
        "Editing a.js",
        "Writing b.md",
        "Running tests",
        "git add",
        "Read HeroMoney component",
        "Find stale tests",
        undefined,
      ].map(actOf),
    ).toEqual([
      "read",
      "search",
      "edit",
      "edit",
      "run",
      "run",
      "read",
      "search",
      "edit",
    ]);
  });

  it("shortens titles to chips", () => {
    expect(
      [
        "Phase 4 Portfolio",
        "Phases 6-7: News",
        "Task 177 Library sweep",
        "Prepare",
        "Phase 6 carried fixes",
      ].map(shortOf),
    ).toEqual(["P4", "P6-7", "T177", "Prepare", "P6"]);
  });

  it("cuts at a word", () => {
    expect(cutWords("short", 10)).toBe("short");
    expect(cutWords("one two three four", 10)).toBe("one two…");
    expect(cutWords(undefined, 10)).toBeUndefined();
  });

  it("picks Claude's spot by its tool", () => {
    expect(spotForTool({ tool: "murmur:narrate" })).toBe("board");
    expect(spotForTool({ tool: "Agent" })).toBe("helper");
    expect(spotForTool({ tool: "Read" })).toBe("archive");
    expect(spotForTool({ tool: "Edit" })).toBe("desk");
    expect(
      spotForTool({
        tool: "Bash",
        label: "Log rulings, run lint and frontend tests after merge",
      }),
    ).toBe("terminal");
    expect(
      spotForTool({ tool: "Bash", label: "Read the plan's roadmap section" }),
    ).toBe("archive");
    expect(
      spotForTool({ tool: "Bash", label: "Append Phase 6 plan, log rulings" }),
    ).toBe("desk");
  });

  it("finds the latest log entry at or before a time", () => {
    const log = [{ t: ts(1) }, { t: ts(3) }, { t: ts(5) }];
    expect(latestAt(log, ts(0))).toBe(-1);
    expect(latestAt(log, ts(3))).toBe(1);
    expect(latestAt(log, ts(4))).toBe(1);
    expect(latestAt(log, ts(9))).toBe(2);
    expect(latestAt([], ts(9))).toBe(-1);
  });
});

describe("map", () => {
  it("finds a walk between two floor tiles, through free floor only", () => {
    const from = { x: 3, y: 10 };
    const to = { x: 36, y: 5 };
    const path = findPath(from, to);
    expect(path.at(-1)).toEqual(to);
    let prev = from;
    for (const p of path) {
      expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBe(1);
      if (p !== path.at(-1)) expect(blocked[p.y]?.[p.x]).toBe(false);
      prev = p;
    }
  });

  it("routes a cable from end to end", () => {
    const route = cableRoute({ x: 5, y: 6 }, { x: 5, y: 12 });
    expect(route[0]).toEqual({ x: 5, y: 6 });
    expect(route.at(-1)).toEqual({ x: 5, y: 12 });
    expect(route.length).toBeGreaterThan(2);
  });

  it("stacks older requests into one +N card", () => {
    const jobs = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i + 1}`,
      n: i + 1,
      state: "done",
    }));
    const cards = jobCards(jobs, "r9");
    const big = cards.find((c) => c.big);
    expect(big?.n).toBe(9);
    expect(big?.x).toBe(JOB_BOARD.px.x + 30);
    const small = cards.filter((c) => !c.big);
    expect(small).toHaveLength(6);
    expect(small[0]).toMatchObject({ id: "older", more: 3, ns: [1, 2, 3] });
    expect(small.slice(1).map((c) => c.n)).toEqual([4, 5, 6, 7, 8]);
    expect(jobCards(jobs.slice(0, 3), "r3").filter((c) => c.more)).toEqual([]);
  });
});

describe("deriveScene", () => {
  it("gives running and done helpers desks, with role words", () => {
    const scene = sceneOf(EVENTS);
    const builder = scene.desks.find((d) => d.agent === "a1");
    const reviewer = scene.desks.find((d) => d.agent === "a2");
    expect(builder).toMatchObject({
      kind: "build",
      slot: 0,
      status: "running",
      roleWord: "Builder",
      // A reviewer on the same table: each plate says which one it is.
      name: "Alerts table · builder",
      act: "read",
      bubble: "Reading the schema docs",
      model: "opus",
    });
    expect(reviewer).toMatchObject({
      kind: "review",
      slot: 0,
      status: "done",
      roleWord: "Reviewer",
    });
    expect(scene.running).toBe(1);
  });

  it("ties a helper on a plan task to its sticky and phase", () => {
    const scene = sceneOf(EVENTS);
    const builder = scene.desks.find((d) => d.agent === "a1");
    expect(builder).toMatchObject({
      task: "1.1",
      phase: 0,
      group: 0,
      chip: "P1",
    });
    const note = scene.columns[0]?.notes[0];
    expect(note?.heads).toEqual(["a1"]);
    expect(note?.stage).toBe("building");
  });

  it("mirrors the plan's phases as board columns", () => {
    const scene = sceneOf(EVENTS);
    expect(scene.columns.map((c) => c.title)).toEqual([
      "Phase 1 Data",
      "Phase 2 API",
    ]);
    expect(scene.columns.map((c) => c.notes.map((n) => n.id))).toEqual([
      ["1.1"],
      ["2.1", "2.2"],
    ]);
    expect(scene.plan).toEqual({ done: 0, total: 3 });
    expect(scene.request).toMatchObject({ n: 1, current: true });
    expect(BOARD_INNER.notesY).toBeGreaterThan(0);
  });

  it("says what Claude did as what it is doing while under way", () => {
    const working = [
      prompt(1, "tidy the docs"),
      edit(2, "docs/a.md"),
      agentCall(3, "Implement Task 1: tokens"),
      start(4, "b1"),
    ];
    const titles = (events: MurmurEvent[]) =>
      sceneOf(events).columns.map((c) => c.title);
    expect(titles(working)).toEqual(["What Claude is doing"]);
    expect(titles([...working, stop(5, "b1", "done")])).toEqual([
      "What Claude did",
    ]);
  });

  it("puts Claude where its last own call was", () => {
    const spot = (e: Omit<MainEntry, "t" | "k">) =>
      sceneOf(EVENTS, [
        { t: ts(1), k: "prompt" },
        { t: ts(8), k: "tool", ...e },
      ]).claude;
    expect(spot({ tool: "murmur:narrate", task: "2.1" })).toMatchObject({
      spot: "board",
      column: 1,
    });
    expect(spot({ tool: "Bash", label: "Run the tests" })).toMatchObject({
      spot: "terminal",
      bubble: "Run the tests",
    });
    expect(spot({ tool: "Read", label: "schema.sql" }).spot).toBe("archive");
    expect(spot({ tool: "Agent", desc: "Build alerts table" })).toMatchObject({
      spot: "helper",
      helper: "a1",
      bubble: "Briefing: Alerts table · builder",
    });
    // Before any call of its own in this request, Claude watches from its desk.
    expect(sceneOf(EVENTS).claude).toMatchObject({
      spot: "desk",
      idle: true,
      bubble: "Watching 1 helper",
    });
  });

  it("brings Claude to your door while it waits on you", () => {
    const scene = sceneOf(
      [
        ...EVENTS,
        at(9, "Notification", {
          message: "Should I add a migration?",
          notification_type: "elicitation_dialog",
        }),
      ],
      [{ t: ts(8), k: "tool", tool: "Read", label: "schema.sql" }],
    );
    expect(scene.waiting).toMatchObject({
      text: "Should I add a migration?",
      since: ts(9),
    });
    expect(scene.claude).toMatchObject({
      spot: "door",
      waiting: true,
      bubble: "Should I add a migration?",
    });
  });

  it("shows an earlier request's floor with Claude away", () => {
    const events = [...EVENTS, prompt(10, "now the emails")];
    const view = reduce(events);
    const first = view.requests[0];
    if (!first) throw new Error("no request");
    const scene = deriveScene(view, first.id, view.lastEventAt, logs());
    expect(scene?.claude.spot).toBe("away");
    expect(scene?.request.current).toBe(false);
    expect(scene?.jobs.map((j) => j.n)).toEqual([1, 2]);
  });

  it("has no scene for a view with no request", () => {
    expect(
      deriveScene({ requests: [], needsYou: null }, "r1", ts(0), logs()),
    ).toBeNull();
  });
});

describe("the floor Claude is on", () => {
  it("is the newest request at work or waiting, else the newest", () => {
    const r = (id: string, state: string, phases: unknown[] = []) => ({
      id,
      state,
      phases,
    });
    expect(
      activeRequest([r("1", "done"), r("2", "running"), r("3", "done")])?.id,
    ).toBe("2");
    expect(activeRequest([r("1", "waiting"), r("2", "done")])?.id).toBe("1");
    expect(activeRequest([r("1", "done"), r("2", "done")])?.id).toBe("2");
    expect(activeRequest([])).toBeUndefined();
    // A newest request with its own plan stays the floor once over.
    expect(activeRequest([r("1", "running"), r("2", "done", [{}])])?.id).toBe(
      "2",
    );
  });

  it("carries an earlier request's helper while it is at work, not once it has gone quiet", () => {
    const view = reduce([...EVENTS, prompt(9, "and a list page")]);
    const next = view.requests.at(-1);
    if (!next) throw new Error("no request");
    const carried = (t: string) =>
      deriveScene(view, next.id, t, logs())?.desks.find(
        (d) => d.agent === "a1",
      );
    expect(carried(ts(10))).toMatchObject({
      fromRequest: 1,
      status: "running",
    });
    // Two hours with no word from it: its stop was never recorded, it is not at work.
    expect(carried(ts(2 * 3600))).toBeUndefined();
  });
});

describe("replay times", () => {
  it("finds the next event and the first file hit after a moment", () => {
    expect(nextEventAfter([10, 20, 20, 30], 20)).toBe(30);
    expect(nextEventAfter([10, 20], 5)).toBe(10);
    expect(nextEventAfter([10, 20], 20)).toBe(Number.POSITIVE_INFINITY);
    const hit = (ms: number) => ({
      t: "",
      ms,
      path: "a",
      kind: "read" as const,
    });
    expect(firstAfter([hit(1), hit(5), hit(5), hit(9)], 5)).toBe(3);
    expect(firstAfter([], 5)).toBe(0);
  });
});

describe("what a click in the room opens", () => {
  it("is the tab that tells its story, or a close-up", () => {
    const req = {
      phases: [{ tasks: [{ id: "1.1", part: "db" }, { id: "1.2" }] }],
    } as unknown as RequestView;
    expect(openFor("phase:2")).toBe("tasks");
    expect(openFor("archive")).toBe("files");
    expect(openFor("jobs")).toBe("requests");
    expect(openFor("claude")).toBe("claude");
    expect(openFor("agent:a1")).toBe("helper:a1");
    // A sticky opens as its own task: several tasks can share one part.
    expect(openFor("task:1.1")).toBe("task:1.1");
    expect(openFor("task:1.2")).toBe("task:1.2");
    // And the panel's close-up lights the same thing in the room, a part's by its first task.
    expect(roomKey("task:1.1", req)).toBe("task:1.1");
    expect(roomKey("task:db", req)).toBe("task:1.1");
    expect(roomKey("helper:a1", req)).toBe("agent:a1");
    expect(roomKey("story", req)).toBeNull();
  });
  it("reads only what the panel can show from the address", () => {
    expect(readOpen("journey")).toBe("journey");
    expect(readOpen("task:p:1")).toBe("task:p:1");
    expect(readOpen("task:")).toBeNull();
    expect(readOpen("nope")).toBeNull();
    expect(readOpen(undefined)).toBeNull();
  });
  it("names a helper with nothing but a model note", () => {
    expect(helperName({ description: "(Opus)" })).toBe("A helper");
  });
});

describe("round 4", () => {
  it("chips numbered batches apart", () => {
    expect(shortOf("Batch 2 Library")).toBe("B2");
    expect(shortOf("Batch 3: Settings")).toBe("B3");
  });
  it("stops this request's own helper once it has gone quiet for an hour", () => {
    const view = reduce(EVENTS);
    const req = view.requests.at(-1);
    if (!req) throw new Error("no request");
    const at = (t: string) =>
      deriveScene(view, req.id, t, logs())?.desks.find((d) => d.agent === "a1")
        ?.status;
    expect(at(ts(20))).toBe("running");
    expect(at(ts(2 * 3600))).toBe("done");
  });
});

describe("round 5", () => {
  it("says tools in words", () => {
    expect(toolWords("ArtifactData")).toBe("Updated an artifact's data");
    expect(toolWords("mcp__claude-in-chrome__browser_batch")).toBe(
      "Used the browser",
    );
    expect(toolWords("mcp__claude_ai_Supabase__execute_sql")).toBe(
      "Used Supabase",
    );
    expect(toolWords("NotebookEdit")).toBe("Edited a notebook");
    expect(toolWords("ListAgents")).toBe("Used list agents");
  });
  it("seats a reviewer with no review desk free at a free work desk", () => {
    const evs: MurmurEvent[] = [prompt(1, "review everything")];
    for (let i = 0; i < 5; i++) {
      evs.push(agentCall(2 + i * 2, `Review part ${i}`));
      evs.push(start(3 + i * 2, `r${i}`));
    }
    const scene = sceneOf(evs);
    expect(scene.desks).toHaveLength(5);
    expect(scene.off).toHaveLength(0);
    expect(scene.desks.filter((d) => d.kind === "build")).toHaveLength(1);
  });
});

describe("round 7", () => {
  it("names a fix round by its task's subject", () => {
    expect(helperName({ description: "Fix round Task 142 News page" })).toBe(
      "News page",
    );
  });
});
