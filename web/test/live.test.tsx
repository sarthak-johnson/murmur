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
  vi.unstubAllGlobals();
});

describe("live screen", () => {
  it("phase strip shows 2 of 4 current", () => {
    show(session());
    const strip = screen.getByRole("group", { name: "Phases" });
    const seg = within(strip).getByRole("button", { name: /2 · Server side/ });
    expect(seg.textContent).toContain("2 of 4 tasks");
    expect(seg.className).toContain("now");
    const done = within(strip).getByRole("button", { name: /1 · Understand/ });
    expect(done.className).toContain("done");
  });

  it("a plan with one phase shows its tasks as a list and no phase strip", () => {
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
    expect(screen.queryByRole("group", { name: "Phases" })).toBeNull();
    const plan = screen.getByRole("region", { name: /Plan/ });
    expect(within(plan).getByText("Style A")).toBeTruthy();
    expect(within(plan).queryByText("Style A · Style B")).toBeNull();
    expect(within(plan).queryByRole("button", { name: /phase 1/ })).toBeNull();
  });

  it("plan panel folds finished phases", async () => {
    show(session());
    const plan = screen.getByRole("region", { name: /Plan/ });
    expect(within(plan).getByText("Plan · step 5 of 7")).toBeTruthy();
    expect(
      within(plan).getByText(
        "Read how watchlists work · Agreed the plan with you",
      ),
    ).toBeTruthy();
    expect(within(plan).queryByText("Read how watchlists work")).toBeNull();
    await userEvent.click(
      within(plan).getByRole("button", { name: /Show phase 1/ }),
    );
    expect(within(plan).getByText("Read how watchlists work")).toBeTruthy();
  });

  it("task row shows its part chip and agents", () => {
    show(session());
    const plan = screen.getByRole("region", { name: /Plan/ });
    const row = within(plan).getByRole("button", {
      name: /Endpoint to save an alert/,
    });
    expect(within(row).getByText("Server endpoint")).toBeTruthy();
    expect(
      within(row).getByText("↳ Agent 1 · writing tests for this endpoint"),
    ).toBeTruthy();
    expect(within(row).getByText("tried a fix 3 times")).toBeTruthy();
  });

  it("needs-you bar appears for a permission prompt", () => {
    show(
      session({
        needsYou: {
          reason: "permission",
          text: "Claude needs your permission to use Bash",
          since: T0,
        },
      }),
    );
    const chip = screen.getByText("Needs you");
    expect(chip.closest("p")?.textContent).toBe(
      "Needs youClaude needs your permission to use Bash",
    );
    expect(screen.queryByText(/Claude needs you:/)).toBeNull();
  });

  it("the notice row shows the top notice and +N more opens the rest", async () => {
    const flags = [
      { kind: "risky" as const, text: "rm -rf build", ts: T0, pending: true },
      {
        kind: "stuck" as const,
        text: "Tried a fix 3 times",
        part: "endpoint",
        ts: T0,
        pending: true,
      },
      { kind: "stuck" as const, text: "Old run", ts: T0, pending: false },
    ];
    const view = session();
    view.requests[1] = request({ flags });
    show(view);
    const row = document.querySelector(".notice-row") as HTMLElement;
    expect(row.querySelector(".notice")?.textContent).toBe("rm -rf build");
    expect(within(row).queryByText(/Tried a fix/)).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "+1 more" }));
    const stuck = within(row).getByText(/Tried a fix 3 times/);
    expect(stuck.closest("li")?.className).toContain("notice-stuck");
    expect(stuck.closest("li")?.textContent).toBe(
      "StuckTried a fix 3 times · Server endpoint",
    );
    expect(within(row).queryByText(/Old run/)).toBeNull();
  });

  it("a stuck flag alone shows in the notice row", () => {
    const view = session();
    view.requests[1] = request({
      flags: [
        { kind: "stuck", text: "Tried a fix 4 times", ts: T0, pending: true },
      ],
    });
    show(view);
    const top = document.querySelector(".notice-row .notice");
    expect(top?.className).toContain("notice-stuck");
    expect(top?.textContent).toBe("StuckTried a fix 4 times");
  });

  it("a needs-you notice does not move the grid", () => {
    const blocks = () =>
      [...(document.querySelector(".live-main")?.children ?? [])].map(
        (el) => el.className,
      );
    const { rerender } = show(session());
    const empty = blocks();
    expect(empty).toContain("notice-row");
    expect(document.querySelector(".notice-row")?.children).toHaveLength(0);
    rerender(
      <Live
        sessionId="s1"
        view={session({
          needsYou: { reason: "permission", text: "Allow Bash?", since: T0 },
        })}
        viewAt={() => null}
        status="live"
        lastLooked={null}
      />,
    );
    expect(blocks()).toEqual(empty);
    expect(document.querySelector(".notice-row")?.textContent).toContain(
      "Allow Bash?",
    );
  });

  it("delete session asks once, then deletes and goes to the sessions list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(session());
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

  it("a guessed request kind is tagged inferred", () => {
    const view = session();
    view.requests[0] = {
      ...(view.requests[0] as RequestView),
      kindInferred: true,
    };
    show(view);
    const list = screen.getByRole("navigation", { name: "Requests" });
    const [mapped, guessed] = within(list).getAllByRole("button");
    expect(within(guessed as HTMLElement).getByText("inferred").className).toBe(
      "inferred",
    );
    expect(within(mapped as HTMLElement).queryByText("inferred")).toBeNull();
  });

  it("catch-up line renders and hides when null", () => {
    const before = session();
    before.requests[1] = request({
      phases: request().phases.map((ph) =>
        ph.id === "p2"
          ? {
              ...ph,
              tasks: ph.tasks.map((t) =>
                t.id === "t5" ? { ...t, status: "todo" as const } : t,
              ),
            }
          : ph,
      ),
    });
    const lastLooked = new Date(Date.now() - 6 * 60_000).toISOString();
    show(session(), { lastLooked, before });
    expect(
      screen.getByText(/Since you last looked/).closest("p")?.textContent,
    ).toBe(
      "Since you last looked (6 min ago): started Endpoint to save an alert",
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
    const plan = screen.getByRole("region", { name: /Plan/ });
    const row = within(plan).getByRole("button", {
      name: /Reuse push code to notify/,
    });
    await userEvent.hover(row);
    expect(nodeOpacity("Push notification, not started")).toBe("1");
    expect(nodeOpacity("Server endpoint, in progress")).toBe("0.35");
    expect(within(row).getByText("Push notification").className).toContain(
      "hl",
    );
    await userEvent.unhover(row);
    expect(nodeOpacity("Server endpoint, in progress")).toBe("1");
  });

  it("clicking a phase in the strip shows only that phase's parts at full opacity", async () => {
    show(session());
    const strip = screen.getByRole("group", { name: "Phases" });
    const seg = within(strip).getByRole("button", { name: /3 · App screen/ });
    await userEvent.click(seg);
    expect(seg.getAttribute("aria-pressed")).toBe("true");
    expect(nodeOpacity("Alert screen, not started")).toBe("1");
    expect(nodeOpacity("Server endpoint, in progress")).toBe("0.35");
    expect(nodeOpacity("Alerts table, done")).toBe("0.35");
    await userEvent.click(seg);
    expect(nodeOpacity("Alerts table, done")).toBe("1");
  });

  it("clicking a task opens the part drill-down route", async () => {
    show(session());
    const plan = screen.getByRole("region", { name: /Plan/ });
    await userEvent.click(
      within(plan).getByRole("button", { name: /Endpoint to save an alert/ }),
    );
    expect(location.pathname).toBe("/s/s1/r/r2/p/endpoint");
  });

  it("NowCard shows the waiting line when now is null", () => {
    const view = session();
    view.requests[1] = request({ now: null });
    show(view);
    expect(
      screen.getByText("Waiting for Claude to say what it is working on."),
    ).toBeTruthy();
  });

  it("NowCard tags an inferred now, hides an empty why, and lists loose files", () => {
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
    expect(within(now).getByText("inferred").className).toContain("inferred");
    expect(within(now).queryByText(/Why now/)).toBeNull();
    const files = within(now).getByRole("list", { name: "Files touched" });
    expect(
      within(files)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["math.js+3−1the add function", "math.test.js+5−0"]);
  });

  it("NowCard shows narrated now with its why and no inferred tag or files", () => {
    show(session());
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText(/Why now/)).toBeTruthy();
    expect(within(now).queryByText("inferred")).toBeNull();
    expect(
      within(now).queryByRole("list", { name: "Files touched" }),
    ).toBeNull();
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

  it("NowCard lists running helpers with their part and the starting prompt", () => {
    show(session());
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByRole("listitem").textContent).toBe(
      "Agent 1 · writing tests for this endpointServer endpoint",
    );
    expect(within(now).getByText("Server endpoint")).toBeTruthy();
    expect(now.textContent).toContain(
      'Started from: "add price alerts to the app" · ',
    );
  });

  it("a helper with no description shows just its name", () => {
    show(
      session({
        requests: [request({ agents: [agent("a1", "", "endpoint")] })],
      }),
    );
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByRole("listitem").textContent).toBe(
      "Agent 1Server endpoint",
    );
    const plan = screen.getByRole("region", { name: /Plan/ });
    const row = within(plan).getByRole("button", {
      name: /Endpoint to save an alert/,
    });
    expect(within(row).getByText("↳ Agent 1")).toBeTruthy();
    expect(screen.queryByText(/Agent 1 ·|Agent 1:/)).toBeNull();
  });

  it("RequestList selects the last request by default", async () => {
    show(session());
    const list = screen.getByRole("navigation", { name: "Requests" });
    const items = within(list).getAllByRole("button");
    expect(items[0]?.textContent).toContain("Price alerts");
    expect(items[0]?.getAttribute("aria-current")).toBe("true");
    expect(items[1]?.textContent).toContain("bug hunt");
    expect(items[1]?.getAttribute("aria-current")).toBeNull();
    await userEvent.click(items[1] as HTMLElement);
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
    const plan = screen.getByRole("region", { name: /Plan/ });
    const row = within(plan).getByRole("button", {
      name: /Endpoint to save an alert/,
    });
    expect(within(row).getByText("↳ Agent 1 · tests")).toBeTruthy();
    expect(screen.getByText("Agent 1: tests")).toBeTruthy();
    expect(req.agents).toHaveLength(1);
  });

  it("a finished inferred request shows a Done card instead of a stale now", () => {
    const view = session();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      now: { text: "Editing style.css", why: "", ts: T0, inferred: true },
      tally: { helpers: 3, files: 19, commands: 51 },
    });
    show(view);
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Done")).toBeTruthy();
    expect(
      within(now).getByText("3 helpers, 19 files changed, 51 commands run"),
    ).toBeTruthy();
    expect(within(now).queryByText(/Editing/)).toBeNull();
    expect(within(now).queryByText("Helpers running")).toBeNull();
    expect(now.textContent).toContain('Started from: "add price alerts');
  });

  it("the Done line counts in plain words and skips zeros", () => {
    const view = session();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      tally: { helpers: 0, files: 1, commands: 1 },
    });
    show(view);
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("1 file changed, 1 command run")).toBeTruthy();
    cleanup();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
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
    expect(screen.queryByText("Done")).toBeNull();
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
    const now = screen.getByRole("region", { name: "Now" });
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

  it("the loading skeleton keeps a requests placeholder before the main column", () => {
    const { container } = render(
      <Live
        sessionId="s1"
        view={null}
        viewAt={() => null}
        status="loading"
        lastLooked={null}
      />,
    );
    const page = container.querySelector(".live-page");
    expect(page?.children[0]?.className).toContain("sk-requests");
    expect(page?.children[1]?.className).toBe("live-main");
  });
});
