import type { Journey, RequestView, SessionView } from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayLabel } from "../src/live/Rail";
import { Live } from "../src/pages/Session";
import { clock } from "../src/story";

/** Noon UTC on a November day, the same calendar day in any time zone a test runs in. */
const day = (d: number, min = 0) =>
  new Date(Date.UTC(2026, 10, d, 12, min)).toISOString();
const when = (iso: string) => `${dayLabel(iso)} ${clock(iso)}`;

function request(r: Partial<RequestView> & { id: string }): RequestView {
  return {
    prompt: "do it",
    startedAt: day(2),
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
    state: "done",
    ...r,
  };
}

const journey = (j: Partial<Journey> = {}): Journey => ({
  chapters: [
    { title: "Why it feels mid", requestIds: ["r1", "r2"], state: "done" },
    {
      title: "Phase 3: chat screens",
      requestIds: ["r3", "r4"],
      state: "running",
    },
  ],
  pauses: [
    { after: "r2", from: day(2, 40), to: day(6), inside: false },
    { after: "r3", from: day(6, 20), to: day(6, 140), inside: true },
  ],
  decisions: [
    { ts: day(6), requestId: "r3", text: "Yes please go ahead", by: "user" },
    {
      ts: day(6, 10),
      requestId: "r3",
      text: "Lit plate chosen over Departure board and Quiet.",
      by: "claude",
    },
  ],
  totals: { helpers: 136, files: 527, commands: 7269, sentBack: 24, pauses: 2 },
  ...j,
});

function session(s: Partial<SessionView> = {}, r4: Partial<RequestView> = {}) {
  const view: SessionView = {
    sessionId: "s1",
    cwd: "/x/tradara-stock-screener",
    title: "Bro we recently made Alphatake, and now…",
    startedAt: day(2),
    lastEventAt: day(9, 40),
    ended: false,
    needsYou: null,
    requests: [
      request({
        id: "r1",
        startedAt: day(2),
        kind: "question",
        prompt:
          "Bro we recently made Alphatake, and now tradara.in UI is mid ngl",
        goal: "Compare tradara.in's UI with Alphatake and say why it feels mid",
        outcome: "Half agree, bro.",
        phases: [
          {
            id: "p",
            title: "Look",
            status: "done",
            tasks: [
              { id: "1", title: "One", status: "done", agents: [] },
              { id: "2", title: "Two", status: "done", agents: [] },
            ],
          },
        ],
      }),
      request({
        id: "r2",
        startedAt: day(2, 30),
        kind: "question",
        goal: "Review the internal pages",
        outcome: "Landing page stays as it is, then.",
        state: "left-open",
      }),
      request({
        id: "r3",
        startedAt: day(6),
        goal: "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
        outcome: "Phase 0 is finished.",
        tally: { helpers: 32, files: 102, commands: 900 },
        phases: [
          {
            id: "p0",
            title: "Phase 0",
            status: "now",
            tasks: [
              { id: "1", title: "One", status: "done", agents: [] },
              { id: "2", title: "Two", status: "todo", agents: [] },
            ],
          },
        ],
      }),
      request({
        id: "r4",
        startedAt: day(9),
        goal: "Restart the two stopped Phase 3 jobs and publish a new live tracker",
        outcome: "Task 39 passed after two fix rounds.",
        finished: false,
        state: "running",
        tally: { helpers: 8, files: 14, commands: 198 },
        ...r4,
      }),
    ],
    journey: journey(),
    ...s,
  };
  return view;
}

function show(view: SessionView, requestId?: string) {
  return render(
    <Live
      sessionId="s1"
      view={view}
      status="live"
      lastLooked={null}
      {...(requestId ? { requestId } : {})}
    />,
  );
}

const main = () => screen.getByRole("main");
const ends = () => screen.getByRole("group", { name: "From here to here" });
const line = () => document.querySelector(".jr-line") as HTMLElement;
const station = (n: number) =>
  line().querySelectorAll<HTMLElement>(".jr-st")[n - 1] as HTMLElement;

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
});

