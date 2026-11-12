import type {
  AgentView,
  MurmurEvent,
  PartView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byDay } from "../src/format";
import { Live, roomInJsdom } from "./officeShell";

roomInJsdom();

import type { Tab } from "../src/router";
import { nowLine, requestMark, requestShort, shortOf } from "../src/session";

/** Noon UTC on a November day, the same calendar day in any time zone a test runs in. */
const day = (d: number, min = 0) =>
  new Date(Date.UTC(2026, 10, d, 12, min)).toISOString();

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
    startedAt: day(6, 10),
    ...a,
  };
}

function request(r: Partial<RequestView> & { id: string }): RequestView {
  return {
    prompt: "do it",
    startedAt: day(6),
    kind: "feature",
    kindInferred: false,
    goal: "",
    phases: [],
    planInferred: false,
    parts: [],
    looseFiles: [],
    now: null,
    agents: [],
    assumptions: [],
    flags: [],
    finished: true,
    tally: { helpers: 0, files: 0, commands: 0 },
    messages: [],
    ...r,
  };
}

const done = (id: string) => task(id, `Task ${id}`, "done");

/** Mon 2 Nov: two requests, one done and one left open. Fri 6 Nov: one failed, one running. */
function session(s: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "s1",
    cwd: "/x/tradara",
    title: "Bro we recently made Alphatake, and now…",
    startedAt: day(2),
    lastEventAt: day(9, 40),
    ended: false,
    needsYou: null,
    requests: [
      request({
        id: "r1",
        startedAt: day(2),
        goal: "Compare tradara.in's UI with Alphatake and say why it feels mid",
        phases: [
          { id: "p", title: "Look", status: "done", tasks: [done("1")] },
        ],
      }),
      request({
        id: "r2",
        startedAt: day(2, 30),
        goal: "Review the internal pages: which look mid next to the landing page",
        phases: [
          {
            id: "p",
            title: "Review",
            status: "now",
            tasks: [done("1"), task("2", "Second look", "todo")],
          },
        ],
      }),
      request({
        id: "r3",
        startedAt: day(6),
        goal: "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
        phases: [
          {
            id: "p0",
            title: "Phase 0: foundation",
            status: "done",
            tasks: [
              task("1", "Task 1: Lit plate tokens", "done", {
                part: "tokens",
                agents: ["b1"],
              }),
              task("2", "Task 2: HeroMoney", "failed", { part: "money" }),
            ],
          },
        ],
        parts: [
          part({
            id: "tokens",
            title: "Lit plate tokens",
            phase: "p0",
            status: "done",
            agents: ["b1"],
            files: [
              {
                path: "src/styles/index.css",
                added: 22,
                removed: 6,
                isNew: false,
                eventIds: [],
              },
            ],
          }),
          part({ id: "money", title: "HeroMoney", phase: "p0" }),
        ],
        looseFiles: [
          {
            path: "notes.md",
            added: 3,
            removed: 0,
            isNew: true,
            eventIds: [],
          },
        ],
        agents: [
          helper("b1", {
            description: "Build Task 1: Lit plate tokens",
            part: "tokens",
            endedAt: day(6, 16),
            report: {
              status: "completed",
              summary: "",
              text: "Status: DONE_WITH_CONCERNS",
              verdict: "DONE_WITH_CONCERNS",
              ts: day(6, 16),
              interim: false,
            },
          }),
          helper("b2", { description: "Look around", endedAt: day(6, 12) }),
        ],
        tally: { helpers: 2, files: 2, commands: 9 },
      }),
      request({
        id: "r4",
        startedAt: day(9),
        goal: "Restart the two stopped Phase 3 jobs and publish a new live tracker under the admin account",
        finished: false,
        now: { text: "Second fix round on Task 39", why: "", ts: day(9, 30) },
        agents: [helper("c1", { status: "running", startedAt: day(9, 20) })],
        tally: { helpers: 3, files: 14, commands: 198 },
      }),
    ],
    ...s,
  };
}

