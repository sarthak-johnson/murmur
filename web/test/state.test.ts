// One reading of names, states and times for every view: state.ts, the plan's places,
// the file index and a helper's gist, on views shaped like the real sessions that disagreed.
import type {
  AgentView,
  PartView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import { describe, expect, it } from "vitest";
import { fileIndex, requestFiles } from "../src/fileIndex";
import { bands } from "../src/flow/flow";
import { deriveScene, type OfficeLogs, shortOf } from "../src/office/scene";
import {
  besideOf,
  nowLine,
  phaseName,
  placeOf,
  taskTitle,
  waitingOn,
  youAsked,
} from "../src/session";
import {
  helperNow,
  requestNow,
  rowState,
  sessionFacts,
  sessionNow,
  sessionSpan,
  workState,
} from "../src/state";
import { helperGist, helperLine, verdictOf } from "../src/story";

const H = 3_600_000;
const T0 = Date.parse("2026-11-09T18:00:00Z");
const t = (ms: number) => new Date(T0 + ms).toISOString();

const part = (p: Partial<PartView> & { id: string }): PartView => ({
  title: p.id,
  status: "done",
  links: [],
  steps: [],
  files: [],
  choices: [],
  checks: [],
  words: [],
  agents: [],
  failures: 0,
  ...p,
});
const task = (
  id: string,
  title: string,
  status: TaskView["status"] = "done",
  p?: string,
): TaskView => ({ id, title, status, agents: [], ...(p ? { part: p } : {}) });
const agent = (a: Partial<AgentView> & { id: string }): AgentView => ({
  type: "general-purpose",
  description: "Build it",
  prompt: "",
  status: "done",
  startedAt: t(0),
  ...a,
});
const request = (r: Partial<RequestView> & { id: string }): RequestView =>
  ({
    prompt: "Do the thing",
    goal: "Do the thing",
    kind: "feature",
    startedAt: t(0),
    phases: [],
    parts: [],
    agents: [],
    looseFiles: [],
    flags: [],
    assumptions: [],
    tally: { helpers: 0, files: 0, commands: 0 },
    ...r,
  }) as RequestView;
const session = (s: Partial<SessionView> = {}): SessionView =>
  ({
    sessionId: "s1",
    cwd: "/p",
    title: "A session",
    startedAt: t(0),
    lastEventAt: t(2 * H),
    ended: false,
    needsYou: null,
    requests: [request({ id: "r1", state: "running" })],
    ...s,
  }) as SessionView;
const fileTouch = (path: string, added = 1, removed = 0) => ({
  path,
  added,
  removed,
  isNew: false,
  eventIds: [],
});

describe("a session's state", () => {
  it("is live while something happened in the last 15 minutes, its clocks at the moment", () => {
    const ses = sessionNow(session(), "live", T0 + 2 * H + 5 * 60_000);
    expect([ses.tag, ses.word, ses.ticking]).toEqual(["live", "Live", true]);
    expect(ses.end).toBe(t(2 * H + 5 * 60_000));
  });

  it("quiet after that: its clocks stop at its last event", () => {
    const ses = sessionNow(session(), "live", T0 + 30 * H);
    expect([ses.tag, ses.ticking, ses.end]).toEqual(["quiet", false, t(2 * H)]);
    expect(ses.quietFor).toBe(28 * H);
  });

  it("waiting on you for days is not live: it says waiting, its wait still ticks", () => {
    const view = session({
      needsYou: { reason: "input", text: "Ship it?", since: t(2 * H) },
    });
    const ses = sessionNow(view, "live", T0 + 67 * H);
    expect([ses.tag, ses.word, ses.ticking]).toEqual([
      "waiting",
      "Waiting on you",
      true,
    ]);
    // The work's clocks stop at its last event; only the wait runs on.
    expect(ses.end).toBe(t(2 * H));
  });

  it("ended and offline sessions never tick", () => {
    expect(sessionNow(session({ ended: true }), "live").tag).toBe("ended");
    expect(sessionNow(session(), "error").tag).toBe("offline");
    expect(sessionNow(session(), "reconnecting", T0 + 2 * H).tag).toBe(
      "reconnecting",
    );
  });

  it("one span for the session, from its first request to where its clocks stop", () => {
    const view = session({
      startedAt: t(-60_000),
      requests: [request({ id: "r1", startedAt: t(0), state: "done" })],
      lastEventAt: t(21 * H + 16 * 60_000),
    });
    // Live (its last event 14 minutes ago): to the moment, the same in every line.
    const live = sessionNow(view, "live", T0 + 21 * H + 30 * 60_000);
    expect(sessionSpan(live)).toBe("21 h 30 m");
    expect(sessionFacts(view, live)).toBe("1 request · 21 h 30 m");
    // Quiet: to its last event.
    const quiet = sessionNow(view, "live", T0 + 21 * H + 40 * 60_000);
    expect(sessionSpan(quiet)).toBe("21 h 16 m");
  });
});

describe("a request's state", () => {
  it("core's running request in a quiet session is paused, and says how long it ran", () => {
    const view = session();
    const r = view.requests[0] as RequestView;
    const ses = sessionNow(view, "live", T0 + 32 * H);
    const now = requestNow(view, r, [], ses);
    expect([now.state, now.word, now.mark, now.tone]).toEqual([
      "paused",
      "Paused",
      "open",
      "todo",
    ]);
    expect(now.label).toBe("Paused · ran 2 h 00 m");
    expect(now.to).toBe(t(2 * H));
  });

  it("runs while the session is live, its clock at the moment", () => {
    const view = session();
    const r = view.requests[0] as RequestView;
    const now = requestNow(view, r, [], sessionNow(view, "live", T0 + 2 * H));
    expect(now.state).toBe("running");
    expect(now.label).toBe("Running · 2 h 00 m");
  });

  it("waits on you with the wait's own clock", () => {
    const view = session({
      needsYou: { reason: "input", text: "Ship it?", since: t(H) },
      requests: [request({ id: "r1", state: "waiting" })],
    });
    const r = view.requests[0] as RequestView;
    const now = requestNow(view, r, [], sessionNow(view, "live", T0 + 66 * H));
    expect(now.state).toBe("waiting");
    expect(now.label).toBe("Waiting on you · 65 h 00 m");
  });

  it("a request core left open reads left open, its work too", () => {
    const view = session({
      requests: [request({ id: "r1", state: "left-open", finished: true })],
    });
    const r = view.requests[0] as RequestView;
    const now = requestNow(view, r, [], sessionNow(view, "live", T0 + 2 * H));
    expect(now.word).toBe("Left open");
    expect(workState("now", now.state)).toBe("open");
    expect(workState("now", "paused")).toBe("paused");
    expect(workState("now", "running")).toBe("running");
    expect(workState("blocked", "waiting")).toBe("waiting");
    expect(workState("todo", "running")).toBe("todo");
  });
});

describe("a helper's state", () => {
  it("silent for an hour, it is not at work: paused at its last sign, as the room seats it", () => {
    const a = agent({
      id: "a1",
      status: "running",
      doing: { text: "Running tests", ts: t(10 * 60_000) },
    });
    expect(helperNow(a, t(30 * 60_000)).state).toBe("running");
    const late = helperNow(a, t(2 * H));
    expect([late.state, late.to]).toEqual(["paused", t(10 * 60_000)]);
    // The room agrees: its desk shows it done at that sign, not at work.
    const view = session({
      requests: [request({ id: "r1", state: "running", agents: [a] })],
    });
    const logs: OfficeLogs = {
      mainLog: [],
      doing: () => undefined,
      info: () => undefined,
    };
    const scene = deriveScene(view, "r1", t(2 * H), logs);
    expect(scene?.desks[0]?.status).toBe("done");
    expect(scene?.desks[0]?.endedAt).toBe(t(10 * 60_000));
  });

  it("still running in a request that is over, it was left open", () => {
    const a = agent({ id: "a1", status: "running" });
    expect(helperNow(a, t(60_000), "open").state).toBe("open");
    expect(helperNow(a, t(60_000), "paused").state).toBe("paused");
  });
});

describe("one task, one title, one number, one phase name", () => {
  // Request 15 of the redesign session: three plan tasks on one map part.
  const r = request({
    id: "r15",
    phases: [
      {
        id: "p1",
        title: "Agent tests",
        status: "done",
        tasks: [
          task("t1", "Pick the affected agent specs", "done", "e2e"),
          task("t2", "Run them against the shared database", "done", "e2e"),
          task("t3", "Fix anything that fails", "done", "e2e"),
        ],
      },
      {
        id: "p2",
        title: "Merge",
        status: "done",
        tasks: [
          task("t4", "Mark PR ready and check it merges cleanly", "done", "pr"),
          task("t5", "Merge to staging and watch the deploy", "done", "pr"),
        ],
      },
    ],
    parts: [
      part({ id: "e2e", title: "Agent end-to-end tests (real browser)" }),
      part({ id: "pr", title: "PR #1664 to staging" }),
    ],
  });

  it("a sticky opens as its own task: its number, title and phase, the next one after it", () => {
    const place = placeOf(r, { task: "t2", part: "e2e" });
    expect([place?.n, place?.of, place?.title, place?.phase?.title]).toEqual([
      2,
      5,
      "Run them against the shared database",
      "Agent tests",
    ]);
    expect(place?.key).toBe("task:t2");
    const { prev, next } = besideOf(r, place as NonNullable<typeof place>);
    expect([prev?.n, prev?.title]).toEqual([
      1,
      "Pick the affected agent specs",
    ]);
    expect([next?.n, next?.title]).toEqual([3, "Fix anything that fails"]);
  });

  it("a part opened by its id is its first task", () => {
    expect(placeOf(r, { part: "pr" })?.n).toBe(4);
  });

  it("a folder Murmur grouped the work by reads as words, never as a path", () => {
    expect(
      taskTitle({ id: "dir:server/alphatake", title: "server/alphatake" }),
    ).toBe("Changes in alphatake");
    expect(taskTitle({ id: "x", title: "web/src/state.ts" })).toBe("state.ts");
    expect(taskTitle({ id: "x", title: "Task 3: Reminder list" })).toBe(
      "Reminder list",
    );
  });

  it("the inferred phase is one name on the board, in Tasks and in Flow", () => {
    const did = {
      id: "did",
      title: "What Claude did",
      status: "now" as const,
      tasks: [task("dir:web", "web", "now", "dir:web")],
    };
    const inferred = request({
      id: "r",
      planInferred: true,
      phases: [did],
      parts: [part({ id: "dir:web", title: "web", status: "now" })],
    });
    // The part has no phase of its own: it sits in its task's, not "Other work".
    expect(bands(inferred, true).map((b) => b.title)).toEqual([
      "What Claude is doing",
    ]);
    expect(phaseName(did, true)).toBe("What Claude is doing");
    expect(bands(inferred, false).map((b) => b.title)).toEqual([
      "What Claude did",
    ]);
  });

  it("desk chips are whole words or cut with a stop; two alike are numbered", () => {
    expect(shortOf("Unhandled rejection in agent meta")).toBe("Unhandled");
    expect(shortOf("Screenshots of every page")).toBe("Screensh.");
    expect(shortOf("Task 177 Library sweep")).toBe("T177");
    const r13 = request({
      id: "r13",
      state: "done",
      phases: [
        {
          id: "did",
          title: "What Claude did",
          status: "done",
          tasks: [
            {
              ...task("a", "Final whole-branch review", "done"),
              agents: ["x"],
            },
            { ...task("b", "Final fixes: Portfolio", "done"), agents: ["y"] },
          ],
        },
      ],
      agents: [agent({ id: "x" }), agent({ id: "y", startedAt: t(1) })],
    });
    const logs: OfficeLogs = {
      mainLog: [],
      doing: () => undefined,
      info: () => undefined,
    };
    const scene = deriveScene(session({ requests: [r13] }), "r13", t(H), logs);
    expect(scene?.desks.map((d) => d.chip).sort()).toEqual([
      "Final 1",
      "Final 2",
    ]);
  });
});

describe("files counted once", () => {
  const r = request({
    id: "r9",
    parts: [
      part({ id: "a", files: [fileTouch("x.ts", 3, 1), fileTouch("y.ts")] }),
      part({ id: "b", files: [fileTouch("x.ts", 2, 0)] }),
    ],
    looseFiles: [fileTouch("z.md")],
    phases: [
      {
        id: "p",
        title: "P",
        status: "done",
        tasks: [
          task("ta", "Build A", "done", "a"),
          task("tb", "Build B", "done", "b"),
        ],
      },
    ],
  });

  it("a file under two tasks is one file, its lines added up", () => {
    const files = requestFiles(r);
    expect(files.map((f) => f.path).sort()).toEqual(["x.ts", "y.ts", "z.md"]);
    const x = files.find((f) => f.path === "x.ts");
    expect([x?.added, x?.removed]).toEqual([5, 1]);
    expect(x?.changes.map((c) => [c.key, c.title])).toEqual([
      ["task:ta", "Task 1 · Build A"],
      ["task:tb", "Task 2 · Build B"],
    ]);
  });

  it("the session's index says which requests and tasks changed each file", () => {
    const r2 = request({
      id: "r10",
      parts: [
        part({ id: "c", title: "Fix X", files: [fileTouch("x.ts", 1, 1)] }),
      ],
    });
    const index = fileIndex(session({ requests: [r, r2] }));
    expect(index[0]?.path).toBe("x.ts");
    expect(index[0]?.requests).toEqual(["r9", "r10"]);
    expect(index[0]?.changes.map((c) => [c.n, c.added, c.removed])).toEqual([
      [1, 3, 1],
      [1, 2, 0],
      [2, 1, 1],
    ]);
    expect(
      index.find((f) => f.path === "z.md")?.changes[0]?.key,
    ).toBeUndefined();
  });
});

describe("what was asked and said", () => {
  it("you asked, verbatim, with the summary under it", () => {
    const r = request({
      id: "r",
      prompt: "yes please go ahead [Image #1]",
      goal: "Run the tests, then merge",
    });
    expect(youAsked(r)).toEqual({
      words: "yes please go ahead (image)",
      summary: "Run the tests, then merge",
    });
    expect(youAsked(request({ id: "r", prompt: "x", goal: "x" }))).toEqual({
      words: "x",
    });
  });

  it("the door has what Claude stopped on when it asked no question", () => {
    const r = request({
      id: "r",
      state: "waiting",
      messages: [
        {
          id: "m",
          ts: t(H),
          text: "The new look is on staging.\n\nMoving it to main is your call.",
        },
      ],
    });
    const view = session({
      requests: [r],
      needsYou: {
        reason: "idle",
        text: "Claude is waiting for your input",
        since: t(H),
      },
    });
    const w = waitingOn(view, r, []);
    expect(w?.questions).toEqual([]);
    expect(w?.said).toBe("Moving it to main is your call.");
    // The now line says it too, not its last narration of work under way.
    const line = nowLine(
      {
        ...r,
        now: { text: "The agent tests are running now", why: "", ts: t(0) },
      },
      [],
      false,
      w,
    );
    expect(line).toEqual({
      label: "Asked",
      text: "Moving it to main is your call.",
    });
  });

  it("a review whose verdict is fix first is not passed", () => {
    const v = verdictOf({
      status: "completed",
      summary: "",
      text: "My verdict is **fix first**: one Critical and nine Important findings.",
      ts: t(0),
      interim: false,
    });
    expect(v).toEqual({ label: "Fix first", tone: "bad" });
  });

  it("a done helper's summary is what it did, never that it is waiting", () => {
    const report = (text: string) => ({
      status: "completed",
      summary: 'Agent "X" is waiting on its own background work',
      text,
      ts: t(H),
      interim: true,
    });
    const waiting = agent({
      id: "a",
      report: report("I'll wait for the e2e run's completion notification."),
      lastText: "I'll wait for the e2e run's completion notification.",
    });
    expect(helperLine(waiting, false)).toBe(
      "Stopped while its own checks were still running; no final report came.",
    );
    const said = agent({
      id: "b",
      report: report(
        "The full run is still going.\n\nStatus: DONE\n\nThe library styles are in.",
      ),
    });
    expect(helperGist(said)).toBe("The library styles are in.");
    // A final report's lead is trusted as it is.
    const final = agent({
      id: "c",
      report: {
        ...report("Added a spinner while waiting for data."),
        interim: false,
      },
    });
    expect(helperGist(final)).toBe("Added a spinner while waiting for data.");
  });
});

describe("a session row's state", () => {
  const row = (
    min: number,
    r: Partial<Parameters<typeof rowState>[0]> = {},
  ) => ({
    ended: false,
    startedAt: "2026-11-01T00:00:00.000Z",
    lastEventAt: new Date(
      Date.parse("2026-11-01T12:00:00.000Z") - min * 60_000,
    ).toISOString(),
    ...r,
  });
  const NOW = Date.parse("2026-11-01T12:00:00.000Z");
  it("reads live, quiet and ended by the office's own 15 minutes", () => {
    expect(rowState(row(5), NOW)).toBe("live");
    // The lobby once said quiet after 2 minutes while the office still said live.
    expect(rowState(row(14), NOW)).toBe("live");
    expect(rowState(row(16), NOW)).toBe("quiet");
    expect(rowState(row(1, { ended: true }), NOW)).toBe("ended");
  });
  it("reads waiting on you when the row knows Claude is waiting", () => {
    const needsYou = {
      reason: "input",
      since: "2026-11-01T10:00:00.000Z",
    } as never;
    expect(rowState(row(120, { needsYou }), NOW)).toBe("waiting");
  });
});
