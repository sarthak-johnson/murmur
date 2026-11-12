import type { RequestView, SessionView, Thread } from "@murmur/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live, roomInJsdom } from "./officeShell";

roomInJsdom();

import {
  chainOf,
  drawnFollows,
  layoutSessionFlow,
  TITLE_LINE,
  threadsOf,
} from "../src/sflow/sflow";

/** Noon UTC on a November day, plus minutes. */
const day = (d: number, min = 0) =>
  new Date(Date.UTC(2026, 10, d, 12, min)).toISOString();

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

const thread = (t: Partial<Thread> & { id: string; requests: string[] }) =>
  ({
    title: t.id,
    state: "done",
    startedAt: day(2),
    lastAt: day(2),
    inferred: false,
    ...t,
  }) as Thread;

/**
 * Three storylines over six requests: "Ship build 9" (1, 3, 5), "Fix the fonts" (2, 4)
 * and "Disk space" (6). Request 4 picks up from 1 (across threads), 5 from 1 (skipping 3
 * in its own thread), 6 from 5 (across), and 3 from 1, the one just before it in its
 * thread, which draws no link. Three days and more pass between 2 and 3.
 */
function view(s: Partial<SessionView> = {}): SessionView {
  const reqs = [
    request({ id: "r1", startedAt: day(1), short: "Ship build 9" }),
    request({ id: "r2", startedAt: day(1, 20), short: "Fix the fonts" }),
    request({
      id: "r3",
      startedAt: day(5),
      short: "Upload to TestFlight",
      follows: "r1",
      outcome: "Build 9 is uploaded to TestFlight.",
      tally: { helpers: 2, files: 5, commands: 30 },
    }),
    request({
      id: "r4",
      startedAt: day(5, 30),
      short: "Number fonts",
      follows: "r1",
    }),
    request({
      id: "r5",
      startedAt: day(5, 50),
      short: "Build 9 note",
      follows: "r1",
    }),
    request({
      id: "r6",
      startedAt: day(5, 70),
      short: "Free up disk",
      follows: "r5",
      state: "running",
      finished: false,
    }),
  ];
  return {
    sessionId: "s1",
    cwd: "/x/tradara-app",
    title: "Tradara app",
    startedAt: day(1),
    lastEventAt: day(5, 80),
    ended: false,
    needsYou: null,
    requests: reqs,
    threads: [
      thread({
        id: "t1",
        title: "Ship build 9",
        requests: ["r1", "r3", "r5"],
        startedAt: day(1),
        lastAt: day(5, 50),
      }),
      thread({
        id: "t2",
        title: "Fix the fonts",
        requests: ["r2", "r4"],
        startedAt: day(1, 20),
        lastAt: day(5, 30),
      }),
      thread({
        id: "t3",
        title: "Disk space",
        requests: ["r6"],
        state: "running",
        startedAt: day(5, 70),
        lastAt: day(5, 70),
      }),
    ],
    journey: {
      chapters: [
        { title: "Ship it", requestIds: ["r1", "r2"], state: "done" },
        {
          title: "Upload",
          requestIds: ["r3", "r4", "r5", "r6"],
          state: "running",
        },
      ],
      pauses: [
        { after: "r2", from: day(1, 30), to: day(5), inside: false },
        { after: "r3", from: day(5, 5), to: day(5, 25), inside: true },
      ],
      decisions: [],
      totals: { helpers: 2, files: 5, commands: 30, sentBack: 0, pauses: 1 },
    },
    ...s,
  };
}

function show(v: SessionView = view()) {
  return render(
    <Live
      sessionId="s1"
      view={v}
      status="live"
      lastLooked={null}
      sessionTab="flow"
    />,
  );
}

/** The view as built before core had threads (and, with `bare`, a journey). */
function unthreaded(bare = false): SessionView {
  const { threads: _t, journey, ...rest } = view();
  return bare || !journey ? rest : { ...rest, journey };
}

const card = (n: number) =>
  document.querySelector<HTMLElement>(`.sf-card[data-n="${n}"]`) as HTMLElement;
const lit = () =>
  [...document.querySelectorAll<HTMLElement>(".sf-card")]
    .filter((c) => !c.classList.contains("dim"))
    .map((c) => Number(c.dataset.n));