function show(
  view: SessionView,
  p: {
    requestId?: string;
    partId?: string;
    tab?: Tab;
    events?: MurmurEvent[];
  } = {},
) {
  const props = {
    sessionId: "s1",
    view,
    status: "live" as const,
    lastLooked: null,
    events: p.events ?? [],
    ...(p.requestId ? { requestId: p.requestId } : {}),
    ...(p.partId ? { partId: p.partId } : {}),
    ...(p.tab ? { tab: p.tab } : {}),
  };
  const out = render(<Live {...props} />);
  return {
    ...out,
    again: (q: typeof p) =>
      out.rerender(
        <Live
          {...props}
          {...(q.requestId ? { requestId: q.requestId } : {})}
          {...(q.partId ? { partId: q.partId } : { partId: undefined })}
          {...(q.tab ? { tab: q.tab } : {})}
        />,
      ),
  };
}

const rail = () => screen.getByRole("complementary", { name: "Requests rail" });
const requests = () =>
  within(rail()).getByRole("navigation", { name: "Requests" });
const bar = () => document.querySelector("header.of-top") as HTMLElement;
const crumbs = () =>
  screen
    .getByRole("navigation", { name: "Where you are" })
    .querySelectorAll("li");

beforeEach(() => {
  history.pushState(null, "", "/s/s1");
  // A desktop window: the requests rail sits beside the room from 1200 px.
  vi.stubGlobal("innerWidth", 1600);
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("short titles", () => {
  it("cut the goal at its first comma, colon or dash, then near 32 characters at a word", () => {
    expect(
      shortOf(
        "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
      ),
    ).toBe("Restyle the logged-in app to the…");
    expect(shortOf("Phase 2: the agent page")).toBe("Phase 2");
    expect(shortOf("Plan the build - then start")).toBe("Plan the build");
    const emDash = String.fromCharCode(0x2014);
    expect(shortOf(`Plan the build ${emDash} then start`)).toBe(
      "Plan the build",
    );
    expect(shortOf("Fix the login form.")).toBe("Fix the login form");
    expect(shortOf("a".repeat(40))).toBe(`${"a".repeat(32)}…`);
  });

  it("prefer core's short title, and fall back to the prompt", () => {
    const r = request({ id: "x", goal: "A long goal, with a clause" });
    expect(requestShort(r)).toBe("A long goal");
    expect(requestShort({ ...r, short: "Restart jobs" } as RequestView)).toBe(
      "Restart jobs",
    );
    expect(requestShort(request({ id: "y", prompt: "why is it slow" }))).toBe(
      "why is it slow",
    );
  });
});

describe("the requests rail", () => {
  it("groups the requests by the day they were asked, numbered in order", () => {
    expect(byDay(session().requests).map((d) => d.label)).toEqual([
      "Mon 2 Nov",
      "Fri 6 Nov",
      "Mon 9 Nov",
    ]);
    show(session());
    const days = within(requests()).getAllByRole("heading", { level: 3 });
    expect(days.map((d) => d.textContent)).toEqual([
      "Mon 2 Nov",
      "Fri 6 Nov",
      "Mon 9 Nov",
    ]);
    const first = days[0]?.nextElementSibling as HTMLElement;
    expect(within(first).getAllByRole("link")).toHaveLength(2);
  });

  it("names the session with its facts, the title a switcher of sessions", () => {
    show(session());
    expect(
      within(rail()).getByText("4 requests · 5 helpers · 7 days"),
    ).toBeTruthy();
    expect(
      within(bar()).getByRole("button", { name: /^Session: Bro we recently/ }),
    ).toBeTruthy();
  });

  it("shows each request as a link with its number and short title, the full one on hover", () => {
    show(session(), { requestId: "r3" });
    const row = within(requests()).getByRole("link", { name: /^3/ });
    // A pinned floor's link; the panel keeps the request's tab.
    expect(row.getAttribute("href")).toBe("/s/s1/r/r3?open=story");
    expect(row.getAttribute("title")).toBe(
      "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
    );
    expect(row.querySelector(".of-rl-t")?.textContent).toBe(
      "3Restyle the logged-in app to the…",
    );
    // The floor Claude is on is the session's own address.
    const last = within(requests()).getByRole("link", { name: /^4/ });
    expect(last.getAttribute("href")).toBe("/s/s1?open=story");
  });

  it("marks each state by shape, colour and word", () => {
    const view = session();
    const marks = view.requests.map((r) => requestMark(view, r, []).mark);
    expect(marks).toEqual(["done", "open", "failed", "running"]);
    show(view, { requestId: "r1" });
    const rows = within(requests()).getAllByRole("link");
    expect(rows.map((r) => r.querySelector(".mk")?.className)).toEqual([
      "mk done",
      "mk open",
      "mk failed",
      "mk running",
    ]);
    // Done gets a check, failed a cross; the word is always there for a screen reader.
    expect(rows[0]?.querySelector(".mk svg path")?.getAttribute("d")).toContain(
      "M2 5.4",
    );
    expect(rows[2]?.querySelector(".mk svg path")?.getAttribute("d")).toContain(
      "m3 3",
    );
    expect(rows[1]?.textContent).toContain(", Left open");
    expect(rows[2]?.textContent).toContain(", Failed");
    // The running one says so in its line, with how long and its helpers.
    expect(rows[3]?.querySelector(".of-rl-sub")?.textContent).toMatch(
      /^Running · .* · 3 helpers$/,
    );
  });

  it("an amber question mark when Claude waits on you", () => {
    const view = session({
      needsYou: { reason: "question", text: "Which one?", since: day(9, 35) },
    });
    view.requests[3] = { ...(view.requests[3] as RequestView), agents: [] };
    expect(requestMark(view, view.requests[3] as RequestView, []).mark).toBe(
      "waiting",
    );
    show(view);
    const row = within(requests()).getAllByRole("link")[3] as HTMLElement;
    expect(row.querySelector(".mk")?.className).toBe("mk waiting");
    expect(row.querySelector(".mk")?.textContent).toBe("?");
    expect(row.querySelector(".of-rl-sub")?.textContent).toMatch(
      /^Waiting on you/,
    );
  });

  it("prefers core's request state when it gives one", () => {
    const view = session();
    const r = { ...(view.requests[0] as RequestView), state: "failed" };
    expect(requestMark(view, r as RequestView, []).mark).toBe("failed");
  });

  it("shows core's left-open state as the open mark", () => {
    const view = session();
    const r: RequestView = {
      ...(view.requests[0] as RequestView),
      state: "left-open",
    };
    expect(requestMark(view, r, []).mark).toBe("open");
  });

  it("highlights the request on the floor, and only that one", () => {
    show(session(), { requestId: "r3" });
    const rows = within(requests()).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
      null,
    ]);
    expect(rows[2]?.className).toContain("cur");
  });

  it("on the session's journey the floor is still Claude's request", () => {
    show(session());
    const rows = within(requests()).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "true",
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Bro we recently made Alphatake, and now…",
    );
    expect(location.pathname).toBe("/s/s1");
  });

  it("moves to a request on click, and stays the same rail there", async () => {
    const { again } = show(session(), { requestId: "r4" });
    const before = rail();
    await userEvent.click(within(requests()).getByRole("link", { name: /^1/ }));
    expect(location.pathname + location.search).toBe("/s/s1/r/r1?open=story");
    again({ requestId: "r1" });
    expect(rail()).toBe(before);
  });

  it("folds away, and remembers it", async () => {
    show(session());
    const fold = within(rail()).getByRole("button", {
      name: "Fold the requests rail",
    });
    await userEvent.click(fold);
    expect(within(rail()).queryByRole("navigation")).toBeNull();
    expect(localStorage.getItem("murmur:rail")).toBe("shut");
    await userEvent.click(
      within(rail()).getByRole("button", { name: "Show the requests rail" }),
    );
    expect(requests()).toBeTruthy();
    localStorage.removeItem("murmur:rail");
  });

  it("does not scroll back to the shown request when a new request arrives", () => {
    const into = vi.fn();
    const saved = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = into;
    try {
      const view = session();
      const props = {
        sessionId: "s1",
        status: "live" as const,
        lastLooked: null,
        requestId: "r1",
      };
      const { rerender } = render(<Live {...props} view={view} />);
      const placed = into.mock.contexts.filter((el) =>
        requests().contains(el as Node),
      ).length;
      expect(placed).toBeGreaterThan(0);
      // The reader scrolls the rail to look at other requests, then a new one arrives.
      const more = {
        ...view,
        requests: [
          ...view.requests,
          request({ id: "r5", startedAt: day(9, 50), goal: "One more thing" }),
        ],
      };
      rerender(<Live {...props} view={more} />);
      expect(
        into.mock.contexts.filter((el) => requests().contains(el as Node)),
      ).toHaveLength(placed);
    } finally {
      Element.prototype.scrollIntoView = saved;
    }
  });
});

