import type {
  AgentView,
  MessageView,
  MurmurEvent,
  PartView,
  PhaseView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cutWords, list } from "../src/format";
import { Live } from "../src/pages/Session";
import { PartDetail } from "../src/part/PartDetail";
import type { Tab } from "../src/router";
import { questionsIn } from "../src/session";
import { clock } from "../src/story";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});
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
});

const at = (min: number) =>
  new Date(Date.UTC(2026, 10, 6, 9, min)).toISOString();

function part(p: Partial<PartView> & { id: string; title: string }): PartView {
  return {
    status: "todo",
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

function helper(id: string, a: Partial<AgentView> = {}): AgentView {
  return {
    id,
    type: "general-purpose",
    description: id,
    prompt: `Brief for ${id}`,
    status: "done",
    startedAt: at(10),
    ...a,
  };
}

const msg = (id: string, min: number, text: string, m = {}): MessageView => ({
  id,
  ts: at(min),
  text,
  ...m,
});

/** A made-up request: a garden-planner app, phase 1 done, phase 2 running. */
function request(r: Partial<RequestView> = {}): RequestView {
  return {
    id: "r2",
    prompt: "add watering reminders to the garden planner",
    startedAt: at(0),
    kind: "feature",
    kindInferred: false,
    goal: "Watering reminders for the garden planner",
    phases: [
      {
        id: "p1",
        title: "Phase 1: groundwork",
        status: "done",
        tasks: [
          task("t1", "Task 1: Reminder table", "done", { part: "table" }),
          task("t2", "Task 2: Schedule maths", "done", { part: "maths" }),
        ],
      },
      {
        id: "p2",
        title: "Phase 2: the screen",
        status: "now",
        tasks: [
          task("t3", "Task 3: Reminder list", "now", {
            part: "list",
            agents: ["a3"],
          }),
          task("t4", "Bug B1: times drift", "now", {
            part: "drift",
            agents: ["a4"],
          }),
          task("t5", "Task 5: Snooze button", "todo", { part: "snooze" }),
        ],
      },
    ],
    planInferred: false,
    parts: [
      part({
        id: "table",
        title: "Reminder table",
        phase: "p1",
        status: "done",
        agents: ["a1"],
      }),
      part({
        id: "maths",
        title: "Schedule maths",
        phase: "p1",
        status: "done",
        agents: ["a2"],
      }),
      part({
        id: "list",
        title: "Reminder list",
        phase: "p2",
        status: "now",
        agents: ["a3"],
      }),
      part({
        id: "drift",
        title: "Times drift",
        phase: "p2",
        status: "now",
        agents: ["a4"],
      }),
      part({ id: "snooze", title: "Snooze button", phase: "p2" }),
    ],
    looseFiles: [],
    now: {
      text: "Two builders are running their checks",
      why: "",
      ts: at(40),
    },
    agents: [
      helper("a1", {
        description: "Build Task 1",
        startedAt: at(2),
        endedAt: at(8),
      }),
      helper("a2", {
        description: "Build Task 2",
        startedAt: at(9),
        endedAt: at(14),
      }),
      helper("a3", {
        description: "Build Task 3",
        status: "running",
        startedAt: at(30),
      }),
      helper("a4", {
        description: "Fix bug B1",
        status: "running",
        startedAt: at(31),
      }),
    ],
    assumptions: [],
    flags: [],
    finished: false,
    tally: { helpers: 4, files: 6, commands: 20 },
    messages: [
      msg("m0", 1, "Starting with the table, then the maths."),
      msg("m1", 8, "Task 1 is done and checked.", { task: "t1" }),
      msg("m2", 14, "Task 2 is done.", { task: "t2" }),
      msg("m3", 32, "Both builders are on Phase 2 now.", { task: "t3" }),
    ],
    ...r,
  };
}

function session(req: RequestView, s: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "s1",
    cwd: "/x/garden",
    title: "garden",
    startedAt: at(0),
    lastEventAt: at(40),
    ended: false,
    requests: [
      {
        ...request({
          id: "r1",
          goal: "Fix the login form",
          kind: "bug",
          prompt: "login is broken",
          phases: [],
          parts: [],
          now: null,
          agents: [],
          finished: true,
          messages: [],
        }),
      },
      req,
    ],
    needsYou: null,
    ...s,
  };
}

const ev = (
  id: string,
  min: number,
  hook: MurmurEvent["hook"],
  payload: Record<string, unknown> = {},
): MurmurEvent => ({
  id,
  sessionId: "s1",
  machineId: "m",
  cwd: "/x/garden",
  ts: at(min),
  hook,
  payload,
});

const agentCall = (id: string, min: number, prompt: string, model: string) =>
  ev(id, min, "PreToolUse", {
    tool_name: "Agent",
    tool_input: { prompt, model, description: id },
  });

function show(
  view: SessionView,
  p: {
    events?: MurmurEvent[];
    lastLooked?: string | null;
    requestId?: string;
    partId?: string;
    tab?: Tab;
  } = {},
) {
  return render(
    <Live
      sessionId="s1"
      {...(p.requestId ? { requestId: p.requestId } : {})}
      {...(p.partId ? { partId: p.partId } : {})}
      {...(p.tab ? { tab: p.tab } : {})}
      view={view}
      events={p.events ?? []}
      status="live"
      lastLooked={p.lastLooked ?? null}
    />,
  );
}

const bar = () => screen.getByRole("banner");

describe("top bar", () => {
  it("while running: Running, the now line, and the phase track under the brief", () => {
    show(session(request()));
    const b = within(bar());
    expect(b.getByText("Running")).toBeTruthy();
    expect(
      within(b.getByRole("region", { name: "Now" })).getByText(
        "Two builders are running their checks",
      ),
    ).toBeTruthy();
    const track = screen.getByRole("region", { name: "Phase track" });
    expect(
      [...track.querySelectorAll(".trk-seg")].map((s) => s.className),
    ).toEqual(["trk-seg done", "trk-seg now"]);
    expect([...track.querySelectorAll(".st")].map((s) => s.className)).toEqual([
      "st done",
      "st done",
      "st now",
      "st now",
      "st todo",
    ]);
    // No amber chip while nobody waits on you.
    expect(b.queryByText(/waiting on you/)).toBeNull();
  });

  it("once done: Done and what the request did in all", () => {
    const done = request({
      finished: true,
      planInferred: true,
      now: { text: "Editing notes.md", why: "", ts: at(40), inferred: true },
      agents: request().agents.map((a) => ({ ...a, status: "done" as const })),
    });
    show(session(done));
    const b = within(bar());
    expect(b.getByText("Done")).toBeTruthy();
    expect(b.queryByText("Running")).toBeNull();
    const now = b.getByRole("region", { name: "Now" });
    expect(now.textContent).toContain(
      "4 helpers, 6 files changed, 20 commands run",
    );
    expect(now.textContent).not.toContain("Editing notes.md");
  });

  it("waiting on a question: the amber chip counts the questions and the wait", () => {
    vi.useFakeTimers({ now: new Date(at(61)), toFake: ["Date"] });
    const ask = ev("q1", 40, "PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: {
        questions: [
          {
            question: "Remind in the morning or the evening?",
            header: "Time",
            options: [{ label: "Morning" }, { label: "Evening" }],
          },
          {
            question: "Keep the old snooze length?",
            header: "Snooze",
            options: [{ label: "Yes" }, { label: "No" }],
          },
        ],
      },
    });
    show(session(request()), { events: [ask] });
    const chip = within(bar()).getByRole("link", { name: /waiting on you/ });
    expect(chip.textContent).toContain("2 waiting on you");
    expect(chip.textContent).toContain("21 m");
    expect(chip.className).toContain("need");
  });

  it("a question already answered raises no chip", () => {
    const ask = ev("q1", 40, "PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: { questions: [{ question: "Morning or evening?" }] },
    });
    const answer = ev("q2", 41, "PostToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
    });
    show(session(request()), { events: [ask, answer] });
    expect(within(bar()).queryByText(/waiting on you/)).toBeNull();
  });
});

