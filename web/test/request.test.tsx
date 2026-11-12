import { readFileSync } from "node:fs";
import type {
  AgentView,
  FileTouch,
  MessageView,
  PartView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live as Page, panel, roomInJsdom } from "./officeShell";

roomInJsdom();

import { clock } from "../src/story";
import { clockAt } from "./clock";

/** A request's own page: the newest request unless the test names one. */
function Live(p: React.ComponentProps<typeof Page>) {
  return <Page {...p} requestId={p.requestId ?? p.view?.requests.at(-1)?.id} />;
}

const at = (min: number) =>
  new Date(Date.UTC(2026, 10, 9, 15, min)).toISOString();
// The fixture's moment: live, not quiet, whatever day the tests run.
clockAt(at(20));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ decisions: [] }),
        }) as Response,
    ),
  );
  history.pushState(null, "", "/s/s1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function part(p: Partial<PartView> & { id: string; title: string }): PartView {
  return {
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
  };
}

const task = (
  id: string,
  title: string,
  status: TaskView["status"],
  t: Partial<TaskView> = {},
): TaskView => ({ id, title, status, agents: [], ...t });

function agent(id: string, a: Partial<AgentView> = {}): AgentView {
  return {
    id,
    type: "general-purpose",
    description: id,
    prompt: "",
    status: "done",
    startedAt: at(1),
    endedAt: at(5),
    ...a,
  };
}

const msg = (id: string, min: number, text: string, m = {}): MessageView => ({
  id,
  ts: at(min),
  text,
  ...m,
});

const file = (path: string, added: number, removed = 0): FileTouch => ({
  path,
  added,
  removed,
  isNew: false,
  eventIds: [],
});

/** Request 13 as the mock draws it: both plan phases done, work going on beyond the plan. */
type Over = { [K in keyof RequestView]?: RequestView[K] | undefined };
function running(r: Over = {}): RequestView {
  return {
    id: "r13",
    prompt: "restart the jobs and publish the tracker",
    startedAt: at(0),
    kind: "feature",
    kindInferred: false,
    goal: "Restart the two stopped Phase 3 jobs and publish a new live tracker",
    phases: [
      {
        id: "p1",
        title: "Restart stopped jobs",
        status: "done",
        tasks: [
          task("t1", "Fresh builder for Task 38", "done", { part: "capture" }),
          task("t2", "Fresh reviewer for Task 39", "done", { part: "parts" }),
        ],
      },
      {
        id: "p2",
        title: "New tracker",
        status: "done",
        tasks: [
          task("t3", "Found the source", "done", { part: "tracker" }),
          task("t4", "Published, 77 rows", "done", { part: "tracker" }),
        ],
      },
    ],
    planInferred: false,
    parts: [
      part({
        id: "capture",
        title: "Recorded chat answers",
        agents: ["a1"],
        files: [file("tests/contracts/appChatPage.test.js", 663, 70)],
      }),
      part({
        id: "parts",
        title: "Chat parts",
        agents: ["a2", "a3"],
        files: [
          file("components/chat/parts.jsx", 32, 26),
          file("src/styles/index.css", 47, 21),
          file("tests/_helpers/conversationViews.js", 146),
          file("components/chat/__tests__/parts.test.jsx", 114, 22),
          file("components/chat/more.jsx", 3, 1),
        ],
        checks: [
          { check: "3,612 frontend tests pass", status: "pass" },
          { check: "Light theme contrast", status: "fail" },
        ],
      }),
      part({
        id: "tracker",
        title: "Tracker",
        files: [file("scratchpad/tracker/lit-plate-build.html", 128)],
        checks: [{ check: "Task 38 recording", status: "untried" }],
      }),
    ],
    looseFiles: [],
    now: null,
    agents: [
      agent("a1", {
        description: "Build Task 38: capture chat reads",
        status: "running",
        startedAt: at(1),
        role: "build",
        subject: "Task 38",
        round: 1,
        part: "capture",
      }),
      agent("a2", {
        description: "Review Task 39 chat parts",
        startedAt: at(1),
        endedAt: at(7),
        role: "review",
        subject: "Task 39",
        round: 1,
        part: "parts",
        report: {
          status: "completed",
          summary: "",
          text: "Status: CHANGES_REQUESTED\n\nFour gaps.",
          verdict: "CHANGES_REQUESTED",
          ts: at(7),
          interim: false,
        },
      }),
      agent("a3", {
        description: "Re-review Task 39 fix round",
        startedAt: at(11),
        endedAt: at(15),
        role: "recheck",
        subject: "Task 39",
        round: 2,
        part: "parts",
      }),
    ],
    assumptions: [],
    flags: [],
    finished: false,
    tally: { helpers: 3, files: 7, commands: 198 },
    state: "running",
    outcome:
      "Both plan tasks are done: the two stopped Phase 3 jobs are running again.",
    beyond: { since: at(7), agents: ["a1", "a3"], messages: ["m4"], rounds: 1 },
    helperCounts: { build: 1, review: 1, recheck: 1, fix: 0, other: 0 },
    sentBack: ["Task 39"],
    messages: [
      msg("m1", 5, "The two stopped jobs are running again.", { phase: "p1" }),
      msg("m2", 5, "The new tracker is live.", { phase: "p2" }),
      msg("m3", 6, "Task 1 note: the builder is recording.", {
        phase: "p1",
        task: "t1",
      }),
      msg("m4", 17, "Task 39 is done after two rounds of fixes.", {
        task: "t2",
      }),
    ],
    ...r,
  } as RequestView;
}