describe("under 1200 px the rail folds into the request picker", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1024);
  });
  const picker = () =>
    within(bar()).getByRole("button", { name: /^Request 3 of 4: Restyle/ });

  it("has no rail; the picker lists every request and moves to one", async () => {
    show(session(), { requestId: "r3" });
    expect(
      screen.queryByRole("complementary", { name: "Requests rail" }),
    ).toBeNull();
    expect(picker().getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(picker());
    expect(picker().getAttribute("aria-expanded")).toBe("true");
    const list = within(bar()).getByRole("navigation", { name: "Requests" });
    expect(within(list).getAllByRole("link")).toHaveLength(4);
    await userEvent.click(within(list).getByRole("link", { name: /^1/ }));
    expect(location.pathname + location.search).toBe("/s/s1/r/r1?open=story");
    expect(within(bar()).queryByRole("navigation", { name: "Requests" })).toBe(
      null,
    );
  });

  it("Escape closes the picker, not the panel", async () => {
    show(session(), { requestId: "r3" });
    await userEvent.click(picker());
    await userEvent.keyboard("{Escape}");
    expect(within(bar()).queryByRole("navigation", { name: "Requests" })).toBe(
      null,
    );
    expect(document.activeElement).toBe(picker());
    expect(location.search).toBe("");
  });
});