describe("now line", () => {
  const bash = (input: Record<string, unknown>) =>
    ev("b1", 40, "PreToolUse", { tool_name: "Bash", tool_input: input });
  const inferred = {
    text: "Running cd /x/garden && pnpm vitest run src/remind",
    why: "",
    ts: at(40),
    inferred: true,
  };

  it("a running command shows its description", () => {
    show(session(request({ now: inferred })), {
      events: [bash({ command: "pnpm vitest", description: "Run the tests" })],
    });
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(within(now).getByText("Run the tests")).toBeTruthy();
    expect(now.textContent).not.toContain("pnpm");
  });

  it("a command with no description reads Running a command, the command one click away", async () => {
    show(session(request({ now: inferred })), {
      events: [bash({ command: "cd /x/garden && pnpm vitest run src/remind" })],
    });
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(within(now).getByText("Running a command")).toBeTruthy();
    expect(now.textContent).not.toContain("pnpm");
    await userEvent.click(within(now).getByRole("button", { name: "Details" }));
    expect(
      screen.getByText("cd /x/garden && pnpm vitest run src/remind"),
    ).toBeTruthy();
  });

  it("never shows a raw command even when its event is not loaded", () => {
    show(session(request({ now: inferred })));
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(now.textContent).toContain("Running a command");
    expect(now.textContent).not.toContain("pnpm");
  });

  it("Claude's narrated now wins over the command", () => {
    show(session(request()), {
      events: [bash({ command: "pnpm vitest", description: "Run the tests" })],
    });
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(now.textContent).toContain("Two builders are running their checks");
  });
});

