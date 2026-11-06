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

  it("a pending risky flag shows a bar, a stuck flag does not", () => {
    const flags = [
      { kind: "risky" as const, text: "rm -rf build", ts: T0, pending: true },
      { kind: "stuck" as const, text: "tests failing", ts: T0, pending: true },
    ];
    const view = session();
    view.requests[1] = request({ flags });
    show(view);
    expect(screen.getByText("rm -rf build")).toBeTruthy();
    expect(screen.queryByText("tests failing")).toBeNull();
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

  it("CatchUp hides when lastLooked is null", () => {
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
