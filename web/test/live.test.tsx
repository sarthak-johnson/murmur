import {
  type AgentView,
  type MurmurEvent,
  type PartView,
  type RequestView,
  reduce,
  type SessionView,
  type TaskView,
} from "@murmur/core";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live } from "../src/pages/Session";

const T0 = "2026-11-06T10:00:00Z";

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

function task(
  id: string,
  title: string,
  status: TaskView["status"],
  t: Partial<TaskView> = {},
): TaskView {
  return { id, title, status, agents: [], ...t };
}

function agent(id: string, description: string, partId?: string): AgentView {
  return {
    id,
    type: "general-purpose",
    description,
    prompt: "",
    ...(partId ? { part: partId } : {}),
    status: "running",
    startedAt: T0,
  };
}

function request(r: Partial<RequestView> = {}): RequestView {
  return {
    id: "r2",
    prompt: "add price alerts to the app",
    startedAt: T0,
    kind: "feature",
    kindInferred: false,
    goal: "Price alerts",
    phases: [
      {
        id: "p1",
        title: "Understand",
        status: "done",
        tasks: [
          task("t1", "Read how watchlists work", "done"),
          task("t2", "Agreed the plan with you", "done"),
        ],
      },
      {
        id: "p2",
        title: "Server side",
        status: "now",
        tasks: [
          task("t3", "Alerts table in the database", "done", { part: "table" }),
          task("t4", "Read the push code", "done"),
          task("t5", "Endpoint to save an alert", "now", {
            part: "endpoint",
            agents: ["a1"],
            problem: "tried a fix 3 times",
          }),
          task("t6", "Reuse push code to notify", "todo", { part: "push" }),
        ],
      },
      {
        id: "p3",
        title: "App screen",
        status: "todo",
        tasks: [
          task("t7", "Screen to set an alert", "todo", { part: "screen" }),
        ],
      },
    ],
    planInferred: false,
    parts: [
      part({ id: "screen", title: "Alert screen", phase: "p3" }),
      part({
        id: "endpoint",
        title: "Server endpoint",
        phase: "p2",
        status: "now",
        agents: ["a1"],
      }),
      part({ id: "table", title: "Alerts table", phase: "p2", status: "done" }),
      part({ id: "push", title: "Push notification", phase: "p2" }),
    ],
    looseFiles: [],
    now: {
      text: "Building the server endpoint that saves an alert",
      why: "the alert screen can't be built until there's somewhere to send it",
      part: "endpoint",
      ts: T0,
    },
    agents: [agent("a1", "writing tests for this endpoint", "endpoint")],
    assumptions: [],
    flags: [],
    finished: false,
    tally: { helpers: 1, files: 0, commands: 0 },
    ...r,
  };
}

function session(s: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "s1",
    cwd: "/x/app",
    title: "app",
    startedAt: T0,
    lastEventAt: T0,
    ended: false,
    requests: [
      request({
        id: "r1",
        goal: "Fix the login bug",
        kind: "bug",
        prompt: "login is broken",
        phases: [],
        parts: [],
        now: null,
        agents: [],
      }),
      request(),
    ],
    needsYou: null,
    ...s,
  };
}