describe("requests in the rail", () => {
  it("names the request's place and switches to another", async () => {
    show(session(request()));
    expect(document.querySelector(".over")?.textContent).toContain(
      "Request 2 of 2",
    );
    const rail = screen.getByRole("navigation", { name: "Requests" });
    const items = within(rail).getAllByRole("link");
    // Oldest first, the shown one marked.
    expect(items[0]?.getAttribute("title")).toBe("Fix the login form");
    expect(items[1]?.getAttribute("title")).toBe(
      "Watering reminders for the garden planner",
    );
    expect(items[1]?.className).toContain("cur");
    await userEvent.click(items[0] as HTMLElement);
    expect(location.pathname).toBe("/s/s1/r/r1");
  });
});

describe("phase track", () => {
  const track = () => screen.getByRole("region", { name: "Phase track" });
  const segs = () => [...track().querySelectorAll(".trk-seg")] as HTMLElement[];

  it("lists phases with their done counts and short task names", () => {
    show(session(request()));
    expect(segs().map((p) => p.className)).toEqual([
      "trk-seg done",
      "trk-seg now",
    ]);
    const [first, second] = segs();
    expect(first?.querySelector(".trk-s")?.textContent).toBe(
      `2 of 2 done · ${clock(at(2))} to ${clock(at(14))}`,
    );
    expect(second?.querySelector(".trk-s")?.textContent).toBe(
      `0 of 3 done · started ${clock(at(30))}`,
    );
    // "Task 1:" and "Bug B1:" are dropped, the task's own words kept.
    expect(
      within(first as HTMLElement).getByText("Reminder table"),
    ).toBeTruthy();
    expect(within(second as HTMLElement).getByText("Times drift")).toBeTruthy();
  });

  it("only the live phase's tasks read as in progress", () => {
    show(session(request()));
    const live = [...track().querySelectorAll(".st.now")];
    expect(live).toHaveLength(2);
    expect(
      live.every((s) => s.closest(".trk-seg")?.className === "trk-seg now"),
    ).toBe(true);
  });

  it("shows the running helpers in the side with their model and time", () => {
    vi.useFakeTimers({ now: new Date(at(51)), toFake: ["Date"] });
    show(session(request()), {
      events: [
        agentCall("c3", 30, "Brief for a3", "opus"),
        agentCall("c4", 31, "Brief for a4", "sonnet"),
      ],
    });
    const helpers = screen.getByRole("region", { name: "Helpers" });
    const running = [...helpers.querySelectorAll(".hl-row")].filter((r) =>
      r.querySelector(".mk.running"),
    );
    expect(running.map((r) => r.querySelector(".hl-s")?.textContent)).toEqual([
      "Opus · running 21 m · no report yet",
      "Sonnet · running 20 m · no report yet",
    ]);
  });

  it("a finished request has no live phase; unfinished work reads as left open", () => {
    show(
      session(
        request({
          finished: true,
          agents: request().agents.map((a) => ({
            ...a,
            status: "done" as const,
          })),
        }),
      ),
    );
    expect(track().querySelector(".st.now")).toBeNull();
    expect(segs()[1]?.className).toBe("trk-seg open");
    expect(segs()[1]?.querySelector(".trk-s")?.textContent).toContain(
      "left open",
    );
    expect(
      screen
        .getByRole("region", { name: "Helpers" })
        .querySelector(".mk.running"),
    ).toBeNull();
  });

  it("with two phases running, the live one is where the work is", () => {
    const req = request();
    const [p1, p2] = req.phases as [PhaseView, PhaseView];
    // Phase 1 was never marked done, but the work moved on to phase 2.
    show(session({ ...req, phases: [{ ...p1, status: "now" }, p2] }));
    const live = [...track().querySelectorAll(".st.now")];
    expect(
      live.map(
        (s) => s.closest(".trk-seg")?.querySelector(".trk-n")?.textContent,
      ),
    ).toEqual(["Phase 2: the screen", "Phase 2: the screen"]);
  });

  it("once Claude stopped, nothing on the track reads as running", () => {
    const req = request({
      agents: request().agents.map((a) => ({ ...a, status: "done" as const })),
    });
    show(session(req), { events: [ev("s", 45, "Stop")] });
    expect(within(bar()).getByText("Done")).toBeTruthy();
    expect(track().querySelector(".st.now")).toBeNull();
    expect(track().querySelector(".trk-seg.open .trk-s")?.textContent).toBe(
      "0 of 3 done · left open",
    );
    expect(track().querySelector(".trk-foot")?.textContent).toContain("Took:");
  });

  it("a station opens its task's page, and the breadcrumb marks it there", async () => {
    show(session(request()));
    await userEvent.click(
      within(track()).getByRole("link", { name: /Schedule maths/ }),
    );
    expect(location.pathname).toBe("/s/s1/r/r2/p/maths");
    cleanup();
    show(session(request()), { requestId: "r2", partId: "maths" });
    const here = within(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    ).getByText(/Schedule maths/);
    expect(here.getAttribute("aria-current")).toBe("page");
  });
});

