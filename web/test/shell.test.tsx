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
import { byDay } from "../src/live/Rail";
import { Live } from "../src/pages/Session";
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
    title: "Bro we recently made Alphatake, and now the UI is mid",
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
    viewAt: () => null,
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

const rail = () => screen.getByRole("complementary", { name: "This session" });
const requests = () =>
  within(rail()).getByRole("navigation", { name: "Requests" });
const bar = () => document.querySelector("header.top") as HTMLElement;
const crumbs = () =>
  within(bar())
    .getByRole("navigation", { name: "Breadcrumb" })
    .querySelectorAll("li");

beforeEach(() => {
  history.pushState(null, "", "/s/s1");
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

describe("the rail", () => {
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

  it("names the session with its facts", () => {
    show(session());
    expect(
      within(rail()).getByText("4 requests · 5 helpers · 7 days"),
    ).toBeTruthy();
    const home = within(rail()).getByRole("link", { name: /Bro we recently/ });
    expect(home.getAttribute("href")).toBe("/s/s1");
  });

  it("shows each request as a link with its number and short title, the full one on hover", () => {
    show(session(), { requestId: "r3" });
    const row = within(requests()).getByRole("link", { name: /^3/ });
    expect(row.getAttribute("href")).toBe("/s/s1/r/r3");
    expect(row.getAttribute("title")).toBe(
      "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
    );
    expect(row.querySelector(".stop-ttl")?.textContent).toBe(
      "3Restyle the logged-in app to the…",
    );
  });

  it("marks each state by shape, colour and word", () => {
    const view = session();
    const marks = view.requests.map((r) => requestMark(view, r, []).mark);
    expect(marks).toEqual(["done", "open", "failed", "running"]);
    show(view);
    const rows = within(requests()).getAllByRole("link");
    expect(rows.map((r) => r.querySelector(".mk")?.className)).toEqual([
      "mk done",
      "mk open",
      "mk failed",
      "mk running pulse",
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
    expect(rows[3]?.querySelector(".stop-sub")?.textContent).toMatch(
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
    expect(row.querySelector(".stop-sub")?.textContent).toMatch(
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

  it("highlights the request on screen, and only that one is the current page", () => {
    show(session(), { requestId: "r3" });
    const rows = within(requests()).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
    ]);
    expect(rows[2]?.className).toContain("cur");
  });

  it("on the session page the newest request is the one shown", () => {
    show(session());
    const rows = within(requests()).getAllByRole("link");
    expect(rows[3]?.className).toContain("cur");
    expect(rows[3]?.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Restart the two stopped Phase 3 jobs and publish a new live tracker under the admin account",
    );
    expect(location.pathname).toBe("/s/s1");
  });

  it("moves to a request on click, and stays the same rail there", async () => {
    const { again } = show(session(), { requestId: "r4" });
    const before = rail();
    await userEvent.click(within(requests()).getByRole("link", { name: /^1/ }));
    expect(location.pathname).toBe("/s/s1/r/r1");
    again({ requestId: "r1" });
    expect(rail()).toBe(before);
  });

  it("does not scroll back to the shown request when a new request arrives", () => {
    // jsdom has no layout: the shown row sits below the list's visible 200 px.
    const box = (el: HTMLElement) => ({
      offsetTop: el.classList.contains("cur") ? 600 : 0,
      offsetHeight: 40,
      clientHeight: 200,
    });
    const keys = ["offsetTop", "offsetHeight", "clientHeight"] as const;
    const saved = keys.map((k) =>
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, k),
    );
    for (const k of keys)
      Object.defineProperty(HTMLElement.prototype, k, {
        configurable: true,
        get(this: HTMLElement) {
          return box(this)[k];
        },
      });
    try {
      const view = session();
      const props = {
        sessionId: "s1",
        viewAt: () => null,
        status: "live" as const,
        lastLooked: null,
        requestId: "r1",
      };
      const { rerender } = render(<Live {...props} view={view} />);
      const list = requests();
      expect(list.scrollTop).toBeGreaterThan(0);
      // The reader scrolls the rail to look at other requests, then a new one arrives.
      list.scrollTop = 0;
      const more = {
        ...view,
        requests: [
          ...view.requests,
          request({ id: "r5", startedAt: day(9, 50), goal: "One more thing" }),
        ],
      };
      rerender(<Live {...props} view={more} />);
      expect(list.scrollTop).toBe(0);
    } finally {
      keys.forEach((k, i) => {
        const d = saved[i];
        if (d) Object.defineProperty(HTMLElement.prototype, k, d);
        else Reflect.deleteProperty(HTMLElement.prototype, k);
      });
    }
  });
});

describe("the breadcrumb", () => {
  const levels = () =>
    [...crumbs()].map((li) => ({
      text: li.textContent,
      href: li.querySelector("a")?.getAttribute("href") ?? null,
    }));

  it("on the session page: Sessions, then the session", () => {
    show(session());
    expect(levels()).toEqual([
      { text: "Sessions", href: "/" },
      { text: "Bro we recently made Alphatake", href: null },
    ]);
  });

  it("on a request: the session, then the request's number and short title", () => {
    show(session(), { requestId: "r3" });
    expect(levels()).toEqual([
      { text: "Bro we recently made Alphatake", href: "/s/s1" },
      { text: "3 · Restyle the logged-in app to the…", href: null },
    ]);
    const here = crumbs()[1]?.querySelector("[aria-current]");
    expect(here?.getAttribute("title")).toBe(
      "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
    );
  });

  it("on a task: the session, the request, the phase and the task", () => {
    show(session(), { requestId: "r3", partId: "tokens" });
    expect(levels()).toEqual([
      { text: "Bro we recently made Alphatake", href: "/s/s1" },
      { text: "3 · Restyle the logged-in app to the…", href: "/s/s1/r/r3" },
      { text: "Phase 0: foundation", href: "/s/s1/r/r3#phase-p0" },
      { text: "Task 1 · Lit plate tokens", href: null },
    ]);
    expect(
      crumbs()[3]
        ?.querySelector("[aria-current]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  it("each level but the last is a link that moves there", async () => {
    show(session(), { requestId: "r3", partId: "tokens" });
    await userEvent.click(
      within(bar()).getByRole("link", { name: /^3 · Restyle/ }),
    );
    expect(location.pathname).toBe("/s/s1/r/r3");
  });
});

describe("the top bar", () => {
  it("running: the now line and Running with how long", () => {
    vi.useFakeTimers({ now: new Date(day(9, 17)), toFake: ["Date"] });
    show(session());
    const b = within(bar());
    expect(
      within(b.getByRole("region", { name: "Now" })).getByText(
        "Second fix round on Task 39",
      ),
    ).toBeTruthy();
    const pill = bar().querySelector(".state-pill");
    expect(pill?.className).toBe("state-pill running");
    expect(pill?.textContent).toBe("Running · 17 m");
    expect(b.queryByText(/waiting on you/)).toBeNull();
  });

  it("done: Done with how long it took, from its ask to its last word", () => {
    const view = session();
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
    const pill = bar().querySelector(".state-pill");
    expect(pill?.className).toBe("state-pill done");
    expect(pill?.textContent).toBe("Done · 3 h 06 m");
  });

  it("waiting: the amber chip counts what waits on you, and the pill says Waiting", () => {
    vi.useFakeTimers({ now: new Date(day(9, 39)), toFake: ["Date"] });
    const view = session({
      needsYou: { reason: "question", text: "Which?", since: day(9, 35) },
    });
    view.requests[3] = {
      ...(view.requests[3] as RequestView),
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
    const chip = within(bar()).getByRole("link", { name: /waiting on you/ });
    expect(chip.textContent).toBe("2 waiting on you4 m");
    expect(chip.className).toBe("need-chip");
    expect(bar().querySelector(".state-pill")?.textContent).toBe(
      "?Waiting · 4 m",
    );
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

  it("the session menu holds the account links and delete", async () => {
    show(session());
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
    const menu = within(bar()).getByRole("button", { name: "Session menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    // A plain disclosure: it holds links and buttons, not an ARIA menu.
    expect(menu.hasAttribute("aria-haspopup")).toBe(false);
    await userEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(bar()).getByRole("button", { name: "Delete session" }),
    ).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
  });
});

describe("the request's tabs", () => {
  const tabs = () =>
    screen.getByRole("navigation", { name: "Views of this request" });

  it("are links with their own URLs, the shown one current", () => {
    show(session(), { requestId: "r3", tab: "files" });
    const links = within(tabs()).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Story", "/s/s1/r/r3"],
      ["Flow", "/s/s1/r/r3/flow"],
      ["Files", "/s/s1/r/r3/files"],
      ["Helpers", "/s/s1/r/r3/helpers"],
    ]);
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
    ]);
  });

  it("no dropdown and no Story or Map toggle remain", () => {
    show(session(), { requestId: "r3" });
    expect(screen.queryByRole("button", { name: /Request \d of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
  });

  it("a tab click moves to its URL", async () => {
    show(session(), { requestId: "r3" });
    await userEvent.click(within(tabs()).getByRole("link", { name: "Flow" }));
    expect(location.pathname).toBe("/s/s1/r/r3/flow");
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

  it("Helpers lists every helper with its model, state, time and verdict, linking to its task", () => {
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
      "/s/s1/r/r3/p/tokens",
    );
    // A helper on no task is listed, not linked.
    expect(within(items[1] as HTMLElement).queryByRole("link")).toBeNull();
  });
});

describe("the drawer under 900 px", () => {
  const toggle = () => within(bar()).getByRole("button", { name: "Requests" });

  it("opens over the page with focus inside it, and Escape closes it", async () => {
    show(session(), { requestId: "r3" });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const drawer = screen.getByRole("dialog", { name: "This session" });
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".col")?.hasAttribute("inert")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("keeps Tab inside while open", async () => {
    show(session(), { requestId: "r3" });
    await userEvent.click(toggle());
    const drawer = screen.getByRole("dialog");
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on a scrim click", async () => {
    show(session(), { requestId: "r3" });
    await userEvent.click(toggle());
    await userEvent.click(document.querySelector(".scrim") as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on navigation", async () => {
    const { again } = show(session(), { requestId: "r3" });
    await userEvent.click(toggle());
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("link", { name: /^1/ }),
    );
    again({ requestId: "r1" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when the request already shown is tapped, focus back on the button", async () => {
    show(session(), { requestId: "r3" });
    history.pushState(null, "", "/s/s1/r/r3");
    await userEvent.click(toggle());
    const cur = within(screen.getByRole("dialog")).getByRole("link", {
      current: "page",
    });
    await userEvent.click(cur);
    expect(location.pathname).toBe("/s/s1/r/r3");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });
});