function session(req: RequestView, s: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "s1",
    cwd: "/x/app",
    title: "app",
    startedAt: at(0),
    lastEventAt: at(17),
    ended: false,
    requests: [req],
    needsYou: null,
    ...s,
  };
}

function show(view: SessionView, lastLooked: string | null = null) {
  return render(
    <Live sessionId="s1" view={view} status="live" lastLooked={lastLooked} />,
  );
}

const region = (name: string) => screen.getByRole("region", { name });
const noRegion = (name: string) => screen.queryByRole("region", { name });

describe("the brief", () => {
  it("says where it stands: the outcome, then the helpers still running", () => {
    show(session(running()));
    const cell = region("Where it stands");
    expect(cell.querySelector(".rb-out")?.textContent).toBe(
      "Both plan tasks are done: the two stopped Phase 3 jobs are running again.",
    );
    expect(cell.querySelector(".rb-edge")?.textContent).toBe(
      "Still running: Build Task 38: capture chat reads.",
    );
  });

  it("once finished it says what came out of it, and what was left open", () => {
    const req = running({
      finished: true,
      state: "left-open",
      agents: [],
      beyond: undefined,
      phases: [
        {
          id: "p1",
          title: "Phase 1",
          status: "now",
          tasks: [
            task("t1", "Task 12: fast agent list", "now"),
            task("t2", "Bug B1: closed trades disagree", "todo"),
          ],
        },
      ],
    });
    show(session(req));
    expect(noRegion("Where it stands")).toBeNull();
    const cell = region("What came out of it");
    expect(cell.querySelector(".rb-edge")?.textContent).toBe(
      "Left open: Fast agent list and Closed trades disagree.",
    );
  });

  it("draws no where-it-stands cell with nothing to say", () => {
    show(
      session(
        running({
          outcome: undefined,
          agents: [],
          finished: true,
          beyond: undefined,
        }),
      ),
    );
    expect(noRegion("Where it stands")).toBeNull();
    expect(noRegion("What came out of it")).toBeNull();
  });

  it("lists key moments with time, mark and task; new ones are dotted and counted", () => {
    const req = running({
      messages: [
        msg("m1", 3, "Task 38 is done.", { phase: "p1", task: "t1" }),
        msg("m2", 8, "The review found four gaps in Task 39.", {
          phase: "p1",
          task: "t2",
        }),
      ],
    });
    show(session(req), at(6));
    const cell = region("Key moments");
    const rows = within(cell).getAllByRole("listitem");
    // The two messages and the plan being done, oldest first.
    expect(rows.map((r) => r.querySelector("time")?.textContent)).toEqual([
      clock(at(3)),
      clock(at(7)),
      clock(at(8)),
    ]);
    const first = rows[0] as HTMLElement;
    expect(first.textContent).toContain("Task 38 is done.");
    expect(first.querySelector(".mk.done")).toBeTruthy();
    expect(
      within(first).getByText("Done", { selector: ".sr-only" }),
    ).toBeTruthy();
    expect(within(first).getByText("Fresh builder for Task 38")).toBeTruthy();
    expect(first.className).not.toContain("new");
    expect(rows[1]?.querySelector(".mk.beyond")).toBeTruthy();
    const last = rows[2] as HTMLElement;
    expect(last.querySelector(".mk.failed")).toBeTruthy();
    expect(last.className).toContain("new");
    expect(cell.querySelector(".badge.new")?.textContent).toBe(
      `2 new since ${clock(at(6))}`,
    );
    expect(screen.queryByText(/Since you last looked/)).toBeNull();
  });

  it("has no new count on a first visit, and no moments cell with none", () => {
    show(session(running()));
    expect(region("Key moments").querySelector(".badge.new")).toBeNull();
    cleanup();
    show(session(running({ messages: [], beyond: undefined, agents: [] })));
    expect(noRegion("Key moments")).toBeNull();
  });

  it("gives the numbers: elapsed, helpers with running, files with lines, fix rounds", () => {
    show(session(running()));
    const cell = region("By the numbers");
    const figs = [...cell.querySelectorAll(".fig")].map((f) => f.textContent);
    expect(figs).toEqual([
      expect.stringMatching(/^[\dhmin ]+elapsed$/),
      "3helpers, 1 running",
      "7files, +1,133 −140",
      "1fix round on 1 task",
    ]);
    expect(cell.querySelector(".fig .v")?.className).toContain("num");
  });

  it("hides a number that is zero", () => {
    show(
      session(
        running({
          agents: [],
          parts: [],
          tally: { helpers: 0, files: 0, commands: 0 },
          sentBack: [],
          beyond: undefined,
        }),
      ),
    );
    const figs = [...region("By the numbers").querySelectorAll(".fig .l")].map(
      (f) => f.textContent,
    );
    expect(figs).toEqual(["elapsed"]);
  });

  it("an ask Claude ended its turn on says to reply, not only to answer", () => {
    show(
      session(running({ agents: [], beyond: undefined, state: "waiting" }), {
        needsYou: { reason: "input", text: "Sign in first", since: at(9) },
      }),
    );
    expect(
      region("Waiting on you").querySelector(".rb-where")?.textContent,
    ).toBe("Reply to Claude in the terminal");
  });

  it("asks in amber only when Claude waits on you, with where to answer", () => {
    show(session(running()));
    expect(noRegion("Waiting on you")).toBeNull();
    cleanup();
    show(
      session(running({ agents: [], beyond: undefined, state: "waiting" }), {
        needsYou: {
          reason: "question",
          text: "Claude has a question",
          since: at(9),
        },
      }),
    );
    const call = region("Waiting on you");
    expect(call.id).toBe("needs");
    expect(call.textContent).toContain("Claude has a question");
    expect(call.textContent).toContain("Answer in the terminal");
    expect(call.textContent).toContain(`since ${clock(at(9))}`);
    // While Claude waits, the clock stops at its last word.
    expect(region("By the numbers").querySelector(".fig")?.textContent).toBe(
      "17 minelapsed",
    );
    expect(
      region("Phase track").querySelector(".trk-foot")?.textContent,
    ).toContain("Elapsed: 17 m");
  });

  it("lists core's questions when the page reads none of its own", () => {
    show(
      session(
        running({
          agents: [],
          beyond: undefined,
          state: "waiting",
          waiting: ["Your look at Phase 2 on the preview?"],
        }),
        { needsYou: { reason: "idle", text: "", since: at(9) } },
      ),
    );
    const items = within(region("Waiting on you")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Your look at Phase 2 on the preview?",
    ]);
  });
});