describe("new since you last looked, inside the brief", () => {
  it("marks the key moments after the last look, and counts them", () => {
    show(
      session(
        request({
          messages: [
            ...(request().messages ?? []),
            msg(
              "m4",
              33,
              "The review found two problems in the reminder list.",
              {
                task: "t3",
              },
            ),
          ],
        }),
      ),
      { lastLooked: at(10) },
    );
    const moments = screen.getByRole("region", { name: "Key moments" });
    expect(
      [...moments.querySelectorAll(".km-row")].map((r) => [
        r.querySelector("time")?.textContent,
        r.className,
      ]),
    ).toEqual([
      [clock(at(8)), "km-row"],
      [clock(at(14)), "km-row new"],
      [clock(at(33)), "km-row new"],
    ]);
    expect(moments.querySelector(".badge.new")?.textContent).toBe(
      `2 new since ${clock(at(10))}`,
    );
    expect(
      screen.queryByRole("region", { name: "Since you last looked" }),
    ).toBeNull();
  });

  it("marks nothing new on a first visit", () => {
    show(session(request()), { lastLooked: null });
    const moments = screen.getByRole("region", { name: "Key moments" });
    expect(moments.querySelector(".new")).toBeNull();
  });
});

describe("waiting on you", () => {
  it("lists an AskUserQuestion call's questions, the wait, and where to answer", () => {
    vi.useFakeTimers({ now: new Date(at(52)), toFake: ["Date"] });
    const ask = ev("q1", 40, "PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: {
        questions: [
          {
            question: "Remind in the morning or the evening?",
            options: [{ label: "Morning" }, { label: "Evening" }],
          },
        ],
      },
    });
    show(session(request()), { events: [ask] });
    const call = screen.getByRole("region", { name: "Waiting on you" });
    expect(call.textContent).toContain("Remind in the morning or the evening?");
    expect(call.textContent).toContain("Morning or Evening");
    expect(call.textContent).toContain(`since ${clock(at(40))}, 12 m`);
    expect(call.textContent).toContain("Answer in the terminal");
  });

  it("else takes the questions from Claude's last message once it stopped", () => {
    const req = request({
      agents: request().agents.map((a) => ({ ...a, status: "done" as const })),
      messages: [
        ...(request().messages ?? []),
        msg(
          "m9",
          45,
          "Phase 2 is built. Should I default snooze to ten minutes? And may I drop the old list view?",
        ),
      ],
    });
    show(session(req), { events: [ev("s", 45, "Stop")] });
    const call = screen.getByRole("region", { name: "Waiting on you" });
    expect([...call.querySelectorAll("li")].map((q) => q.textContent)).toEqual([
      "Should I default snooze to ten minutes?",
      "And may I drop the old list view?",
    ]);
    expect(within(bar()).getByText("Waiting")).toBeTruthy();
    expect(
      within(bar()).getByRole("link", { name: /waiting on you/ }).textContent,
    ).toContain("2 waiting on you");
  });

  it("is not drawn when Claude waits on no one", () => {
    show(session(request()));
    expect(screen.queryByRole("region", { name: "Waiting on you" })).toBeNull();
  });
});