describe("the session page is the journey", () => {
  it("shows the session's name and the journey, not the newest request", () => {
    show(session());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Bro we recently made Alphatake, and now…",
    );
    expect(ends()).toBeTruthy();
    expect(main().querySelector(".req-story")).toBeNull();
    // The rail marks the session as the page, no request as current.
    const rail = screen.getByRole("complementary", { name: "This session" });
    expect(rail.querySelector(".rail-sess")?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(rail.querySelector(".stop.cur")).toBeNull();
  });

  it("waits for every page of events before drawing the journey", () => {
    // The first pages hold only the early requests: a journey drawn from them names the
    // wrong "where it is now" and rises its stations in twice.
    const { container, rerender } = render(
      <Live
        sessionId="s1"
        view={session()}
        status="loading"
        lastLooked={null}
      />,
    );
    expect(container.querySelector(".jr")).toBeNull();
    expect(container.querySelector(".skeleton")).toBeTruthy();
    rerender(
      <Live sessionId="s1" view={session()} status="live" lastLooked={null} />,
    );
    expect(container.querySelector(".jr")).toBeTruthy();
  });

  it("a request's own page still shows that request", () => {
    show(session(), "r3");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Restyle the logged-in app",
    );
    expect(document.querySelector(".jr")).toBeNull();
  });

  it("says where the session ran and over which days", () => {
    show(session());
    const over = main().querySelector(".jr-over") as HTMLElement;
    expect(over.textContent).toContain("tradara-stock-screener");
    expect(over.textContent).toContain(
      `${dayLabel(day(2))} to ${dayLabel(day(9))}`,
    );
  });
});

describe("from here to here", () => {
  it("starts at the first prompt as typed, with its day, time and kind", () => {
    show(session());
    const from = within(ends()).getAllByRole("link")[0] as HTMLElement;
    expect(from.textContent).toContain(
      "Bro we recently made Alphatake, and now tradara.in UI is mid ngl",
    );
    expect(from.textContent).toContain(`${dayLabel(day(2))}, ${clock(day(2))}`);
    expect(from.textContent).toContain("Question");
    expect(from.textContent).toContain("Half agree, bro.");
    expect(from.getAttribute("href")).toBe("/s/s1/r/r1");
  });

  it("ends at the live request's outcome, time and state, amber only when waiting", () => {
    show(session());
    const to = within(ends()).getAllByRole("link")[1] as HTMLElement;
    expect(to.textContent).toContain("Task 39 passed after two fix rounds.");
    expect(to.textContent).toContain("Where it is now");
    expect(to.textContent).toMatch(/Request 4, running/);
    expect(to.getAttribute("href")).toBe("/s/s1/r/r4");
    expect(to.querySelector(".jr-need")).toBeNull();
    expect(to.textContent).not.toMatch(/wait on you/);
  });

  it("counts what waits on you in amber when Claude asked", () => {
    show(
      session(
        {},
        { state: "waiting", waiting: ["Ship it?", "Keep the old one?"] },
      ),
    );
    const to = within(ends()).getAllByRole("link")[1] as HTMLElement;
    expect(to.querySelector(".jr-need")?.textContent).toBe(
      "2 things wait on you",
    );
  });

  it("the header says waiting on you, not running, for a request that waits", () => {
    show(session({}, { state: "waiting" }));
    const facts = screen.getByRole("group", { name: "Summary" });
    expect(facts.textContent).toMatch(/1 waiting on you/);
    expect(facts.textContent).not.toMatch(/running now/);
  });

  it("says where it ended once nothing runs", () => {
    show(session({ ended: true }, { state: "done", finished: true }));
    const to = within(ends()).getAllByRole("link")[1] as HTMLElement;
    expect(to.textContent).toContain("Where it ended");
    expect(to.textContent).toMatch(/Request 4, done/);
  });

  it("joins the two with the days and requests between", () => {
    show(session());
    expect(ends().querySelector(".jr-join")?.textContent).toBe(
      "7 days · 4 requests",
    );
  });
});