describe("the phase track", () => {
  const track = () => region("Phase track");
  const segs = () => [...track().querySelectorAll(".trk-seg")];

  it("draws each phase as a segment and each task as a station that opens it", async () => {
    show(session(running()));
    expect(segs().map((s) => s.className)).toEqual([
      "trk-seg done",
      "trk-seg done",
      "trk-seg beyond",
    ]);
    const first = segs()[0] as HTMLElement;
    expect(first.querySelector(".trk-n")?.textContent).toBe(
      "Restart stopped jobs",
    );
    expect(first.querySelector(".trk-s")?.textContent).toContain("2 of 2 done");
    const link = within(first).getByRole("link", {
      name: "Fresh builder for Task 38, done",
    });
    expect(link.getAttribute("href")).toBe("/s/s1/r/r13?open=task:t1");
    await userEvent.click(link);
    expect(location.search).toBe("?open=task:t1");
  });

  it("marks done, live, todo and failed by shape and word", () => {
    const req = running({
      beyond: undefined,
      phases: [
        {
          id: "p1",
          title: "Build",
          status: "now",
          tasks: [
            task("t1", "One", "done"),
            task("t2", "Two", "now"),
            task("t3", "Three", "failed"),
            task("t4", "Four", "todo"),
          ],
        },
        {
          id: "p2",
          title: "Ship",
          status: "todo",
          tasks: [task("t5", "Five", "todo")],
        },
      ],
    });
    show(session(req));
    expect(segs().map((s) => s.className)).toEqual([
      "trk-seg now",
      "trk-seg todo",
    ]);
    const words = [...track().querySelectorAll(".st")].map(
      (s) => `${s.className}: ${s.querySelector(".sr-only")?.textContent}`,
    );
    expect(words).toEqual([
      "st done: , done",
      "st now: , running",
      "st failed: , failed",
      "st todo: , not started",
      "st todo: , not started",
    ]);
    // The live phase fills as far as its tasks are done.
    expect((segs()[0] as HTMLElement).style.getPropertyValue("--fill")).toBe(
      "0.25",
    );
  });

  it("names every station under its dot", () => {
    const req = running({
      beyond: undefined,
      phases: [
        {
          id: "p1",
          title: "Build",
          status: "now",
          tasks: ["A", "B", "C", "D", "E", "F", "G"].map((n, i) =>
            task(`t${i}`, n, i < 3 ? "done" : i === 3 ? "now" : "todo"),
          ),
        },
      ],
    });
    show(session(req));
    const caps = [...track().querySelectorAll(".st .cap")];
    expect(caps.map((c) => c.textContent)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
    expect(track().querySelectorAll(".st .cap.on")).toHaveLength(0);
  });

  it("adds a dashed Beyond the plan segment with its helpers, only when there is one", () => {
    show(session(running()));
    const beyond = segs()[2] as HTMLElement;
    expect(beyond.querySelector(".trk-n")?.textContent).toBe("Beyond the plan");
    expect(beyond.querySelector(".trk-s")?.textContent).toBe(
      `since ${clock(at(7))} · running`,
    );
    expect([...beyond.querySelectorAll(".st")].map((s) => s.className)).toEqual(
      ["st now", "st done"],
    );
    cleanup();
    show(session(running({ beyond: undefined })));
    expect(track().querySelector(".trk-seg.beyond")).toBeNull();
  });

  it("sums it up in a foot line, only the clauses that apply", () => {
    show(session(running()));
    expect(track().querySelector(".trk-foot")?.textContent).toMatch(
      /^Plan: 4 of 4 done; Still working: 1 helper running, 1 fix round after the plan; Elapsed: [\dhm ]+$/,
    );
    cleanup();
    const left = running({
      finished: true,
      state: "left-open",
      agents: [],
      beyond: undefined,
      phases: [
        {
          id: "p1",
          title: "Phase 1",
          status: "now",
          tasks: [task("t1", "One", "done"), task("t2", "Two", "now")],
        },
      ],
    });
    show(session(left, { lastEventAt: at(40) }));
    expect(track().querySelector(".trk-foot")?.textContent).toMatch(
      /^Plan: 1 of 2 done; Left open: 1 task; Took: /,
    );
    expect(segs().map((s) => s.className)).toEqual(["trk-seg open"]);
  });

  it("is not drawn for a request with no plan", () => {
    show(session(running({ phases: [], beyond: undefined })));
    expect(noRegion("Phase track")).toBeNull();
  });

  it("the new mark's dot is not the class markdown gives short code", () => {
    // Markdown marks a short code token `nw` (never wrap); a dot styled `.nw` once drew
    // every such token as a 6 px box, its letters stacked down the margin.
    const css = readFileSync("src/theme.css", "utf8");
    expect(css).not.toMatch(/(^|[\s,}])\.nw\s*[,{]/m);
    expect(css).toMatch(/code\.nw\s*{[^}]*white-space: nowrap/);
  });

  it("turns into a vertical list under 900 px, and draws once on first paint", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(max-width: 899px)",
      addEventListener() {},
      removeEventListener() {},
    }));
    show(session(running()));
    expect(track().className).toBe("trk stack");
    const css = readFileSync("src/theme.css", "utf8");
    const block = css.slice(css.indexOf("/* Request page (reshape) */"));
    expect(block).toMatch(
      /:where\(\.trk\.stack\) \.trk-segs\s*\{[^}]*flex-direction: column/,
    );
    expect(block).toMatch(/animation: trk-draw 900ms/);
    expect(block).toMatch(/prefers-reduced-motion/);
  });
});

