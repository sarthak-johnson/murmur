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
import { Live as Page } from "../src/pages/Session";

/** A request's own page: the newest request unless the test names one. */
function Live(p: React.ComponentProps<typeof Page>) {
  return <Page {...p} requestId={p.requestId ?? p.view?.requests.at(-1)?.id} />;
}

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
  } = {},
) {
  return render(
    <Live
      sessionId="s1"
      {...(p.requestId ? { requestId: p.requestId } : {})}
      view={view}
      status="live"
      lastLooked={p.lastLooked ?? null}
    />,
  );
}

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
  it("the phase track says where the work is", () => {
    show(session());
    const track = screen.getByRole("region", { name: "Phase track" });
    const segs = [...track.querySelectorAll(".trk-seg")].map(
      (p) => p.className,
    );
    expect(segs).toEqual(["trk-seg done", "trk-seg now", "trk-seg todo"]);
    expect(track.querySelector(".trk-foot")?.textContent).toContain(
      "Plan: 4 of 7 done",
    );
    expect(screen.queryByRole("group", { name: "Progress" })).toBeNull();
  });

  it("a plan with one phase shows its tasks as stations", () => {
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
    const track = screen.getByRole("region", { name: "Phase track" });
    expect(
      [...track.querySelectorAll(".cap")].map((c) => c.textContent),
    ).toEqual(["Style A", "Style B"]);
    expect(within(track).queryByRole("button", { name: /phase 1/ })).toBeNull();
  });

  it("a finished phase says its count and keeps its tasks in view", () => {
    show(session());
    const track = screen.getByRole("region", { name: "Phase track" });
    const first = track.querySelector(".trk-seg") as HTMLElement;
    expect(first.querySelector(".trk-s")?.textContent).toBe("2 of 2 done");
    expect(
      within(first).getByText(
        (_, e) =>
          e?.className === "cap" &&
          e.textContent === "Read how watchlists work",
      ),
    ).toBeTruthy();
  });

  it("the live task is the live station, its problem on hover; its helper is in the side", () => {
    show(session());
    const track = screen.getByRole("region", { name: "Phase track" });
    const live = within(track).getByRole("link", {
      name: "Endpoint to save an alert, in progress",
    });
    expect(live.closest(".st")?.className).toBe("st now");
    expect(live.title).toBe("Endpoint to save an alert: tried a fix 3 times");
    const helpers = screen.getByRole("region", { name: "Helpers" });
    expect(
      within(helpers).getByText("writing tests for this endpoint"),
    ).toBeTruthy();
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
    const call = screen.getByRole("region", { name: "Waiting on you" });
    expect(call.id).toBe("needs");
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
    const call = screen.getByRole("region", { name: "Waiting on you" });
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
      "asked",
      "rb",
      "trk",
      "tabs",
      "tab-body",
    ]);
    const brief = kids(".rb");
    rerender(
      <Live
        sessionId="s1"
        view={view({
          needsYou: { reason: "permission", text: "Allow Bash?", since: T0 },
        })}
        status="live"
        lastLooked={null}
      />,
    );
    expect(kids(".top-right")).toEqual(["need-chip", ...bar]);
    expect(kids(".main")).toEqual(main);
    // The wait joins the brief at its foot; the cells above it stay put.
    expect(kids(".rb")).toEqual([...brief, "rb-need"]);
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

  it("a guessed request kind shows no chip; a named one does", async () => {
    const view = session();
    view.requests[0] = {
      ...(view.requests[0] as RequestView),
      kindInferred: true,
    };
    show(view, { requestId: "r1" });
    const kind = () =>
      document.querySelector(".over .label-chip") as HTMLElement;
    expect(kind()).toBeNull();
    cleanup();
    show(view, { requestId: "r2" });
    expect(kind().textContent).toBe("Feature");
  });

  it("key moments since the last look are marked new, with their count", () => {
    const view = session();
    const looked = new Date(Date.parse(T0) + 60_000).toISOString();
    view.requests[1] = request({
      messages: [
        { id: "m1", ts: T0, text: "Task 1 is done." },
        {
          id: "m2",
          ts: new Date(Date.parse(T0) + 120_000).toISOString(),
          text: "The review found a problem in the endpoint.",
        },
      ],
    });
    show(view, { lastLooked: looked });
    const moments = screen.getByRole("region", { name: "Key moments" });
    expect(
      [...moments.querySelectorAll(".km-row")].map((r) => r.className),
    ).toEqual(["km-row", "km-row new"]);
    expect(moments.querySelector(".badge.new")?.textContent).toMatch(
      /^1 new since \d\d:\d\d$/,
    );
    expect(screen.queryByText(/Since you last looked/)).toBeNull();
  });

  it("nothing is marked new on a first visit", () => {
    const view = session();
    view.requests[1] = request({
      messages: [{ id: "m1", ts: T0, text: "Task 1 is done." }],
    });
    show(view, { lastLooked: null });
    const moments = screen.getByRole("region", { name: "Key moments" });
    expect(moments.querySelector(".new")).toBeNull();
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
    expect(document.querySelector(".over")?.textContent).toContain(
      "plan inferred",
    );
    cleanup();
    show(session());
    expect(document.querySelector(".over")?.textContent).toContain(
      "narrated live",
    );
    expect(screen.queryByText("inferred")).toBeNull();
  });

  it("a phase has a part of the story to land on, and only when it has one", () => {
    const view = session();
    view.requests[1] = request({
      messages: [
        { id: "m1", ts: T0, text: "The table is in.", task: "t3", phase: "p2" },
      ],
    });
    show(view);
    expect(document.getElementById("phase-p2")).toBeTruthy();
    expect(document.getElementById("phase-p3")).toBeNull();
  });

  it("clicking a station opens the part drill-down route", async () => {
    show(session());
    const track = screen.getByRole("region", { name: "Phase track" });
    await userEvent.click(
      within(track).getByRole("link", { name: /Reuse push code to notify/ }),
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

  it("an inferred now has no why, and loose files are listed beside the story", () => {
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
    const files = screen.getByRole("region", { name: "Files" });
    expect(files.querySelector(".fl-g")?.textContent).toBe(
      "Outside any task · 2",
    );
    expect(
      [...files.querySelectorAll(".fl-f")].map((li) => li.textContent),
    ).toEqual(["math.js+3 −1", "math.test.js+5"]);
  });

  it("a narrated now keeps its why one click away", async () => {
    show(session());
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).queryByText(/Why now/)).toBeNull();
    await userEvent.click(within(now).getByRole("button", { name: "Details" }));
    expect(within(now).getByText(/Why now/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
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

  it("a running helper shows in the side column, marked running", () => {
    show(session());
    const helpers = screen.getByRole("region", { name: "Helpers" });
    const row = helpers.querySelector(".hl-row") as HTMLElement;
    expect(row.querySelector(".hl-n")?.textContent).toBe(
      "writing tests for this endpoint",
    );
    expect(row.querySelector(".mk.running")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).title).toBe(
      "add price alerts to the app",
    );
  });

  it("a running helper with no name reads as a helper", () => {
    show(
      session({
        requests: [request({ agents: [agent("a9", "", undefined)] })],
      }),
    );
    const helpers = screen.getByRole("region", { name: "Helpers" });
    expect(helpers.querySelector(".hl-n")?.textContent).toBe("A helper");
    expect(screen.queryByText(/Agent 1 ·|Agent 1:/)).toBeNull();
  });

  it("the rail marks the request on screen as the page", async () => {
    show(session());
    const list = screen.getByRole("navigation", { name: "Requests" });
    const items = within(list).getAllByRole("link");
    expect(items[0]?.textContent).toContain("Fix the login bug");
    expect(items[0]?.getAttribute("aria-current")).toBeNull();
    expect(items[1]?.textContent).toContain("Price alerts");
    expect(items[1]?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Price alerts",
    );
    await userEvent.click(items[0] as HTMLElement);
    expect(location.pathname).toBe("/s/s1/r/r1");
  });

  it("a helper spawned during a task shows on its task row", () => {
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
    const track = screen.getByRole("region", { name: "Phase track" });
    expect(
      within(track).getByRole("link", {
        name: "Endpoint to save an alert, in progress",
      }),
    ).toBeTruthy();
    const helpers = screen.getByRole("region", { name: "Helpers" });
    expect(helpers.querySelector(".hl-n")?.textContent).toBe("tests");
    expect(req.agents).toHaveLength(1);
  });

  it("a finished inferred request says what it did instead of a stale now", () => {
    const view = session();
    view.requests[1] = request({
      planInferred: true,
      finished: true,
      state: "done",
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
      state: "done",
      tally: { helpers: 0, files: 0, commands: 0 },
      agents: [running("a1"), { ...running("a2"), status: "done" }],
    });
    show(view);
    expect(within(screen.getByRole("banner")).getByText("Done")).toBeTruthy();
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Nothing changed")).toBeTruthy();
    expect(now.textContent).not.toContain("still running");
  });

  it("the top bar's pill says core's state: left open is quiet, failed is red", () => {
    const view = session();
    view.requests[1] = request({ finished: true, state: "left-open" });
    show(view);
    const bar = within(screen.getByRole("banner"));
    expect(bar.queryByText("Done")).toBeNull();
    expect(bar.getByText("Left open").closest(".state-pill")?.className).toBe(
      "state-pill open",
    );
    cleanup();
    view.requests[1] = request({ finished: true, state: "failed" });
    show(view);
    expect(
      within(screen.getByRole("banner"))
        .getByText("Failed")
        .closest(".state-pill")?.className,
    ).toBe("state-pill failed");
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

  it("the Files tab shows 8 newest first, readable paths, then Show all N", async () => {
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
        requestId="r2"
        tab="files"
        view={view}
        events={events}
        status="live"
        lastLooked={null}
      />,
    );
    const now = screen.getByRole("region", { name: "Outside any task" });
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
      <Live sessionId="s1" view={null} status="loading" lastLooked={null} />,
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