describe("totals", () => {
  it("shows helpers, files, commands, tasks sent back and pauses as figures", () => {
    show(session());
    const list = screen.getByRole("list", { name: "Totals" });
    const items = [...list.querySelectorAll("li")].map((li) => [
      li.querySelector(".num")?.textContent,
      li.querySelector(".jr-tot-l")?.textContent,
    ]);
    expect(items).toEqual([
      ["136", "helpers ran"],
      ["527", "files changed"],
      ["7,269", "commands run"],
      ["24", "tasks sent back after review"],
      ["2", "pauses over an hour, the longest 3 days"],
    ]);
  });

  it("leaves out a zero: it says nothing", () => {
    const totals = {
      helpers: 3,
      files: 12,
      commands: 158,
      sentBack: 0,
      pauses: 0,
    };
    show(session({ journey: journey({ totals, pauses: [] }) }));
    const list = screen.getByRole("list", { name: "Totals" });
    expect(
      [...list.querySelectorAll(".jr-tot-l")].map((l) => l.textContent),
    ).toEqual(["helpers ran", "files changed", "commands run"]);
  });
});

describe("chapters", () => {
  it("draws a segment per chapter sized by its requests, the live one lit", () => {
    show(session());
    const nav = screen.getByRole("navigation", { name: "Chapters" });
    const segs = [...nav.querySelectorAll<HTMLAnchorElement>("a")];
    expect(segs.map((a) => a.textContent)).toEqual([
      "1. Why it feels midRequests 1 to 2",
      "2. Phase 3: chat screensRequests 3 to 4",
    ]);
    const li = (a: HTMLElement) => a.closest("li") as HTMLElement;
    expect(segs.map((a) => li(a).style.getPropertyValue("--w"))).toEqual([
      "2",
      "2",
    ]);
    expect(segs[0]?.className).toContain("done");
    expect(segs[1]?.className).toContain("live");
    expect(segs[1]?.getAttribute("aria-current")).toBe("step");
  });

  it("each segment scrolls to its chapter on the line", () => {
    show(session());
    const nav = screen.getByRole("navigation", { name: "Chapters" });
    const href = nav.querySelectorAll("a")[1]?.getAttribute("href") ?? "";
    expect(href).toBe("#chapter-2");
    const target = document.getElementById("chapter-2") as HTMLElement;
    expect(line().contains(target)).toBe(true);
    expect(target.querySelector("h2")?.textContent).toBe(
      "2. Phase 3: chat screens",
    );
  });

  it("a chapter's header sits on the line with its requests", () => {
    show(session());
    const ch = document.getElementById("chapter-1") as HTMLElement;
    expect(ch.querySelector(".jr-ch-meta")?.textContent).toMatch(
      /^2 requests · /,
    );
    expect(ch.querySelectorAll(".jr-st")).toHaveLength(2);
  });
});