beforeEach(() => {
  history.replaceState(null, "", "/s/s1?open=timeline");
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session tabs", () => {
  it("Journey, Timeline and All files are the panel's session row, each a link, the shown one current", () => {
    show();
    const tabs = screen.getByRole("navigation", { name: "This session" });
    const links = [...tabs.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual([
      "Journey",
      "Timeline",
      "All files",
    ]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/s/s1?open=journey",
      "/s/s1?open=timeline",
      "/s/s1?open=allfiles",
    ]);
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
    // The breadcrumb names the session the timeline is of.
    expect(
      screen
        .getByRole("navigation", { name: "Where you are" })
        .querySelector("[aria-current]")?.textContent,
    ).toBe("Session · Tradara app");
    // The journey's own body is not drawn on the timeline.
    expect(document.querySelector(".jr-line")).toBeNull();
  });

  it("with no request named the panel is the journey, its tab current", () => {
    render(
      <Live sessionId="s1" view={view()} status="live" lastLooked={null} />,
    );
    const tabs = screen.getByRole("navigation", { name: "This session" });
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Journey",
    );
    expect(document.querySelector(".jr-line")).toBeTruthy();
    expect(document.querySelector(".sf")).toBeNull();
  });
});

describe("storylines", () => {
  it("are the view's threads; without them, one per journey chapter, inferred", () => {
    expect(threadsOf(view()).map((t) => t.title)).toEqual([
      "Ship build 9",
      "Fix the fonts",
      "Disk space",
    ]);
    const old = threadsOf(unthreaded());
    expect(old.map((t) => [t.title, t.requests, t.inferred])).toEqual([
      ["Ship it", ["r1", "r2"], true],
      ["Upload", ["r3", "r4", "r5", "r6"], true],
    ]);
    const bare = threadsOf(unthreaded(true));
    expect(bare).toHaveLength(1);
    expect(bare[0]?.requests).toHaveLength(6);
  });

  it("follows draws only where it crosses threads or skips requests", () => {
    const v = view();
    expect(drawnFollows(v, threadsOf(v))).toEqual([
      { from: "r1", to: "r4" },
      { from: "r1", to: "r5" },
      { from: "r5", to: "r6" },
    ]);
  });

  it("a chain is everything a request picks up from and everything that picks up from it", () => {
    expect([...chainOf(view(), "r5")].sort()).toEqual(["r1", "r5", "r6"]);
    expect([...chainOf(view(), "r2")]).toEqual(["r2"]);
  });
});