describe("story by phase", () => {
  const story = () => screen.getByRole("region", { name: "What happened" });

  it("groups Claude's words under their phase, in plan order: the live one newest first", () => {
    show(session(request()));
    const groups = [...story().querySelectorAll(".st-phase")] as HTMLElement[];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Phase 1: groundwork",
      "Phase 2: the screen",
    ]);
    const [done, live] = groups;
    expect(live?.querySelector(".st-meta")?.textContent).toContain(
      "newest first",
    );
    const texts = (g: HTMLElement) =>
      [...g.querySelectorAll(".story-text")].map((t) => t.textContent);
    expect(texts(live as HTMLElement)).toEqual([
      "Both builders are on Phase 2 now.",
    ]);
    // A message about no task stays with the phase it was written in.
    expect(texts(done as HTMLElement)).toEqual([
      "Starting with the table, then the maths.",
      "Task 1 is done and checked.",
      "Task 2 is done.",
    ]);
  });

  it("the map is one tab away", async () => {
    show(session(request()));
    expect(screen.queryByRole("region", { name: "Flow" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Flow" }));
    expect(location.pathname).toBe("/s/s1/r/r2/flow");
    cleanup();
    show(session(request()), { requestId: "r2", tab: "flow" });
    expect(screen.getByRole("region", { name: "Flow" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What happened" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Story" }));
    expect(location.pathname).toBe("/s/s1/r/r2");
  });
});

/** Task 3 of a made-up request: built, sent back by review, fixed, passed. */
function task3() {
  const events = [
    agentCall("c1", 10, "Brief for b1", "sonnet"),
    ev("s1", 10, "SubagentStart", { agent_id: "b1" }),
    ev("n1", 14, "UserPromptSubmit", {
      prompt:
        "<task-notification>\n<task-id>b1</task-id>\n</task-notification>",
    }),
    agentCall("c2", 15, "Brief for b2", "opus"),
    ev("s2", 15, "SubagentStart", { agent_id: "b2" }),
    ev("x2", 17, "SubagentStop", { agent_id: "b2" }),
    ev("m1", 18, "PreToolUse", {
      tool_name: "SendMessage",
      tool_input: { to: "b1", message: "Fix the findings." },
    }),
    ev("x1", 20, "SubagentStop", { agent_id: "b1" }),
    agentCall("c3", 21, "Brief for b3", "sonnet"),
    ev("s3", 21, "SubagentStart", { agent_id: "b3" }),
    ev("x3", 22, "SubagentStop", { agent_id: "b3" }),
  ];
  const agents = [
    helper("b1", {
      description: "Implement Task 3: reminder list",
      startedAt: at(10),
      endedAt: at(20),
      report: {
        status: "completed",
        summary: "",
        text: "Status: DONE\nCommit: 4be81c0aa\n\nBuilt the list.",
        verdict: "DONE",
        ts: at(20),
        interim: false,
      },
    }),
    helper("b2", {
      description: "Review Task 3",
      startedAt: at(15),
      endedAt: at(17),
      report: {
        status: "completed",
        summary: "",
        text: "Issues found: the list forgets the time zone.",
        ts: at(17),
        interim: false,
      },
    }),
    helper("b3", {
      description: "Re-review Task 3 fix round 1",
      startedAt: at(21),
      endedAt: at(22),
      report: {
        status: "completed",
        summary: "",
        text: "All findings fixed.",
        ts: at(22),
        interim: false,
      },
    }),
  ];
  const p = part({
    id: "list",
    title: "Reminder list",
    phase: "p2",
    status: "done",
    agents: ["b1", "b2", "b3"],
    aim: { aim: "Show the coming reminders", doneWhen: "the list test passes" },
    files: [
      {
        path: "src/remind/List.tsx",
        role: "Draws the list",
        added: 40,
        removed: 2,
        isNew: true,
        eventIds: [],
      },
      {
        path: "src/remind/list.css",
        role: "Draws the list",
        added: 12,
        removed: 0,
        isNew: true,
        eventIds: [],
      },
      {
        path: "src/remind/List.test.tsx",
        role: "Tests the list",
        added: 30,
        removed: 0,
        isNew: true,
        eventIds: [],
      },
      {
        path: "src/app.tsx",
        added: 1,
        removed: 1,
        isNew: false,
        eventIds: [],
      },
    ],
  });
  const r = request({
    agents,
    parts: request().parts.map((x) => (x.id === "list" ? p : x)),
    messages: [
      msg(
        "m1",
        23,
        "Task 3 is done after one fix. I ran the list test myself.",
        {
          task: "t3",
        },
      ),
    ],
  });
  return { p, r, events };
}

describe("task page", () => {
  const showTask = (t = task3()) =>
    render(<PartDetail request={t.r} part={t.p} events={t.events} />);
  const timeline = () => screen.getByRole("list", { name: "Timeline" });

  it("titles the task with its outcome", () => {
    showTask();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("Reminder list");
    expect(screen.getByText("Done after one fix round")).toBeTruthy();
    const where = screen.getByRole("group", { name: "Where it sits" });
    expect(where.textContent).toContain("Phase 2: the screen");
    expect(where.textContent).toMatch(/^Task \d+ of \d+/);
  });

  it("draws one lane per helper and one for Claude, on a shared time axis", () => {
    showTask();
    const lanes = within(timeline()).getAllByRole("listitem");
    expect(
      lanes.map((l) => l.querySelector(".lane-name")?.textContent),
    ).toEqual([
      "BuilderAgent 1 · Sonnet",
      "ReviewerAgent 2 · Opus",
      "RecheckAgent 3 · Sonnet",
      "Claude1 message",
    ]);
    const ticks = [...document.querySelectorAll(".axis span")].map(
      (s) => s.textContent,
    );
    expect(ticks[0]).toBe(clock(at(10)));
  });

  it("each run is a labelled bar coloured by its result", () => {
    showTask();
    const bars = (k: number) =>
      [
        ...((
          within(timeline()).getAllByRole("listitem")[k] as HTMLElement
        ).querySelectorAll(".run") ?? []),
      ].map((b) => [b.textContent, b.className]);
    // The builder's first run, then its fix after the review sent it back.
    expect(bars(0)).toEqual([
      ["Built", "run plain"],
      ["Fixed", "run plain"],
    ]);
    expect(bars(1)).toEqual([["Sent back", "run bad"]]);
    // A one-minute recheck is too short for its word: it sits after the bar.
    expect(bars(2)).toEqual([["Passed", "run good out"]]);
    // Bars sit on the axis by time: the axis runs 09:10 to 09:24 in 2 minute ticks.
    const review = within(timeline())
      .getAllByRole("listitem")[1]
      ?.querySelector(".run") as HTMLElement;
    expect(review.style.left).toBe("35.7143%");
  });

  it("the numbered steps below carry the same verdict on their number", () => {
    showTask();
    const marks = [...document.querySelectorAll(".step-card .sdot")].map((d) =>
      d.getAttribute("data-tone"),
    );
    expect(marks).toEqual(["done", "bad", "done"]);
    expect(
      [...document.querySelectorAll(".step-card .step-title")].map(
        (t) => t.textContent,
      ),
    ).toEqual([
      "Built by Agent 1",
      "Reviewed by Agent 2",
      "Rechecked by Agent 3",
    ]);
  });

  it("Claude's lane carries its message about the task as a dot", () => {
    showTask();
    const claude = within(timeline()).getAllByRole(
      "listitem",
    )[3] as HTMLElement;
    const dot = claude.querySelector(".cdot") as HTMLElement;
    expect(dot.getAttribute("aria-label")).toContain(
      "Task 3 is done after one fix.",
    );
    expect(dot.className).toBe("cdot good");
  });

  it("groups files by what they do, tests on their own", () => {
    showTask();
    const files = screen.getByRole("region", {
      name: "Files, by what they do",
    });
    const cards = [...files.querySelectorAll(".fcard")];
    expect(cards.map((c) => c.querySelector("h3")?.textContent)).toEqual([
      "Draws the list",
      "Tests",
      "Other files",
    ]);
    expect(cards[0]?.textContent).toContain("List.tsx");
    expect(cards[0]?.textContent).toContain("list.css");
    expect(cards[1]?.textContent).toContain("List.test.tsx");
    // The folder every file shares is said once, not on every row.
    expect(files.textContent).toContain("in src");
    expect(within(files).getByText("remind/List.tsx")).toBeTruthy();
  });

  it("has no timeline when no helper worked on it", () => {
    const t = task3();
    t.p.agents = [];
    showTask(t);
    expect(screen.queryByRole("list", { name: "Timeline" })).toBeNull();
  });
});

describe("review fixes: questions", () => {
  it("a question mark inside code or a link is no question", () => {
    expect(
      questionsIn(
        "Done, all 9 tests pass. I used `opts?.locale` for the optional locale, and the docs are at https://example.com/docs?page=slugify.",
      ),
    ).toEqual([]);
    expect(
      questionsIn("Here it is:\n\n```js\nconst a = b?.c;\n```\n\nAll done."),
    ).toEqual([]);
    expect(questionsIn("See [the docs](https://x.dev/?q=1) for more.")).toEqual(
      [],
    );
  });

  it("a heading ends a sentence, a version number does not, and an either-or is one question", () => {
    expect(
      questionsIn(
        "All 9 tests pass.\n\n## What I need from you\nShould I bump the version to v1.2? Or keep 1.1 until the docs land?",
      ),
    ).toEqual([
      "Should I bump the version to v1.2? Or keep 1.1 until the docs land?",
    ]);
  });

  it("a question Claude answers itself, or asks of no one, is not for you", () => {
    expect(
      questionsIn("Why did it fail? The cache was stale, so I cleared it."),
    ).toEqual([]);
    expect(questionsIn("Is the cache stale? Does the build pass?")).toEqual([]);
  });

  it("only the last paragraph or a trailing list counts", () => {
    expect(
      questionsIn("Should I keep going?\n\nI kept going and it all passes."),
    ).toEqual([]);
    expect(
      questionsIn(
        "Two things for you:\n\n- Should I drop the old view?\n- Do you want snooze at ten minutes?",
      ),
    ).toEqual([
      "Should I drop the old view?",
      "Do you want snooze at ten minutes?",
    ]);
  });

  it("a message with a URL and code raises no amber on the page", () => {
    const req = request({
      agents: request().agents.map((a) => ({ ...a, status: "done" as const })),
      messages: [
        ...(request().messages ?? []),
        msg(
          "m9",
          45,
          "Done. I used `opts?.locale`, and the docs are at https://example.com/docs?page=a.",
        ),
      ],
    });
    show(session(req), { events: [ev("s", 45, "Stop")] });
    expect(within(bar()).getByText("Done")).toBeTruthy();
    expect(within(bar()).queryByText(/waiting on you/)).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Needs your call" }),
    ).toBeNull();
  });
});