describe("the panel's breadcrumb", () => {
  const levels = () =>
    [...crumbs()].map((li) => ({
      text: li.textContent,
      href: li.querySelector("a")?.getAttribute("href") ?? null,
    }));

  it("on the session's views: the session", () => {
    show(session());
    expect(levels()).toEqual([
      {
        text: "Session · Bro we recently made Alphatake, and now…",
        href: null,
      },
    ]);
  });

  it("on a request: the session, then the request's number and short title", () => {
    show(session(), { requestId: "r3" });
    expect(levels()).toEqual([
      { text: "Session", href: "/s/s1/r/r3?open=journey" },
      { text: "Request 3 · Restyle the logged-in app to the…", href: null },
    ]);
    const here = crumbs()[1]?.querySelector("[aria-current]");
    expect(here?.getAttribute("title")).toBe(
      "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
    );
  });

  it("on a task: the session, the request and the task", () => {
    show(session(), { requestId: "r3", partId: "tokens" });
    expect(levels()).toEqual([
      { text: "Session", href: "/s/s1/r/r3?open=journey" },
      { text: "Request 3", href: "/s/s1/r/r3?open=story" },
      { text: "Task 1 · Lit plate tokens", href: null },
    ]);
    expect(
      crumbs()[2]
        ?.querySelector("[aria-current]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  it("each level but the last is a link that moves there, inside the office", async () => {
    show(session(), { requestId: "r3", partId: "tokens" });
    await userEvent.click(
      within(
        screen.getByRole("navigation", { name: "Where you are" }),
      ).getByRole("link", { name: "Request 3" }),
    );
    expect(location.pathname + location.search).toBe("/s/s1/r/r3?open=story");
  });
});

describe("the top bar", () => {
  it("running: the now line and Running with how long", () => {
    vi.useFakeTimers({ now: new Date(day(9, 45)), toFake: ["Date"] });
    show(session());
    const b = within(bar());
    expect(
      within(b.getByRole("region", { name: "Now" })).getByText(
        "Second fix round on Task 39",
      ),
    ).toBeTruthy();
    const pill = bar().querySelector(".of-pill");
    expect(pill?.className).toBe("of-pill s-now");
    expect(pill?.textContent).toBe("Running · 45 m");
    expect(b.queryByText(/waiting on you/i)).toBeNull();
  });

  it("done: Done, and how long it took from its ask to its last word", () => {
    const view = session();
    // Core's state: its failed task alone would make the pill say Failed.
    const r3 = view.requests[2] as RequestView;
    view.requests[2] = { ...r3, state: "done" };
    show(view, {
      requestId: "r3",
      events: [
        {
          id: "e1",
          sessionId: "s1",
          machineId: "m",
          cwd: "/x",
          ts: new Date(
            Date.parse(day(6)) + (3 * 60 + 6) * 60_000,
          ).toISOString(),
          hook: "Stop",
          payload: {},
        },
      ],
    });
    const pill = bar().querySelector(".of-pill");
    expect(pill?.className).toBe("of-pill s-done");
    expect(pill?.textContent).toBe("Done · 3 h 06 m");
    // The panel's clock for it stops at its own end, not the session's last event.
    expect(
      screen.getByRole("complementary", { name: "Details" }).textContent,
    ).toMatch(/3 h 06 m/);
  });

  it("waiting: the pill says Waiting on you and for how long", () => {
    vi.useFakeTimers({ now: new Date(day(9, 39)), toFake: ["Date"] });
    const view = session({
      needsYou: { reason: "question", text: "Which?", since: day(9, 35) },
    });
    view.requests[3] = {
      ...(view.requests[3] as RequestView),
      // Core says it waits; the room walks Claude to your door.
      state: "waiting",
      agents: [],
      messages: [
        {
          id: "m1",
          ts: day(9, 34),
          text: "Two things for you:\n\n- Should I merge it?\n- Do you want the preview link?",
        },
      ],
    };
    show(view);
    const pill = bar().querySelector(".of-pill");
    expect(pill?.className).toBe("of-pill s-blocked");
    expect(pill?.textContent).toBe("Waiting on you · 5 m · 2 questions");
  });

  it("waiting with helpers at work: the bar says they are still working", () => {
    vi.useFakeTimers({ now: new Date(day(9, 39)), toFake: ["Date"] });
    const view = session({
      needsYou: { reason: "input", text: "Sign in", since: day(9, 35) },
    });
    view.requests[3] = {
      ...(view.requests[3] as RequestView),
      state: "waiting",
      agents: [helper("h1", { status: "running", startedAt: day(9, 20) })],
    };
    show(view);
    expect(bar().querySelector(".of-pill")?.textContent).toMatch(
      /^Waiting on you/,
    );
    expect(bar().textContent).toContain("1 helper at work");
  });

  it("the now line never shows a raw command or a raw tool name", () => {
    const req = request({
      id: "r",
      finished: false,
      now: {
        text: "Running cd /Users/x && pnpm vitest run",
        why: "",
        ts: day(6),
        inferred: true,
      },
    });
    expect(nowLine(req, [], false).text).toBe("Running a command");
    const mcp = {
      ...req,
      now: {
        text: "Using mcp__plugin_claude-in-chrome__browser_batch",
        why: "",
        ts: day(6),
        inferred: true,
      },
    };
    expect(nowLine(mcp, [], false).text).not.toContain("mcp__");
    const view = session();
    view.requests[3] = { ...(view.requests[3] as RequestView), now: req.now };
    show(view);
    const now = within(bar()).getByRole("region", { name: "Now" });
    expect(now.textContent).toContain("Running a command");
    expect(now.textContent).not.toContain("pnpm");
  });

  it("the menu holds the account links and delete", async () => {
    show(session());
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
    const menu = within(bar()).getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(bar()).getByRole("button", { name: "Delete session" }),
    ).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
  });

  it("the brand goes to the lobby", () => {
    show(session());
    expect(
      within(bar()).getByRole("link", { name: "Murmur" }).getAttribute("href"),
    ).toBe("/");
  });
});

describe("the panel's tabs", () => {
  const tabs = () => screen.getByRole("navigation", { name: "This request" });

  it("are links with their own URLs inside the office, the shown one current", () => {
    show(session(), { requestId: "r3", tab: "files" });
    const links = within(tabs()).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Story", "/s/s1/r/r3?open=story"],
      ["Tasks", "/s/s1/r/r3?open=tasks"],
      ["Flow", "/s/s1/r/r3?open=flow"],
      ["Files", "/s/s1/r/r3?open=files"],
      ["Helpers", "/s/s1/r/r3?open=helpers"],
    ]);
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "page",
      null,
    ]);
    const session_ = within(
      screen.getByRole("navigation", { name: "This session" }),
    ).getAllByRole("link");
    expect(
      session_.map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Journey", "/s/s1/r/r3?open=journey"],
      ["Timeline", "/s/s1/r/r3?open=timeline"],
      ["Requests", "/s/s1/r/r3?open=requests"],
    ]);
  });

  it("no Story or Map toggle remains", () => {
    show(session(), { requestId: "r3" });
    expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
  });

  it("a tab click moves to its URL", async () => {
    show(session(), { requestId: "r3" });
    await userEvent.click(within(tabs()).getByRole("link", { name: "Flow" }));
    expect(location.pathname + location.search).toBe("/s/s1/r/r3?open=flow");
  });

  it("Flow shows the flow board", () => {
    show(session(), { requestId: "r3", tab: "flow" });
    expect(screen.getByRole("region", { name: "Flow" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Plan" })).toBeNull();
  });

  it("Files groups the request's files by part, then the rest", () => {
    show(session(), { requestId: "r3", tab: "files" });
    const groups = [...document.querySelectorAll<HTMLElement>(".file-group")];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Lit plate tokens",
      "Outside any task",
    ]);
    expect(
      within(groups[0] as HTMLElement).getByText("src/styles/index.css"),
    ).toBeTruthy();
  });

  it("Helpers lists every helper with its model, state, time and verdict, each opening its close-up", () => {
    show(session(), {
      requestId: "r3",
      tab: "helpers",
      events: [
        {
          id: "c",
          sessionId: "s1",
          machineId: "m",
          cwd: "/x",
          ts: day(6, 9),
          hook: "PreToolUse",
          payload: {
            tool_name: "Agent",
            tool_input: { prompt: "Brief for b1", model: "sonnet" },
          },
        },
      ],
    });
    const list = screen.getByRole("list", { name: "Helpers" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = items[0] as HTMLElement;
    expect(first.textContent).toContain("Build Task 1: Lit plate tokens");
    expect(first.textContent).toContain("Sonnet");
    expect(first.textContent).toContain("Done");
    expect(first.textContent).toContain("6 m");
    expect(first.textContent).toContain("Done, with concerns");
    expect(within(first).getByRole("link").getAttribute("href")).toBe(
      "/s/s1/r/r3?open=helper:b1",
    );
    // A helper on no task still has its close-up.
    expect(
      within(items[1] as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe("/s/s1/r/r3?open=helper:b2");
  });
});