describe("swimlane layout", () => {
  const v = view();
  const L = layoutSessionFlow(v, threadsOf(v), { width: 1200 });
  const at = (id: string) => L.cards.find((c) => c.req.id === id);

  it("a card whose title needs two lines is one line taller, and rows below move down", () => {
    const two = layoutSessionFlow(v, threadsOf(v), {
      width: 1200,
      titleLines: (r) => (r.id === v.requests[0]?.id ? 2 : 1),
    });
    const [a, b] = [two.cards[0], two.cards[1]];
    const [a1, b1] = [L.cards[0], L.cards[1]];
    expect(a && a1 && a.h - a1.h).toBe(TITLE_LINE);
    expect(b && b1 && b.y - b1.y).toBe(TITLE_LINE);
    expect(b && b1 && b.h).toBe(b1?.h);
  });

  it("one column per thread in order of first request, a card in its thread's column", () => {
    expect(L.cols.map((c) => c.thread.id)).toEqual(["t1", "t2", "t3"]);
    const xs = L.cols.map((c) => c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(at("r3")?.x).toBe(L.cols[0]?.x);
    expect(at("r4")?.x).toBe(L.cols[1]?.x);
    expect(at("r6")?.x).toBe(L.cols[2]?.x);
  });

  it("one row per request, in time order, none overlapping", () => {
    const ys = L.cards.map((c) => c.y);
    expect(L.cards.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < L.cards.length; i++) {
      const a = L.cards[i - 1];
      const b = L.cards[i];
      expect(b && a && b.y >= a.y + a.h).toBe(true);
    }
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it("columns fill the frame, and scroll sideways when there are many", () => {
    expect(L.width).toBeLessThanOrEqual(1200);
    expect(L.width).toBeGreaterThan(1000);
    const many = view({
      threads: Array.from({ length: 12 }, (_, i) =>
        thread({ id: `t${i}`, requests: i < 6 ? [`r${i + 1}`] : [] }),
      ),
    });
    const wide = layoutSessionFlow(many, threadsOf(many), { width: 1200 });
    expect(wide.width).toBeGreaterThan(1200);
    // A thread with no request on the page is not drawn.
    expect(wide.cols).toHaveLength(6);
  });

  it("a long pause between requests is a rule with its words, between their rows", () => {
    expect(L.pauses.map((p) => p.text)).toEqual(["3 days away"]);
    const p = L.pauses[0];
    const r2 = at("r2");
    const r3 = at("r3");
    expect(p && r2 && r3 && p.y > r2.y + r2.h && p.y < r3.y).toBe(true);
  });

  it("the time gutter names the day where it changes, the time on every row", () => {
    expect(L.times.map((t) => Boolean(t.day))).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(L.times.every((t) => /^\d\d:\d\d$/.test(t.time))).toBe(true);
  });

  it("links route in the gaps: no segment crosses a card", () => {
    expect(L.links.map((l) => l.key)).toEqual(["r1>r4", "r1>r5", "r5>r6"]);
    const inside = (x: number, y: number) =>
      L.cards.some(
        (c) =>
          x > c.x + 1 && x < c.x + c.w - 1 && y > c.y + 1 && y < c.y + c.h - 1,
      );
    for (const l of L.links)
      for (let i = 1; i < l.pts.length; i++) {
        const [x1, y1] = l.pts[i - 1] as [number, number];
        const [x2, y2] = l.pts[i] as [number, number];
        // Every segment is straight; sample along it.
        expect(x1 === x2 || y1 === y2).toBe(true);
        for (let k = 0; k <= 20; k++)
          expect(
            inside(x1 + ((x2 - x1) * k) / 20, y1 + ((y2 - y1) * k) / 20),
          ).toBe(false);
      }
  });

  it("consecutive requests in a thread are joined by its lane line", () => {
    expect(L.lanes.map((l) => l.key)).toEqual(["r1>r3", "r3>r5", "r2>r4"]);
  });

  it("Murmur's guessed storylines are runs in time, never side by side: they share one column", () => {
    const old = unthreaded();
    const one = layoutSessionFlow(old, threadsOf(old), { width: 1200 });
    expect(one.cols).toHaveLength(1);
    expect(one.cols[0]?.thread.inferred).toBe(true);
    expect(new Set(one.cards.map((c) => c.x)).size).toBe(1);
    // One lane line down the whole column, across the guessed chapters.
    expect(one.lanes.map((l) => l.key)).toEqual([
      "r1>r2",
      "r2>r3",
      "r3>r4",
      "r4>r5",
      "r5>r6",
    ]);
    // In one column, picking up from the request just above is the lane line.
    expect(drawnFollows(old, threadsOf(old))).toEqual([
      { from: "r1", to: "r3" },
      { from: "r1", to: "r4" },
      { from: "r1", to: "r5" },
    ]);
  });

  it("beside Claude's storylines, the guessed ones before them are one column", () => {
    const mixed = view({
      threads: [
        thread({ id: "chapter-1", requests: ["r1"], inferred: true }),
        thread({ id: "chapter-2", requests: ["r2"], inferred: true }),
        thread({ id: "t1", title: "Ship build 9", requests: ["r3", "r5"] }),
        thread({ id: "t2", title: "Fonts", requests: ["r4", "r6"] }),
      ],
    });
    const M = layoutSessionFlow(mixed, threadsOf(mixed), { width: 1200 });
    expect(M.cols.map((c) => c.thread.title)).toEqual([
      "Grouped by Murmur",
      "Ship build 9",
      "Fonts",
    ]);
    expect(M.cols[0]?.thread.requests).toEqual(["r1", "r2"]);
  });
});

describe("the board", () => {
  it("says the storylines are Murmur's own only when they are inferred", () => {
    show();
    expect(
      screen.queryByText(/Claude has not named these storylines yet/),
    ).toBeNull();
    cleanup();
    show(unthreaded());
    expect(
      screen.getByText(
        "Claude has not named this session's storylines yet, so its requests run in one line.",
      ),
    ).toBeTruthy();
    // One column needs no header naming it, and a click lights no storyline.
    expect(document.querySelector(".sf-head")).toBeNull();
    expect(document.querySelector(".sf-hint")?.textContent).toBe(
      "Point at a request to light what it picks up from; click it to open it.",
    );
  });

  it("each column has a header: title, request count, span and state", () => {
    show();
    const heads = [...document.querySelectorAll(".sf-head")];
    expect(
      heads.map((h) => h.querySelector(".sf-head-t")?.textContent),
    ).toEqual(["Ship build 9", "Fix the fonts", "Disk space"]);
    expect(heads[0]?.textContent).toContain("3 requests");
    expect(heads[0]?.textContent).toContain("4 days");
    expect(heads[2]?.querySelector(".mk.running")).toBeTruthy();
  });

  it("a card says its number, short, outcome, state and took · helpers · files", () => {
    show();
    const c = card(3);
    expect(c.textContent).toContain("3");
    expect(c.textContent).toContain("Upload to TestFlight");
    expect(c.textContent).toContain("Build 9 is uploaded to TestFlight.");
    expect(c.querySelector(".mk.done")).toBeTruthy();
    expect(c.querySelector(".sf-fx")?.textContent).toMatch(
      /^.+ · 2 helpers · 5 files$/,
    );
  });

  it("the running request carries the one pulse on the page", () => {
    // Its states are read at the session's moment (state.ts): a minute after its last event.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(day(5, 81)));
    show();
    const pulses = document.querySelectorAll(".pulse");
    expect(pulses).toHaveLength(1);
    expect(pulses[0]?.closest(".sf-card")).toBe(card(6));
  });
});

describe("selection", () => {
  it("pointing at a card lights its thread and its follows chain and dims the rest", () => {
    show();
    fireEvent.pointerEnter(card(5));
    expect(card(5).getAttribute("aria-pressed")).toBe("true");
    // Thread t1 (1, 3, 5) and the chain 1, 5, 6.
    expect(lit()).toEqual([1, 3, 5, 6]);
    const on = [...document.querySelectorAll(".sf-link.on")].map((l) =>
      l.getAttribute("data-key"),
    );
    expect(on).toEqual(["r1>r5", "r5>r6"]);
    fireEvent.pointerLeave(card(5));
    expect(lit()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("in Murmur's one guessed column pointing lights its follows chain, not the whole column", () => {
    show(unthreaded());
    fireEvent.pointerEnter(card(5));
    expect(lit()).toEqual([1, 5, 6]);
  });

  it("?r= selects on load, and Escape clears it from the card and the address", () => {
    history.replaceState(null, "", "/s/s1?open=timeline&r=r4");
    show();
    expect(card(4).getAttribute("aria-pressed")).toBe("true");
    expect(card(4).tabIndex).toBe(0);
    expect(lit()).toEqual([1, 2, 4]);
    fireEvent.keyDown(card(4), { key: "Escape" });
    expect(lit()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(location.search).toBe("?open=timeline");
  });

  it("arrow keys move through time and across columns, the selection in the address", () => {
    show();
    card(1).focus();
    fireEvent.keyDown(card(1), { key: "ArrowDown" });
    expect(card(2).getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(card(2));
    expect(location.search).toBe("?open=timeline&r=r2");
    fireEvent.keyDown(card(2), { key: "ArrowLeft" });
    // The nearest request in time in the column to the left.
    expect(document.activeElement).toBe(card(1));
    fireEvent.keyDown(card(1), { key: "ArrowRight" });
    expect(document.activeElement).toBe(card(2));
    fireEvent.keyDown(card(2), { key: "ArrowUp" });
    expect(document.activeElement).toBe(card(1));
  });

  it("one click opens the request in the office; so does Enter", async () => {
    show();
    await userEvent.click(card(2));
    expect(location.pathname + location.search).toBe("/s/s1/r/r2?open=story");
    // Back comes to the timeline with the card it opened still selected.
    history.back();
    await waitFor(() => expect(location.search).toBe("?open=timeline&r=r2"));
    cleanup();
    history.replaceState(null, "", "/s/s1?open=timeline");
    show();
    card(3).focus();
    fireEvent.keyDown(card(3), { key: "Enter" });
    expect(location.pathname + location.search).toBe("/s/s1/r/r3?open=story");
  });
});

describe("under 900 px", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) =>
        ({
          matches: q.includes("max-width: 899px"),
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  });

  it("is one list in time order, each card with its thread chip and what it picks up from", () => {
    show();
    expect(document.querySelector(".sf-board")).toBeNull();
    const items = [...document.querySelectorAll<HTMLElement>(".sf-li")];
    expect(items.map((i) => i.dataset.n)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(items[3]?.querySelector(".sf-chip")?.textContent).toBe(
      "Fix the fonts",
    );
    expect(items[3]?.textContent).toContain("picks up from 1");
    // Picking up from the one just before it in its thread says nothing more.
    expect(items[2]?.textContent).not.toContain("picks up from");
    expect(document.querySelector(".sf-list .sf-pause")?.textContent).toBe(
      "3 days away",
    );
    const a = items[0]?.querySelector("a");
    expect(a?.getAttribute("href")).toBe("/s/s1/r/r1?open=story");
    // Read days after its last event, its running request is paused (state.ts): no pulse.
    expect(document.querySelectorAll(".pulse")).toHaveLength(0);
    cleanup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(day(5, 81)));
    show();
    expect(document.querySelectorAll(".pulse")).toHaveLength(1);
  });

  it('a guessed storyline is no chip: a request named "Yes" is not a storyline', () => {
    show(unthreaded());
    expect(document.querySelector(".sf-chip")).toBeNull();
    expect(document.querySelectorAll(".sf-li")).toHaveLength(6);
  });
});