describe("review fixes: words", () => {
  it("a text with no spaces is cut at its length, not to one letter", () => {
    expect(cutWords("x".repeat(30), 10)).toBe(`${"x".repeat(10)}…`);
    expect(cutWords("Read the prototypes today", 15)).toBe("Read the…");
  });

  it("names that hold an 'and' are listed with semicolons", () => {
    expect(list(["Read the prototypes and the page", "Build it"])).toBe(
      "Read the prototypes and the page; Build it",
    );
    expect(list(["A", "B", "C"])).toBe("A, B and C");
  });

  it("work sent back is a fixing moment, in grey not amber", () => {
    show(
      session(
        request({
          messages: [
            ...(request().messages ?? []),
            msg("m5", 33, "Sending it back to the builder with two fixes."),
          ],
        }),
      ),
    );
    const moments = screen.getByRole("region", { name: "Key moments" });
    const row = [...moments.querySelectorAll(".km-row")].at(-1) as HTMLElement;
    expect(row.textContent).toContain("Fixing");
    expect(row.querySelector(".mk.fix")).toBeTruthy();
  });

  it("a finished request never says helpers are still running", () => {
    show(
      session(
        request({
          finished: true,
          planInferred: true,
          now: { text: "Editing a.ts", why: "", ts: at(40), inferred: true },
        }),
      ),
    );
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(now.textContent).not.toContain("still running");
  });

  it("an open AskUserQuestion reads as asking you, not as a tool name", () => {
    const ask = ev("q1", 40, "PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: { questions: [{ question: "A?" }, { question: "B?" }] },
    });
    show(
      session(
        request({
          now: {
            text: "Using AskUserQuestion",
            why: "",
            ts: at(40),
            inferred: true,
          },
        }),
      ),
      { events: [ask] },
    );
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(now.textContent).toContain("Asking you 2 questions");
    expect(now.textContent).not.toContain("AskUserQuestion");
  });

  it("the now details close on Escape and on a click outside", async () => {
    show(
      session(
        request({
          now: {
            text: "Two builders are running their checks",
            why: "it is next",
            ts: at(40),
          },
        }),
      ),
    );
    const now = within(bar()).getByRole("region", { name: "Now" });
    const details = within(now).getByRole("button", { name: "Details" });
    await userEvent.click(details);
    expect(within(now).getByText(/Why now/)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(within(now).queryByText(/Why now/)).toBeNull();
    await userEvent.click(details);
    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    expect(within(now).queryByText(/Why now/)).toBeNull();
  });

  it("where to answer is a plain note, not a button that does nothing", () => {
    const ask = ev("q1", 40, "PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: { questions: [{ question: "Morning or evening?" }] },
    });
    show(session(request()), { events: [ask] });
    const call = screen.getByRole("region", { name: "Waiting on you" });
    expect(within(call).queryByRole("button")).toBeNull();
    expect(call.querySelector(".rb-where")?.textContent).toBe(
      "Answer in the terminal",
    );
  });
});