describe("the story", () => {
  const story = () => region("What happened");
  const sections = () =>
    [...story().querySelectorAll(".st-phase")].map(
      (s) => s.querySelector("h2")?.textContent,
    );
  const texts = (s: Element) =>
    [...s.querySelectorAll(":scope > ol > li")].map(
      (li) =>
        li.querySelector(".story-text")?.textContent ??
        li.querySelector(".st-run-t")?.textContent ??
        li.querySelector(".st-now-b")?.textContent ??
        li.textContent,
    );

  it("groups messages under the phase core gives them, then Beyond the plan", () => {
    show(session(running()));
    expect(sections()).toEqual([
      "Restart stopped jobs",
      "New tracker",
      "Beyond the plan",
    ]);
    const [p1, p2, beyond] = [...story().querySelectorAll(".st-phase")];
    expect(texts(p1 as Element)).toEqual([
      "The two stopped jobs are running again.",
      "Task 1 note: the builder is recording.",
    ]);
    expect(texts(p2 as Element)).toEqual(["The new tracker is live."]);
    // The live section reads oldest first too, ending with a now row for helpers not
    // reported yet.
    const rows = texts(beyond as Element);
    expect(rows[0]).toBe("Task 39 is done after two rounds of fixes.");
    expect(rows[1]).toMatch(
      /^Build Task 38: capture chat reads, running for [\dhm ]+\. No report yet\.$/,
    );
  });

  it("a live phase reads oldest first, as a finished one does, its newest row marked", () => {
    const req = running({
      beyond: undefined,
      agents: [],
      phases: [
        {
          id: "p1",
          title: "One",
          status: "done",
          tasks: [task("t1", "A", "done")],
        },
        {
          id: "p2",
          title: "Two",
          status: "now",
          tasks: [task("t2", "B", "now")],
        },
      ],
      messages: [
        msg("m1", 1, "First.", { phase: "p1" }),
        msg("m2", 2, "Second.", { phase: "p1" }),
        msg("m3", 3, "Third.", { phase: "p2" }),
        msg("m4", 4, "Fourth.", { phase: "p2" }),
      ],
    });
    show(session(req));
    const [one, two] = [...story().querySelectorAll(".st-phase")];
    expect(texts(one as Element)).toEqual(["First.", "Second."]);
    expect(texts(two as Element)).toEqual(["Third.", "Fourth."]);
    expect(two?.querySelector("[data-newest]")?.textContent).toContain(
      "Fourth.",
    );
    cleanup();
    show(session({ ...req, finished: true, state: "done" }));
    const [, done] = [...story().querySelectorAll(".st-phase")];
    expect(texts(done as Element)).toEqual(["Third.", "Fourth."]);
  });

  it("folds a task's run of messages into one row that opens in place", async () => {
    const req = running({
      beyond: undefined,
      agents: [],
      finished: true,
      state: "done",
      phases: [
        {
          id: "p1",
          title: "Phase 0",
          status: "done",
          tasks: [task("t2", "Task 2: HeroMoney", "done", { part: "parts" })],
        },
      ],
      parts: [part({ id: "parts", title: "HeroMoney", agents: ["a2", "a3"] })],
      messages: [
        msg("m1", 1, "Starting.", { phase: "p1" }),
        msg("m2", 2, "Task 2 is being built.", { phase: "p1", task: "t2" }),
        msg("m3", 5, "Task 2 is in review.", { phase: "p1", task: "t2" }),
        msg("m4", 7, "Task 2 passed.", { phase: "p1", task: "t2" }),
        msg("m5", 8, "I decided to keep one builder, rather than two.", {
          phase: "p1",
          task: "t2",
        }),
      ],
    });
    req.agents = [agent("a2"), agent("a3")];
    show(session(req));
    const phase = story().querySelector(".st-phase") as HTMLElement;
    const rows = [...phase.querySelectorAll(":scope > ol > li")];
    expect(rows).toHaveLength(2);
    const run = rows[1] as HTMLElement;
    expect(run.className).toContain("st-run");
    const button = within(run).getByRole("button");
    expect(button.textContent).toBe(
      "Task 2 · HeroMoneybuilt, passed6 m · 2 helpers · 4 messages",
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(run.querySelectorAll(".story-text")).toHaveLength(0);
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // A decision about the task is part of its run.
    expect(
      [...run.querySelectorAll(".story-text")].map((t) => t.textContent),
    ).toEqual([
      "Task 2 is being built.",
      "Task 2 is in review.",
      "Task 2 passed.",
      "I decided to keep one builder, rather than two.",
    ]);
  });

  it("folds everything about one task, problems and fixes too; only messages about no task stand alone", () => {
    const req = running({
      beyond: undefined,
      agents: [agent("a1", { part: "money" }), agent("a2", { part: "money" })],
      finished: true,
      state: "done",
      phases: [
        {
          id: "p1",
          title: "Phase 0",
          status: "done",
          tasks: [
            task("t1", "Task 1: Lit plate tokens", "done"),
            task("t2", "Task 2: HeroMoney", "done", { part: "money" }),
            task("t4", "Task 4: Surfaces", "done"),
            task("t5", "Task 5: Controls", "done"),
          ],
        },
      ],
      parts: [part({ id: "money", title: "HeroMoney", agents: ["a1", "a2"] })],
      messages: [
        msg("m1", 1, "Approved, so I'm starting.", { phase: "p1" }),
        // Named in the text, not by core.
        msg("m2", 2, "Task 2 is being built.", { phase: "p1" }),
        // Interleaved: once the phase is over, Task 1's messages gather in one row.
        msg("x1", 3, "Task 1 is done.", { phase: "p1" }),
        msg("m3", 4, "Task 2 is built and in review.", { phase: "p1" }),
        // Tied by the helper whose report it follows.
        msg(
          "m4",
          5,
          "The review found one real problem: the decimal point was misaligned. I'm sending it back to the builder.",
          { phase: "p1", agent: "a2" },
        ),
        // About nothing named: it carries on the run before it.
        msg("m5", 6, "The fix is with the builder.", { phase: "p1" }),
        msg("m6", 7, "Task 2 is done after one fix round.", { phase: "p1" }),
        // Progress on the phase is not the phase finished.
        msg(
          "x3",
          7,
          "Two of four Phase 0 tasks are done, and the plate is finished.",
          {
            phase: "p1",
          },
        ),
        msg("m7", 8, "I added a task for the charts.", { phase: "p1" }),
        msg("x2", 8, "Task 1 passed its recheck.", { phase: "p1" }),
        msg("m8", 9, "Tasks 4 and 5 are being built as one batch.", {
          phase: "p1",
        }),
        msg("m9", 10, "Tasks 4 and 5 are done.", { phase: "p1" }),
        msg("m10", 11, "Phase 0 is finished: every task passed review.", {
          phase: "p1",
          agent: "a2",
        }),
      ],
    });
    show(session(req));
    const phase = story().querySelector(".st-phase") as HTMLElement;
    const rows = [...phase.querySelectorAll(":scope > ol > li")];
    expect(rows.map((r) => r.className.split(" ")[0])).toEqual([
      "st-msg",
      "st-run",
      "st-run",
      "st-msg",
      "st-run",
      "st-msg",
    ]);
    expect(rows.splice(2, 1)[0]?.querySelector(".st-run-t")?.textContent).toBe(
      "Task 1 · Lit plate tokens",
    );
    const money = rows[1] as HTMLElement;
    expect(money.querySelector(".st-run-t")?.textContent).toBe(
      "Task 2 · HeroMoney",
    );
    expect(money.querySelector(".st-run-r")?.textContent).toBe(
      "built, review found the decimal point was misaligned, fixed, passed",
    );
    expect(money.querySelector(".st-run-c")?.textContent).toBe(
      "5 m · 2 helpers · 6 messages",
    );
    expect(within(money).getByText("Problem found")).toBeTruthy();
    expect(rows[2]?.textContent).toContain("Plan changed");
    expect(rows[3]?.querySelector(".st-run-t")?.textContent).toBe(
      "Tasks 4 and 5 · Surfaces, Controls",
    );
    expect(rows[3]?.querySelector(".st-run-r")?.textContent).toBe(
      "built, passed",
    );
    expect(
      within(rows[3] as HTMLElement).queryByText("Problem found"),
    ).toBeNull();
    expect(rows[4]?.textContent).toContain("Phase 0 is finished");
  });

  it("keeps the newest task run open in the live section, and what the reader opened stays open", async () => {
    const base = running({
      beyond: undefined,
      agents: [],
      phases: [
        {
          id: "p1",
          title: "Build",
          status: "now",
          tasks: [
            task("t1", "Task 1: Tokens", "done"),
            task("t2", "Task 2: Money", "now"),
          ],
        },
      ],
      messages: [
        msg("m1", 1, "Task 1 is being built.", { phase: "p1" }),
        msg("m2", 2, "Task 1 is done.", { phase: "p1" }),
        msg("m3", 3, "Task 2 is being built.", { phase: "p1" }),
        msg("m4", 4, "Task 2 is in review.", { phase: "p1" }),
      ],
    });
    const { rerender } = show(session(base));
    const runsNow = () => [
      ...story().querySelectorAll<HTMLElement>(".st-phase .st-run"),
    ];
    const [older, newest] = runsNow();
    const toggle = (r?: HTMLElement) =>
      within(r as HTMLElement).getAllByRole("button")[0] as HTMLElement;
    expect(newest?.querySelector(".st-run-t")?.textContent).toBe(
      "Task 2 · Money",
    );
    expect(toggle(newest).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(older).getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle(older));
    const later = (extra: MessageView[]) =>
      rerender(
        <Live
          sessionId="s1"
          view={session({
            ...base,
            messages: [...(base.messages ?? []), ...extra],
          })}
          status="live"
          lastLooked={null}
        />,
      );
    // A message joins the open run: same row, still open, the older one still open.
    later([msg("m5", 5, "The review is still running.", { phase: "p1" })]);
    expect(runsNow().at(-1)).toBe(newest);
    expect(toggle(newest).getAttribute("aria-expanded")).toBe("true");
    expect(newest?.querySelectorAll(".story-text")).toHaveLength(3);
    expect(toggle(older).getAttribute("aria-expanded")).toBe("true");
    // A reader who closed the newest run keeps it closed as messages arrive.
    await userEvent.click(toggle(newest));
    later([
      msg("m5", 5, "The review is still running.", { phase: "p1" }),
      msg("m6", 6, "Task 2 passed.", { phase: "p1" }),
    ]);
    expect(runsNow().at(-1)).toBe(newest);
    expect(toggle(newest).getAttribute("aria-expanded")).toBe("false");
  });

  it("folds the newest run once the request is over, unless the reader opened it", () => {
    const phase = (status: "now" | "done") => [
      {
        id: "p1",
        title: "Build",
        status,
        tasks: [
          task("t1", "Task 1: Tokens", "done"),
          task("t2", "Task 2: Money", status),
        ],
      },
    ];
    const live = running({
      beyond: undefined,
      agents: [],
      phases: phase("now"),
      messages: [
        msg("m1", 1, "Task 1 is being built.", { phase: "p1" }),
        msg("m2", 2, "Task 1 is in review.", { phase: "p1" }),
      ],
    });
    const draw = (r: RequestView) =>
      rerender(
        <Live
          sessionId="s1"
          view={session(r)}
          status="live"
          lastLooked={null}
        />,
      );
    // The page draws partial views while a big session loads, so a finished request
    // can mount as live first.
    const { rerender } = show(session(live));
    const open = () =>
      [...story().querySelectorAll(".st-run-box")].map((b) =>
        b.getAttribute("aria-expanded"),
      );
    expect(open()).toEqual(["true"]);
    // A newer run opens on top; the one under it stays open while the phase is live.
    const more = {
      ...live,
      messages: [
        ...(live.messages ?? []),
        msg("m3", 3, "Task 2 is being built.", { phase: "p1" }),
        msg("m4", 4, "Task 2 is in review.", { phase: "p1" }),
      ],
    };
    draw(more);
    expect(open()).toEqual(["true", "true"]);
    draw({ ...more, finished: true, state: "done", phases: phase("done") });
    expect(open()).toEqual(["false", "false"]);
  });

  it("never shows Show more on a short message", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Line ${i}.`).join(
      "\n\n",
    );
    show(
      session(
        running({
          messages: [
            msg("m1", 1, "Five lines.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.", {
              phase: "p1",
            }),
            msg("m2", 2, long, { phase: "p2" }),
          ],
        }),
      ),
    );
    const [p1, p2] = [...story().querySelectorAll(".st-phase")];
    expect(within(p1 as HTMLElement).queryByText("Show more")).toBeNull();
    expect(within(p2 as HTMLElement).getByText("Show more")).toBeTruthy();
  });

  it("new messages enter once, and never move or rebuild what is already shown", () => {
    const req = running();
    const { rerender } = show(session(req));
    const before = story().querySelector(".st-phase li") as HTMLElement;
    expect(before.className).toContain("st-in");
    const more = running({
      messages: [
        ...(req.messages ?? []),
        msg("m5", 18, "Task 38 is recording.", {}),
      ],
      beyond: {
        ...(req.beyond as NonNullable<RequestView["beyond"]>),
        messages: ["m4", "m5"],
      },
    });
    rerender(
      <Live
        sessionId="s1"
        view={session(more)}
        status="live"
        lastLooked={null}
      />,
    );
    expect(story().querySelector(".st-phase li")).toBe(before);
  });
});

describe("helpers, files and checks", () => {
  const tab = (tab: "helpers" | "files", r: RequestView = running()) =>
    render(
      <Live
        sessionId="s1"
        view={session(r)}
        tab={tab}
        status="live"
        lastLooked={null}
      />,
    );

  it("the Helpers tab lists every helper, the running one marked, each opening its close-up", () => {
    tab("helpers");
    const rows = [...panel().getByRole("list", { name: "Helpers" }).children];
    expect(rows.map((r) => r.querySelector(".h-name")?.textContent)).toEqual([
      "Build Task 38: capture chat reads",
      "Review Task 39 chat parts",
      "Re-review Task 39 fix round",
    ]);
    expect(rows[0]?.querySelector(".mk.running")).toBeTruthy();
    expect(rows[1]?.textContent).toContain("Changes requested");
    expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe(
      "/s/s1/r/r13?open=helper:a1",
    );
  });

  it("the Files tab groups the files by the task that changed them", () => {
    tab("files");
    const groups = [...document.querySelectorAll(".file-group")];
    expect(groups.map((g) => g.querySelector("h2")?.textContent)).toEqual([
      "Recorded chat answers",
      "Chat parts",
      "Tracker",
    ]);
    expect(
      groups.map((g) => g.querySelector(".sect .num")?.textContent),
    ).toEqual(["1 file", "5 files", "1 file"]);
  });

  it("lists what was checked: pass, fail and untried", () => {
    show(session(running()));
    const rows = [...region("Checked").querySelectorAll("li")];
    expect(
      rows.map((r) => `${r.querySelector(".mk")?.className}|${r.textContent}`),
    ).toEqual([
      "mk done|3,612 frontend tests pass, passed",
      "mk failed|Light theme contrast, failed",
      "mk open|Task 38 recording, not yet checked",
    ]);
  });

  it("draws no card with nothing in it", () => {
    show(
      session(
        running({ agents: [], parts: [], looseFiles: [], beyond: undefined }),
      ),
    );
    expect(noRegion("Helpers")).toBeNull();
    expect(noRegion("Files")).toBeNull();
    expect(noRegion("Checked")).toBeNull();
  });
});