describe("the line", () => {
  it("draws each request as a station card linking to it", () => {
    show(session());
    const s = station(3);
    const card = s.querySelector("a.jr-card") as HTMLAnchorElement;
    expect(card.getAttribute("href")).toBe("/s/s1/r/r3");
    expect(card.hasAttribute("data-morph")).toBe(true);
    expect(card.querySelector(".label-chip")?.textContent).toBe("Feature");
    expect(card.querySelector(".jr-card-ttl")?.textContent).toBe(
      "Restyle the logged-in app to the Lit plate design, then speed up My Agents",
    );
    expect(card.querySelector(".jr-out")?.textContent).toBe(
      "Phase 0 is finished.",
    );
    const figs = [...card.querySelectorAll(".jr-fig")].map((f) => [
      f.querySelector(".num")?.textContent,
      f.querySelector(".jr-fig-l")?.textContent,
    ]);
    expect(figs.map((f) => f[1])).toEqual([
      "took",
      "helpers",
      "files",
      "tasks",
    ]);
    expect(figs.slice(1)).toEqual([
      ["32", "helpers"],
      ["102", "files"],
      ["1/2", "tasks"],
    ]);
    // The load bar is the share of the busiest request's helpers.
    const bar = card.querySelector<HTMLElement>(".jr-load i");
    expect(bar?.style.width).toBe("100%");
    const small = station(4).querySelector<HTMLElement>(".jr-load i");
    expect(small?.style.width).toBe("25%");
    expect(station(1).querySelector(".jr-load")).toBeNull();
  });

  it("marks each station on the line in the rail's shapes", () => {
    show(session());
    const marks = [1, 2, 3, 4].map(
      (n) => station(n).querySelector(".jr-dot .mk")?.className,
    );
    expect(marks).toEqual([
      "mk done",
      "mk open",
      "mk done",
      "mk running pulse",
    ]);
  });

  it("says running on the running station's outcome", () => {
    show(session());
    expect(station(4).querySelector(".jr-out")?.textContent).toBe(
      "Running · Task 39 passed after two fix rounds.",
    );
  });

  it("puts a pause between requests on the line as a dashed beat", () => {
    show(session());
    const beat = line().querySelector(".jr-pause") as HTMLElement;
    expect(beat.textContent).toBe(
      `3 days away. Nothing ran between ${when(day(2, 40))} and ${when(day(6))}.`,
    );
    // It sits after request 2, before request 3.
    const items = [...line().querySelectorAll(".jr-st, .jr-pause")];
    expect(items.indexOf(beat)).toBe(2);
  });

  it("puts a pause inside a request on its card as one quiet line", () => {
    show(session());
    expect(station(3).querySelector(".jr-quiet")?.textContent).toBe(
      `Paused 2 h 00 m, ${when(day(6, 20))} to ${clock(day(6, 140))}.`,
    );
    expect(line().querySelectorAll(".jr-pause")).toHaveLength(1);
  });

  it("puts decisions between stations as pills", () => {
    show(session());
    const pills = [...line().querySelectorAll<HTMLElement>(".jr-dec")];
    expect(pills.map((p) => p.textContent)).toEqual([
      "You approved: “Yes please go ahead”",
      "Lit plate chosen over Departure board and Quiet.",
    ]);
    const order = [...line().querySelectorAll(".jr-st, .jr-dec")];
    // The approval opens request 3; Claude's choice came during it.
    expect(order.indexOf(pills[0] as HTMLElement)).toBe(2);
    expect(order.indexOf(station(3))).toBe(3);
    expect(order.indexOf(pills[1] as HTMLElement)).toBe(4);
  });

  it("a one-question session where nothing ran: one station, no strip, beats or pills", () => {
    const view = session({
      requests: [request({ id: "r1", kind: "question", prompt: "Why?" })],
      journey: journey({
        chapters: [{ title: "Why?", requestIds: ["r1"], state: "done" }],
        pauses: [],
        decisions: [],
        totals: { helpers: 0, files: 0, commands: 0, sentBack: 0, pauses: 0 },
      }),
    });
    show(view);
    expect(line().querySelectorAll(".jr-st")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Chapters" })).toBeNull();
    expect(line().querySelector(".jr-pause, .jr-dec, .jr-load")).toBeNull();
    expect(ends().textContent).toContain("Where it ended");
    expect(document.querySelector(".mk.pulse")).toBeNull();
  });

  it("works for a view built before core had a journey", () => {
    const view = session();
    delete view.journey;
    show(view);
    expect(line().querySelectorAll(".jr-st")).toHaveLength(4);
    expect(screen.queryByRole("navigation", { name: "Chapters" })).toBeNull();
  });
});