describe("review fixes: stillness and order", () => {
  const live = (
    r: RequestView,
    status: "live" | "reconnecting",
    events: MurmurEvent[] = [],
  ) => (
    <Live
      sessionId="s1"
      view={session(r)}
      events={events}
      status={status}
      lastLooked={at(10)}
    />
  );

  it("the key moments survive a reconnect unchanged", () => {
    const moments = () =>
      screen.getByRole("region", { name: "Key moments" }).textContent;
    const { rerender } = render(live(request(), "live"));
    const first = moments();
    rerender(live(request(), "reconnecting"));
    expect(moments()).toBe(first);
  });

  it("the wait goes once the question is answered", () => {
    const ask = ev("q1", 40, "PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
      tool_input: { questions: [{ question: "Morning or evening?" }] },
    });
    const answer = ev("q2", 41, "PostToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_q",
    });
    const { rerender } = render(live(request(), "live", [ask]));
    expect(screen.getByRole("region", { name: "Waiting on you" })).toBeTruthy();
    rerender(live(request(), "live", [ask, answer]));
    expect(screen.queryByRole("region", { name: "Waiting on you" })).toBeNull();
  });

  it("a helper starting or ending never changes the track's stations", () => {
    const stations = () =>
      [...document.querySelectorAll(".trk-st > li")].map((li) => li.className);
    const agents = (running: boolean) =>
      request().agents.map((a) =>
        a.id === "a3" ? { ...a, status: running ? "running" : "done" } : a,
      ) as AgentView[];
    const { rerender } = render(
      live(request({ agents: agents(true) }), "live"),
    );
    const busy = stations();
    expect(busy).toHaveLength(5);
    rerender(live(request({ agents: agents(false) }), "live"));
    expect(stations()).toEqual(busy);
  });

  it("a second helper on a task gets its own short line in the side", () => {
    vi.useFakeTimers({ now: new Date(at(30)), toFake: ["Date"] });
    const agents = [
      ...request().agents,
      helper("a5", { status: "running", startedAt: at(30), part: "list" }),
    ];
    const r = request({ agents });
    r.parts = r.parts.map((p) =>
      p.id === "list" ? { ...p, agents: [...p.agents, "a5"] } : p,
    );
    render(live(r, "live"));
    const rows = [
      ...screen
        .getByRole("region", { name: "Helpers" })
        .querySelectorAll(".hl-row"),
    ];
    const a5 = rows.find(
      (r) => r.querySelector(".hl-n")?.textContent === "a5",
    ) as HTMLElement;
    expect(a5.querySelector(".hl-s")?.textContent).toBe(
      "running under a minute · no report yet",
    );
  });

  it("the first stop on the page skips to the content", () => {
    show(session(request({ messages: [msg("m1", 1, "Starting.")] })));
    const skip = screen.getAllByRole("link")[0] as HTMLElement;
    expect(skip.textContent).toBe("Skip to the content");
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")?.tagName).toBe("MAIN");
    expect(screen.queryByRole("link", { name: "Skip to the plan" })).toBeNull();
  });

  it("a request Claude stopped on reads oldest first, though not finished", () => {
    const req = request({
      agents: request().agents.map((a) => ({ ...a, status: "done" as const })),
    });
    show(session(req), { events: [ev("s", 45, "Stop")] });
    const story = screen.getByRole("region", { name: "What happened" });
    expect(story.textContent).not.toContain("newest first");
  });

  it("the tab lives in the URL: another request opens on its Story", () => {
    const two = session(request(), {
      requests: [request({ id: "r1", goal: "Fix the login form" }), request()],
    });
    const { rerender } = show(two, { requestId: "r2", tab: "flow" });
    expect(screen.getByRole("region", { name: "Flow" })).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Requests" });
    expect(within(rail).getAllByRole("link")[0]?.getAttribute("href")).toBe(
      "/s/s1/r/r1",
    );
    rerender(
      <Live
        sessionId="s1"
        requestId="r1"
        view={two}
        events={[]}
        status="live"
        lastLooked={null}
      />,
    );
    expect(screen.getByRole("region", { name: "What happened" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Flow" })).toBeNull();
  });
});

describe("review fixes: timeline", () => {
  const lanesOf = () =>
    within(screen.getByRole("list", { name: "Timeline" })).getAllByRole(
      "listitem",
    );
  const runs = (k: number) =>
    [
      ...(lanesOf()[k] as HTMLElement).querySelectorAll(".run"),
    ] as HTMLElement[];
  const showWith = (
    agents: AgentView[],
    status: PartView["status"] = "done",
  ) => {
    const t = task3();
    t.p.status = status;
    t.p.agents = agents.map((a) => a.id);
    t.r.agents = agents;
    render(<PartDetail request={t.r} part={t.p} events={[]} />);
  };

  it("bars sit at their true width; a label too wide for its bar goes beside it", () => {
    showWith([
      helper("b1", {
        description: "Implement it",
        startedAt: at(0),
        endedAt: at(59),
      }),
      helper("b2", {
        description: "Review it",
        startedAt: at(59),
        endedAt: new Date(Date.parse(at(59)) + 20_000).toISOString(),
      }),
    ]);
    const [built] = runs(0);
    const [review] = runs(1);
    expect(built?.style.width).toBe(built?.style.width);
    expect(Number.parseFloat(built?.style.width ?? "0")).toBeGreaterThan(90);
    expect(built?.className).not.toContain("out");
    expect(Number.parseFloat(review?.style.width ?? "0")).toBeLessThan(1);
    expect(review?.className).toContain("out");
  });

  it("a running helper's bar runs to now", () => {
    vi.useFakeTimers({ now: new Date(at(30)), toFake: ["Date"] });
    showWith(
      [
        helper("b1", {
          description: "Build it",
          status: "running",
          startedAt: at(10),
        }),
      ],
      "now",
    );
    const [bar1] = runs(0);
    expect(bar1?.className).toContain("now");
    expect(bar1?.textContent).toBe("Building");
  });

  it("a span of ten seconds and one of five hours both get a readable axis", () => {
    const ticks = () =>
      [...document.querySelectorAll(".ticks span")].map((s) => s.textContent);
    showWith([
      helper("b1", {
        description: "Build it",
        startedAt: at(0),
        endedAt: new Date(Date.parse(at(0)) + 10_000).toISOString(),
      }),
    ]);
    expect(ticks().length).toBeGreaterThanOrEqual(2);
    cleanup();
    showWith([
      helper("b1", {
        description: "Build it",
        startedAt: at(0),
        endedAt: at(300),
      }),
    ]);
    expect(ticks().length).toBeLessThanOrEqual(8);
  });

  it("an axis that crosses midnight names the day", () => {
    const night = (h: number) =>
      new Date(Date.UTC(2026, 10, 6, h)).toISOString();
    showWith([
      helper("b1", {
        description: "Build it",
        startedAt: night(10),
        endedAt: night(40),
      }),
    ]);
    const ticks = [...document.querySelectorAll(".ticks span")].map(
      (s) => s.textContent ?? "",
    );
    expect(
      ticks.filter((t) => /\d+ [A-Z][a-z]{2} /.test(t)).length,
    ).toBeGreaterThan(1);
  });

  it("overlapping helpers keep their own lanes and places", () => {
    showWith([
      helper("b1", {
        description: "Build A",
        startedAt: at(0),
        endedAt: at(20),
      }),
      helper("b2", {
        description: "Build B",
        startedAt: at(5),
        endedAt: at(25),
      }),
    ]);
    const [a] = runs(0);
    const [b] = runs(1);
    expect(a?.style.left).toBe("0%");
    expect(b?.style.left).toBe("20%");
  });

  it("a recapped step names the bar when it fits", () => {
    const t = task3();
    t.r.recap = true;
    t.p.steps = [
      {
        ts: at(1),
        text: "Builder added the list and its test",
        status: "done",
        eventIds: [],
      },
    ];
    render(<PartDetail request={t.r} part={t.p} events={t.events} />);
    expect(runs(0)[0]?.textContent).toMatch(/^Builder added the list/);
  });
});