function mockFetch() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({
        method,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const body =
        method === "GET" ? { decisions: [] } : JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
  return calls;
}

function show(
  view: SessionView,
  p: {
    requestId?: string;
    lastLooked?: string | null;
    before?: SessionView | null;
  } = {},
) {
  return render(
    <Live
      sessionId="s1"
      {...(p.requestId ? { requestId: p.requestId } : {})}
      view={view}
      viewAt={() => p.before ?? null}
      status="live"
      lastLooked={p.lastLooked ?? null}
    />,
  );
}

const nodeOpacity = (name: string) =>
  (
    screen
      .getByRole("button", { name })
      .querySelector(".dim") as SVGElement | null
  )?.style.opacity;

let calls: ReturnType<typeof mockFetch>;
beforeEach(() => {
  calls = mockFetch();
  history.pushState(null, "", "/s/s1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("live screen", () => {
  it("the plan column and the progress under the title say where the work is", () => {
    show(session());
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const phases = [...plan.querySelectorAll(".ph")].map((p) => p.className);
    expect(phases).toEqual(["ph done", "ph now", "ph todo"]);
    const progress = within(screen.getByRole("main")).getByRole("group", {
      name: "Progress",
    });
    expect(progress.textContent).toContain("Phase 2 of 3");
    expect(progress.textContent).toContain("4/7");
  });

  it("a plan with one phase shows its tasks as a list", () => {
    const one = request({
      phases: [
        {
          id: "p1",
          title: "What Claude did",
          status: "done",
          tasks: [task("t1", "Style A", "done"), task("t2", "Style B", "done")],
        },
      ],
    });
    show(session({ requests: [one] }));
    const plan = screen.getByRole("complementary", { name: "Plan" });
    expect(within(plan).getByText("Style A")).toBeTruthy();
    expect(within(plan).getByText("Style B")).toBeTruthy();
    expect(within(plan).queryByText("Style A · Style B")).toBeNull();
    expect(within(plan).queryByRole("button", { name: /phase 1/ })).toBeNull();
  });

  it("a finished phase says its count and keeps its tasks in view", () => {
    show(session());
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const first = within(plan).getAllByRole("listitem", {
      name: "Understand",
    })[0] as HTMLElement;
    expect(first.querySelector(".sub")?.textContent).toBe("2 of 2 done");
    expect(within(first).getByText("Read how watchlists work")).toBeTruthy();
    expect(within(plan).queryByText(/Read how watchlists work ·/)).toBeNull();
  });

  it("the live task shows its helper as a card, with its problem", () => {
    show(session());
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const card = within(plan).getByRole("listitem", { name: "Agent 1" });
    expect(within(card).getByText("Endpoint to save an alert")).toBeTruthy();
    expect(within(card).getByText("Agent 1")).toBeTruthy();
    expect(within(card).getByText("tried a fix 3 times")).toBeTruthy();
  });

  it("a permission prompt raises the amber chip and says what Claude needs", () => {
    show(
      session({
        needsYou: {
          reason: "permission",
          text: "Claude needs your permission to use Bash",
          since: T0,
        },
      }),
    );
    const chip = within(screen.getByRole("banner")).getByRole("link", {
      name: /Permission needed/,
    });
    expect(chip.getAttribute("href")).toBe("#needs");
    const call = screen.getByRole("region", { name: "Needs your call" });
    expect(call.textContent).toContain(
      "Claude needs your permission to use Bash",
    );
    expect(screen.queryByText(/Claude needs you:/)).toBeNull();
  });

  it("a risky command still waiting shows in the call, a settled one does not", () => {
    const flags = [
      { kind: "risky" as const, text: "rm -rf build", ts: T0, pending: true },
      { kind: "risky" as const, text: "rm -rf old", ts: T0, pending: false },
    ];
    const view = session({
      needsYou: { reason: "permission", text: "Allow Bash?", since: T0 },
    });
    view.requests[1] = request({ flags });
    show(view);
    const call = screen.getByRole("region", { name: "Needs your call" });
    expect(call.textContent).toContain("rm -rf build");
    expect(call.textContent).not.toContain("rm -rf old");
  });

  it("a needs-you adds the chip and the call without reshuffling the rest", () => {
    const kids = (sel: string) =>
      [...(document.querySelector(sel)?.children ?? [])].map(
        (el) => el.className,
      );
    const view = (s = {}) =>
      session({
        ...s,
        requests: [
          session().requests[0] as RequestView,
          request({
            messages: [{ id: "m1", ts: T0, text: "Starting on the table." }],
          }),
        ],
      });
    const { rerender } = show(view());
    const bar = kids(".top-right");
    const main = kids(".main");
    expect(main).toEqual([
      "over",
      "ask live-title",
      "asked-row",
      "tabs",
      "tab-body",
    ]);
    rerender(
      <Live
        sessionId="s1"
        view={view({
          needsYou: { reason: "permission", text: "Allow Bash?", since: T0 },
        })}
        viewAt={() => null}
        status="live"
        lastLooked={null}
      />,
    );
    expect(kids(".top-right")).toEqual(["need-chip", ...bar]);
    expect(kids(".main")).toEqual([
      "over",
      "ask live-title",
      "asked-row",
      "brief",
      "tabs",
      "tab-body",
    ]);
  });

  it("delete session asks once, then deletes and goes to the sessions list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(session());
      // Delete sits in the session's menu in the top bar.
      await userEvent.click(
        screen.getByRole("button", { name: "Session menu" }),
      );
      const del = screen.getByRole("button", { name: "Delete session" });
      await userEvent.click(del);
      expect(
        screen.getByText(
          "If Claude is still running here, new activity will start this session again.",
        ),
      ).toBeTruthy();
      vi.advanceTimersByTime(5000);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Delete session" }),
        ).toBeTruthy(),
      );
      expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
      await userEvent.click(
        screen.getByRole("button", { name: "Delete session" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Delete?" }));
      await waitFor(() => expect(location.pathname).toBe("/"));
      expect(calls.filter((c) => c.method === "DELETE")).toEqual([
        { method: "DELETE", url: "/api/sessions/s1", body: {} },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a guessed request kind is tagged inferred", async () => {
    const view = session();
    view.requests[0] = {
      ...(view.requests[0] as RequestView),
      kindInferred: true,
    };
    show(view, { requestId: "r1" });
    const kind = () =>
      document.querySelector(".over .label-chip") as HTMLElement;
    expect(kind().textContent).toBe("Bug huntinferred");
    expect(within(kind()).getByText("inferred").className).toBe("inferred");
    cleanup();
    show(view, { requestId: "r2" });
    expect(kind().textContent).toBe("Feature");
  });

  it("catch-up renders what changed and hides when nothing did", () => {
    const before = session();
    before.requests[1] = request({
      phases: request().phases.map((ph) =>
        ph.id === "p2"
          ? {
              ...ph,
              tasks: ph.tasks.map((t) =>
                t.id === "t3" ? { ...t, status: "now" as const } : t,
              ),
            }
          : ph,
      ),
    });
    const lastLooked = new Date(Date.now() - 6 * 60_000).toISOString();
    show(session(), { lastLooked, before });
    const brief = screen.getByRole("region", { name: "Since you last looked" });
    expect(brief.textContent).toContain("6 min ago");
    expect(brief.querySelector(".lead")?.textContent).toBe("1 task is done.");
    expect(brief.querySelector(".it")?.textContent).toBe(
      "1 task done: Alerts table in the database",
    );
    cleanup();
    show(session(), { lastLooked, before: session() });
    expect(screen.queryByText(/Since you last looked/)).toBeNull();
  });

  it("catch-up hides when lastLooked is null", () => {
    show(session(), { lastLooked: null, before: session({ requests: [] }) });
    expect(screen.queryByText(/Since you last looked/)).toBeNull();
  });

  it("rejecting an assumption shows the paste line", async () => {
    const view = session();
    view.requests[1] = request({
      assumptions: [
        {
          key: "k1",
          choice: "Alerts fire once per day",
          reason: "no spec for repeats",
          ts: T0,
        },
      ],
    });
    show(view);
    const box = screen.getByRole("region", { name: /Assumptions \(1\)/ });
    await userEvent.click(within(box).getByRole("button", { name: "Reject" }));
    expect(
      within(box).getByText(
        "Please undo this choice: Alerts fire once per day",
      ),
    ).toBeTruthy();
    expect(within(box).getByText("Rejected")).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Copy" })).toBeTruthy();
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        url: "/api/sessions/s1/assumptions",
        body: { key: "k1", decision: "rejected" },
      }),
    );
  });

  it("inferred plan is labelled inferred", () => {
    const view = session();
    view.requests[1] = request({ planInferred: true });
    show(view);
    expect(screen.getAllByText("inferred").length).toBeGreaterThan(0);
    cleanup();
    show(session());
    expect(screen.queryByText("inferred")).toBeNull();
  });

  it("hovering a task highlights its part", async () => {
    show(session());
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const row = within(plan).getByRole("button", {
      name: /Reuse push code to notify/,
    });
    await userEvent.hover(row);
    expect(nodeOpacity("Push notification, not started")).toBe("1");
    expect(nodeOpacity("Server endpoint, in progress")).toBe("0.35");
    await userEvent.unhover(row);
    expect(nodeOpacity("Server endpoint, in progress")).toBe("1");
  });

  it("a phase title links to its part of the story, and only when it has one", () => {
    const view = session();
    view.requests[1] = request({
      messages: [{ id: "m1", ts: T0, text: "The table is in.", task: "t3" }],
    });
    show(view);
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const link = within(plan).getByRole("link", { name: "Server side" });
    expect(link.getAttribute("href")).toBe("#phase-p2");
    expect(document.getElementById("phase-p2")).toBeTruthy();
    expect(within(plan).queryByRole("link", { name: "App screen" })).toBeNull();
  });

  it("clicking a task opens the part drill-down route", async () => {
    show(session());
    const plan = screen.getByRole("complementary", { name: "Plan" });
    await userEvent.click(
      within(plan).getByRole("button", { name: /Reuse push code to notify/ }),
    );
    expect(location.pathname).toBe("/s/s1/r/r2/p/push");
  });

  it("the now line waits for Claude when there is no now", () => {
    const view = session();
    view.requests[1] = request({ now: null });
    show(view);
    expect(
      screen.getByText("Waiting for Claude to say what it is working on."),
    ).toBeTruthy();
  });

  it("an inferred now has no why, and loose files are listed under the story", () => {
    const view = session();
    view.requests[1] = request({
      now: { text: "Editing math.js", why: "", ts: T0, inferred: true },
      looseFiles: [
        {
          path: "math.js",
          role: "the add function",
          added: 3,
          removed: 1,
          isNew: false,
          eventIds: [],
        },
        {
          path: "math.test.js",
          added: 5,
          removed: 0,
          isNew: true,
          eventIds: [],
        },
      ],
    });
    show(view);
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Editing math.js")).toBeTruthy();
    expect(within(now).queryByRole("button", { name: "Details" })).toBeNull();
    const files = screen.getByRole("list", { name: "Files touched" });
    expect(
      within(files)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["math.js+3−1the add function", "math.test.js+5−0"]);
  });

  it("a narrated now keeps its why one click away", async () => {
    show(session());
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).queryByText(/Why now/)).toBeNull();
    await userEvent.click(within(now).getByRole("button", { name: "Details" }));
    expect(within(now).getByText(/Why now/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Files touched" })).toBeNull();
  });

  it("an ended session says ended, not live", () => {
    show(session({ ended: true }));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("ended");
    expect(status.className).not.toContain("live-dot");
    cleanup();
    show(session());
    expect(screen.getByRole("status").textContent).toBe("live");
  });

  it("a running helper shows in the plan under its task, with its number", () => {
    show(session());
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const card = within(plan).getByRole("listitem", { name: "Agent 1" });
    expect(card.querySelector("b")?.textContent).toBe(
      "Endpoint to save an alert",
    );
    expect(screen.getByRole("heading", { level: 1 }).title).toBe(
      "add price alerts to the app",
    );
  });

  it("a running helper with no task reads as its own name", () => {
    show(
      session({
        requests: [request({ agents: [agent("a9", "", undefined)] })],
      }),
    );
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const card = within(plan).getByRole("listitem", { name: "Agent 1" });
    expect(card.querySelector("b")?.textContent).toBe("Agent 1");
    expect(screen.queryByText(/Agent 1 ·|Agent 1:/)).toBeNull();
  });

  it("the rail shows the last request by default", async () => {
    show(session());
    const list = screen.getByRole("navigation", { name: "Requests" });
    const items = within(list).getAllByRole("link");
    expect(items[0]?.textContent).toContain("Fix the login bug");
    expect(items[0]?.getAttribute("aria-current")).toBeNull();
    expect(items[1]?.textContent).toContain("Price alerts");
    expect(items[1]?.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Price alerts",
    );
    await userEvent.click(items[0] as HTMLElement);
    expect(location.pathname).toBe("/s/s1/r/r1");
  });

  it("a helper spawned during a task shows on its task row and map part", () => {
    let n = 0;
    const at = (
      hook: MurmurEvent["hook"],
      payload: Record<string, unknown>,
    ): MurmurEvent => ({
      id: `e${++n}`,
      sessionId: "s1",
      machineId: "m1",
      cwd: "/p",
      ts: new Date(Date.parse(T0) + n * 1000).toISOString(),
      hook,
      payload,
    });
    const call = (name: string, input: unknown, hook: MurmurEvent["hook"]) =>
      at(hook, { tool_name: name, tool_input: input, tool_use_id: `t${n}` });
    const view = reduce([
      at("UserPromptSubmit", { prompt: "add price alerts" }),
      call(
        "mcp__plugin_murmur_murmur__map",
        {
          kind: "feature",
          goal: "Price alerts",
          phases: [
            {
              id: "2",
              title: "Server side",
              tasks: [
                {
                  id: "2.2",
                  title: "Endpoint to save an alert",
                  part: "endpoint",
                },
              ],
            },
          ],
          parts: [{ id: "endpoint", title: "Server endpoint", phase: "2" }],
        },
        "PostToolUse",
      ),
      call(
        "mcp__plugin_murmur_murmur__narrate",
        {
          now: "Building the endpoint",
          why: "the screen needs it",
          task: "2.2",
          taskStatus: "running",
        },
        "PostToolUse",
      ),
      call(
        "Agent",
        {
          description: "tests",
          prompt: "write tests",
          subagent_type: "general-purpose",
        },
        "PreToolUse",
      ),
      at("SubagentStart", { agent_id: "a1", agent_type: "general-purpose" }),
    ]);
    const req = view.requests[0] as RequestView;
    show(view);
    const plan = screen.getByRole("complementary", { name: "Plan" });
    const card = within(plan).getByRole("listitem", { name: "Agent 1" });
    expect(card.querySelector("b")?.textContent).toBe(
      "Endpoint to save an alert",
    );
    expect(screen.getByText("Agent 1: tests")).toBeTruthy();
    expect(req.agents).toHaveLength(1);
  });

  it("a finished inferred request says what it did instead of a stale now", () => {
    const view = session();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      now: { text: "Editing style.css", why: "", ts: T0, inferred: true },
      tally: { helpers: 3, files: 19, commands: 51 },
      agents: [],
    });
    show(view);
    expect(within(screen.getByRole("banner")).getByText("Done")).toBeTruthy();
    const now = screen.getByRole("region", { name: "Now" });
    expect(
      within(now).getByText("3 helpers, 19 files changed, 51 commands run"),
    ).toBeTruthy();
    expect(within(now).queryByText(/Editing/)).toBeNull();
  });

  it("a finished request never claims helpers are still running", () => {
    const view = session();
    const running = (id: string) => agent(id, "Build style A", "endpoint");
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      tally: { helpers: 0, files: 0, commands: 0 },
      agents: [running("a1"), { ...running("a2"), status: "done" }],
    });
    show(view);
    expect(within(screen.getByRole("banner")).getByText("Done")).toBeTruthy();
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Nothing changed")).toBeTruthy();
    expect(now.textContent).not.toContain("still running");
  });

  it("the done line counts in plain words and skips zeros", () => {
    const view = session();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      agents: [],
      tally: { helpers: 0, files: 1, commands: 1 },
    });
    show(view);
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("1 file changed, 1 command run")).toBeTruthy();
    cleanup();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      agents: [],
      tally: { helpers: 0, files: 0, commands: 0 },
    });
    show(view);
    expect(screen.getByText("Nothing changed")).toBeTruthy();
  });

  it("a running inferred request and a finished narrated one keep the Now card", () => {
    const view = session();
    view.requests[1] = request({ planInferred: true, finished: false });
    show(view);
    expect(
      screen.getByText("Building the server endpoint that saves an alert"),
    ).toBeTruthy();
    expect(within(screen.getByRole("banner")).queryByText("Done")).toBeNull();
    cleanup();
    view.requests[1] = request({ finished: true });
    show(view);
    expect(
      screen.getByText("Building the server endpoint that saves an alert"),
    ).toBeTruthy();
  });

  it("files touched shows 8 newest first, readable paths, then Show all N", async () => {
    const tmp =
      "/private/tmp/claude-501/-x-app/27a000a1-7dbc-4dd1-ab83-961149fc03ae";
    const looseFiles = Array.from({ length: 10 }, (_, i) => ({
      path: i === 9 ? `${tmp}/scratchpad/style/a/style.css` : `src/f${i}.ts`,
      added: 117,
      removed: 2,
      isNew: false,
      eventIds: [`e${i}`],
    }));
    const events: MurmurEvent[] = looseFiles.map((_, i) => ({
      id: `e${i}`,
      sessionId: "s1",
      machineId: "m1",
      cwd: "/x/app",
      ts: new Date(Date.parse(T0) + i * 1000).toISOString(),
      hook: "PostToolUse",
      payload: {},
    }));
    const view = session();
    view.requests[1] = request({ looseFiles });
    render(
      <Live
        sessionId="s1"
        view={view}
        viewAt={() => null}
        events={events}
        status="live"
        lastLooked={null}
      />,
    );
    const now = screen.getByRole("region", { name: "Files touched" });
    const names = () =>
      within(now)
        .getAllByRole("listitem")
        .flatMap((li) => [...li.querySelectorAll(".pd-path")])
        .map((el) => el.textContent);
    expect(names()).toEqual([
      "scratchpad/style/a/style.css",
      "src/f8.ts",
      "src/f7.ts",
      "src/f6.ts",
      "src/f5.ts",
      "src/f4.ts",
      "src/f3.ts",
      "src/f2.ts",
    ]);
    const path = within(now).getByText("scratchpad/style/a/style.css");
    expect(path.getAttribute("title")).toBe(
      `${tmp}/scratchpad/style/a/style.css`,
    );
    expect(within(now).getByText("src/f8.ts").getAttribute("title")).toBe(
      "/x/app/src/f8.ts",
    );
    // Breaks only after a slash.
    expect(path.innerHTML).toBe("scratchpad/<wbr>style/<wbr>a/<wbr>style.css");
    await userEvent.click(
      within(now).getByRole("button", { name: "Show all 10" }),
    );
    expect(names()).toHaveLength(10);
    await userEvent.click(
      within(now).getByRole("button", { name: "Show fewer" }),
    );
    expect(names()).toHaveLength(8);
  });

  it("8 files or fewer need no toggle", () => {
    const view = session();
    view.requests[1] = request({
      looseFiles: [
        { path: "a.ts", added: 1, removed: 0, isNew: true, eventIds: [] },
      ],
    });
    show(view);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("the loading skeleton draws the same frame as the loaded screen", () => {
    const { container } = render(
      <Live
        sessionId="s1"
        view={null}
        viewAt={() => null}
        status="loading"
        lastLooked={null}
      />,
    );
    const kids = (el: Element | null) =>
      [...(el?.children ?? [])]
        .map((c) => c.className.split(" ")[0])
        .filter((c) => c !== "skip");
    const frame = container.querySelector(".frame");
    expect(kids(frame)).toEqual(["rail", "col"]);
    expect(kids(frame?.querySelector(".col") ?? null)).toEqual(["top", "main"]);
    expect(frame?.querySelector(".main .skeleton")).toBeTruthy();
    cleanup();
    const loaded = show(session()).container.querySelector(".frame");
    expect(kids(loaded)).toEqual(["rail", "col"]);
    expect(kids(loaded?.querySelector(".col") ?? null)).toEqual([
      "top",
      "main",
    ]);
  });
});
