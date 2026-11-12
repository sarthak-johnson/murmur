import type { PartView, PhaseView, RequestView, TaskView } from "@murmur/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowBoard } from "../src/flow/FlowBoard";
import {
  bands,
  cardFacts,
  cardLine,
  columns,
  layoutFlow,
  tagOf,
} from "../src/flow/flow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

const at = (min: number) =>
  new Date(Date.UTC(2026, 10, 6, 10, min)).toISOString();

function part(p: Partial<PartView> & { id: string }): PartView {
  return {
    title: p.id,
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

const uses = (...to: string[]) => to.map((t) => ({ to: t, label: "uses" }));

const task = (
  id: string,
  title: string,
  partId: string,
  status: TaskView["status"] = "done",
): TaskView => ({ id, title, part: partId, status, agents: [] });

function phase(p: Partial<PhaseView> & { id: string }): PhaseView {
  return { title: p.id, status: "done", tasks: [], ...p };
}

function request(r: Partial<RequestView> = {}): RequestView {
  return {
    id: "r7",
    prompt: "restyle",
    startedAt: at(0),
    kind: "feature",
    kindInferred: false,
    goal: "Restyle",
    phases: [],
    planInferred: false,
    parts: [],
    looseFiles: [],
    now: null,
    agents: [],
    assumptions: [],
    flags: [],
    finished: false,
    tally: { helpers: 0, files: 0, commands: 0 },
    ...r,
  };
}

/** Request 7, cut down: a foundation phase built in layers, then a running phase. */
function seven(r: Partial<RequestView> = {}): RequestView {
  return request({
    phases: [
      phase({
        id: "p0",
        title: "Phase 0: foundation",
        tasks: [
          task("t1", "Task 1: Lit plate tokens", "tokens"),
          task("t4", "Task 4: surfaces", "basics"),
          task("t5", "Task 5: controls", "basics"),
          task("t6", "Task 6: app frame", "frame"),
          task("t7", "Task 7: the rail", "rail"),
          task("t10", "Task 10: sweep", "sweep"),
        ],
      }),
      phase({
        id: "p1",
        title: "Phase 1",
        status: "now",
        tasks: [task("b1", "Bug B1: closed trades", "b1", "now")],
      }),
    ],
    parts: [
      part({
        id: "frame",
        title: "App frame",
        phase: "p0",
        links: uses("basics"),
        span: { start: at(45), end: at(62) },
        agents: ["a1", "a2", "a3"],
        rounds: 1,
        files: [
          {
            path: "src/Frame.tsx",
            added: 400,
            removed: 80,
            isNew: false,
            eventIds: [],
          },
          {
            path: "src/frame.css",
            added: 12,
            removed: 8,
            isNew: false,
            eventIds: [],
          },
        ],
        aim: {
          aim: "Change the frame every page sits in.",
          doneWhen: "the frame matches the prototype",
        },
      }),
      part({
        id: "tokens",
        title: "Lit plate tokens",
        phase: "p0",
        span: { start: at(8), end: at(15) },
      }),
      part({
        id: "basics",
        title: "Surfaces and controls",
        phase: "p0",
        links: uses("tokens"),
        span: { start: at(32), end: at(45) },
      }),
      part({
        id: "hero",
        title: "HeroMoney",
        phase: "p0",
        links: uses("tokens"),
        span: { start: at(14), end: at(21) },
      }),
      part({
        id: "rail",
        title: "The rail",
        phase: "p0",
        links: [
          { to: "frame", label: "sits in" },
          { to: "basics", label: "uses" },
        ],
        span: { start: at(61), end: at(82) },
      }),
      part({
        id: "sweep",
        title: "Shell screenshot sweep",
        phase: "p0",
        links: [
          { to: "frame", label: "checks" },
          { to: "rail", label: "checks" },
        ],
        span: { start: at(132), end: at(167) },
      }),
      part({
        id: "b1",
        title: "Closed trades disagree",
        phase: "p1",
        status: "now",
        links: [{ to: "rail", label: "feeds" }],
        span: { start: at(170) },
      }),
      part({ id: "loose", title: "Odd job", status: "done" }),
    ],
    ...r,
  });
}

describe("layering", () => {
  it("a part sits one column right of everything it reads", () => {
    const req = seven();
    const p0 = req.parts.filter((p) => p.phase === "p0");
    expect(columns(p0).map((c) => c.map((p) => p.id))).toEqual([
      ["tokens"],
      ["hero", "basics"],
      ["frame"],
      ["rail"],
      ["sweep"],
    ]);
  });

  it("orders a column by start time, parts with no start last", () => {
    const parts = [
      part({ id: "late", span: { start: at(30) } }),
      part({ id: "none" }),
      part({ id: "early", span: { start: at(5) } }),
    ];
    expect(columns(parts).map((c) => c.map((p) => p.id))).toEqual([
      ["early", "late", "none"],
    ]);
  });

  it("breaks a cycle the same way every time, by declaration order", () => {
    const parts = [
      part({ id: "a", links: uses("c") }),
      part({ id: "b", links: uses("a") }),
      part({ id: "c", links: uses("b") }),
    ];
    const ids = (ps: PartView[]) => columns(ps).map((c) => c.map((p) => p.id));
    // a's link back to c closes the loop and is the one dropped.
    expect(ids(parts)).toEqual([["a"], ["b"], ["c"]]);
    expect(ids([...parts])).toEqual(ids(parts));
    expect(columns([part({ id: "x", links: uses("x") })])).toHaveLength(1);
  });

  it("same files links and links outside the set give no order", () => {
    const parts = [
      part({ id: "a", links: [{ to: "b", label: "same files" }] }),
      part({ id: "b", links: uses("elsewhere") }),
    ];
    expect(columns(parts).map((c) => c.map((p) => p.id))).toEqual([["a", "b"]]);
  });
});

describe("layering edge cases", () => {
  it("a self link, a link to a missing part and a three-part loop still lay out", () => {
    const parts = [
      part({ id: "a", links: [...uses("a", "ghost"), ...uses("c")] }),
      part({ id: "b", links: uses("a") }),
      part({ id: "c", links: uses("b") }),
    ];
    expect(columns(parts).map((c) => c.map((p) => p.id))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });
});

describe("bands", () => {
  it("one per phase with parts, in plan order, then Other work", () => {
    const bs = bands(seven());
    expect(bs.map((b) => b.title)).toEqual([
      "Phase 0: foundation",
      "Phase 1",
      "Other work",
    ]);
    expect(bs.map((b) => b.parts.length)).toEqual([6, 1, 1]);
  });

  it("a part naming a phase the plan lacks goes to Other work", () => {
    const req = request({ parts: [part({ id: "x", phase: "gone" })] });
    expect(bands(req).map((b) => b.title)).toEqual(["Other work"]);
  });

  it("each band says its state, count and span", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const heads = [...document.querySelectorAll(".fb-head")].map(
      (h) => h.textContent,
    );
    expect(heads[0]).toContain("Phase 0: foundation");
    expect(heads[0]).toContain("Done");
    expect(heads[0]).toContain("6 of 6 done");
    expect(heads[1]).toContain("Running");
    expect(heads[1]).toContain("0 of 1 done");
  });
});

describe("cards", () => {
  it("every card has a title, a state word with its mark and three facts", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const cards = screen.getAllByRole("button", { pressed: false });
    expect(cards).toHaveLength(8);
    for (const c of cards) {
      expect(c.querySelector(".fc-ttl")?.textContent).toBeTruthy();
      expect(c.querySelector(".mk")).toBeTruthy();
      expect(c.querySelector(".fc-st")?.textContent).toBeTruthy();
      expect(c.querySelectorAll(".fc-fx span")).toHaveLength(3);
    }
  });

  it("facts read helpers, files and time; a part with nothing still says so", () => {
    const req = seven();
    const frame = req.parts[0] as PartView;
    expect(cardFacts(frame, at(200))).toEqual(["3 helpers", "2 files", "17 m"]);
    expect(cardFacts(part({ id: "x" }), at(200))).toEqual([
      "0 helpers",
      "0 files",
      "not started",
    ]);
    // Still under way: timed up to now.
    const b1 = req.parts.find((p) => p.id === "b1") as PartView;
    expect(cardFacts(b1, at(180))[2]).toBe("10 m");
  });

  it("tags number the tasks as the board and the Tasks list do", () => {
    const req = seven();
    const tag = (id: string) =>
      tagOf(req, req.parts.find((p) => p.id === id) as PartView);
    expect(tag("frame")).toBe("Task 4");
    expect(tag("basics")).toBe("Tasks 2-3");
    expect(tag("b1")).toBe("Task 7");
    expect(tag("hero")).toBeUndefined();
    const own = part({ id: "x", tag: "Q2" });
    expect(tagOf(req, own)).toBe("Q2");
  });

  it("a part of several tasks counts and numbers them as the Tasks list does", () => {
    // One part carries the phase's three tasks: the band says 3 of 3, not 1 of 1.
    const req = request({
      phases: [
        phase({
          id: "p0",
          title: "Agent tests",
          tasks: [
            task("t1", "Pick the affected agent specs", "e2e"),
            task("t2", "Run them against the shared database", "e2e"),
            task("t3", "Fix anything that fails", "e2e"),
          ],
        }),
        phase({
          id: "p1",
          title: "Merge",
          tasks: [task("t4", "Merge to staging", "pr")],
        }),
      ],
      parts: [
        part({ id: "e2e", title: "Agent end-to-end tests", phase: "p0" }),
        part({ id: "pr", title: "PR #1664 to staging", phase: "p1" }),
      ],
    });
    render(<FlowBoard sessionId="s1" request={req} />);
    const heads = [...document.querySelectorAll(".fb-head")].map(
      (h) => h.textContent,
    );
    expect(heads[0]).toContain("3 of 3 done");
    const titles = [...document.querySelectorAll(".fc-ttl")].map(
      (t) => t.textContent,
    );
    // Its one task names a part of one; a part of three keeps its own name.
    expect(titles).toEqual([
      "Tasks 1-3Agent end-to-end tests",
      "Task 4Merge to staging",
    ]);
  });

  it("state words: rounds on done, running, left open once the request is over", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const st = (name: string) =>
      screen
        .getByRole("button", { name: new RegExp(name) })
        .querySelector(".fc-st")?.textContent;
    expect(st("App frame")).toBe("Done, 1 round");
    expect(st("Lit plate tokens")).toBe("Done");
    expect(st("Closed trades")).toBe("Running");
    cleanup();
    render(<FlowBoard sessionId="s1" request={seven({ finished: true })} />);
    expect(st("Closed trades")).toBe("Left open");
  });

  it("a running card never pulses beside the rail's mark; under 900 px the first one may", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const running = screen.getByRole("button", { name: /Closed trades/ });
    const mk = running.querySelector(".mk");
    expect(mk?.classList.contains("running")).toBe(true);
    expect(mk?.classList.contains("pulse")).toBe(false);
    expect(running.classList.contains("fc-pulse")).toBe(true);
  });
});

const card = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });
const links = () => [...document.querySelectorAll<SVGPathElement>(".fl")];
const on = () =>
  links()
    .filter((l) => l.classList.contains("on"))
    .map((l) => l.dataset.key)
    .sort();

describe("no empty gap on a card", () => {
  const wide = { width: 2400, stacked: false, open: new Set<string>() };

  it("says the aim, else what done means, else the latest step", () => {
    const step = (text: string) => ({
      ts: at(1),
      text,
      status: "done" as const,
      eventIds: [],
    });
    expect(
      cardLine(
        request(),
        part({ id: "a", aim: { aim: "Build it.", doneWhen: "x" } }),
      ),
    ).toBe("Build it.");
    expect(
      cardLine(
        request(),
        part({ id: "a", aim: { aim: "", doneWhen: "Tests pass." } }),
      ),
    ).toBe("Done when tests pass.");
    expect(
      cardLine(
        request(),
        part({ id: "a", steps: [step("Built"), step("Reviewing")] }),
      ),
    ).toBe("Reviewing");
    const b = part({ id: "b", title: "Conversation page" });
    const a = part({ id: "a", links: [{ to: "b", label: "hands off to" }] });
    const req = request({ parts: [a, b] });
    expect(cardLine(req, a)).toBe("Hands off to Conversation page");
    expect(cardLine(req, b)).toBeUndefined();
  });

  it("cards in a row stay one height; a row with nothing more to say is shorter", () => {
    const req = request({
      phases: [phase({ id: "p" })],
      parts: [
        part({ id: "a", phase: "p", aim: { aim: "Do a.", doneWhen: "" } }),
        part({ id: "b", phase: "p" }),
        part({ id: "c", phase: "p", links: uses("a") }),
      ],
    });
    const l = layoutFlow(req, wide);
    expect(l.wide).toBe(true);
    const h = (id: string) => l.cards.find((c) => c.part.id === id)?.h;
    // a and c share the first row; b, alone in the second, has no line.
    expect(h("c")).toBe(h("a"));
    expect(h("b")).toBeLessThan(h("a") ?? 0);
  });

  it("measured heights win: a row is as tall as its tallest card", () => {
    const l = layoutFlow(seven(), {
      ...wide,
      width: 600,
      heights: new Map([
        ["tokens", 90],
        ["hero", 150],
        ["basics", 100],
        ["b1", 80],
      ]),
    });
    const h = (id: string) => l.cards.find((c) => c.part.id === id)?.h;
    // tokens, hero and frame share row 0; basics sits alone in row 1 of its column.
    expect(h("tokens")).toBe(150);
    expect(h("hero")).toBe(150);
    expect(h("basics")).toBe(100);
    const basics = l.cards.find((c) => c.part.id === "basics");
    expect(basics?.y).toBe(
      (l.cards.find((c) => c.part.id === "hero")?.y ?? 0) + 150 + 24,
    );
  });

  it("narrow cards keep one height and show no line", () => {
    const l = layoutFlow(seven(), { ...wide, width: 600 });
    expect(l.wide).toBe(false);
    expect(new Set(l.cards.map((c) => c.h)).size).toBe(1);
  });
});

describe("selection", () => {
  it("links are quiet until a part is selected; checks are dashed", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    expect(links()).toHaveLength(8);
    expect(on()).toEqual([]);
    const dashed = links()
      .filter((l) => l.classList.contains("dash"))
      .map((l) => l.dataset.key)
      .sort();
    expect(dashed).toEqual(["frame>sweep", "rail>sweep"]);
  });

  it("a click lights its links with labels, dims the rest and opens the detail strip", async () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    await userEvent.click(card("App frame"));
    expect(card("App frame").getAttribute("aria-pressed")).toBe("true");
    expect(on()).toEqual(["basics>frame", "frame>rail", "frame>sweep"]);
    expect(links().filter((l) => l.classList.contains("dim"))).toHaveLength(5);
    expect(card("The rail").classList.contains("dim")).toBe(false);
    expect(card("The rail").querySelector(".fc-rel")?.textContent).toBe(
      "sits in",
    );
    expect(card("HeroMoney").classList.contains("dim")).toBe(true);
    expect(location.search).toBe("?part=frame");

    const strip = screen.getByRole("region", { name: "Selected part" });
    expect(strip.textContent).toContain("App frame · Task 4");
    expect(strip.textContent).toContain("Done after one fix round");
    expect(strip.textContent).toContain("Change the frame every page sits in.");
    expect(strip.textContent).toContain(
      "Done when the frame matches the prototype",
    );
    expect(strip.textContent).toContain("2 files +412 −88");
    expect(strip.textContent).toContain("Uses Surfaces and controls");
    expect(strip.textContent).toContain("Used by The rail, Sweep");
    const open = within(strip).getByRole("link", { name: "Open Task 4 →" });
    expect(open.getAttribute("href")).toBe("/s/s1/r/r7?open=task:frame");
  });

  it("a second click or Escape clears it", async () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    await userEvent.click(card("App frame"));
    await userEvent.click(card("App frame"));
    expect(on()).toEqual([]);
    expect(location.search).toBe("");
    await userEvent.click(card("The rail"));
    await userEvent.keyboard("{Escape}");
    expect(on()).toEqual([]);
    expect(screen.queryByRole("region", { name: "Selected part" })).toBeNull();
  });

  it("?part= selects on load", () => {
    history.replaceState(null, "", "/s/s1/r/r7/flow?part=rail");
    render(<FlowBoard sessionId="s1" request={seven()} />);
    expect(card("The rail").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Selected part" })).toBeTruthy();
  });

  it("?part= scrolls its card into view, so a part in a far band is not hidden", () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    try {
      history.replaceState(null, "", "/s/s1/r/r7/flow?part=b1");
      render(<FlowBoard sessionId="s1" request={seven()} />);
      expect(into.mock.contexts).toContain(card("Closed trades"));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("?part= naming no part selects nothing and leaves the first card a tab stop", () => {
    history.replaceState(null, "", "/s/s1/r/r7/flow?part=nope");
    render(<FlowBoard sessionId="s1" request={seven()} />);
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Selected part" })).toBeNull();
    expect(document.querySelectorAll('.fc[tabindex="0"]')).toHaveLength(1);
  });

  it("arrow keys move the selection along columns and rows", async () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    // One card is in the tab order at a time.
    const tabbable = screen
      .getAllByRole("button", { pressed: false })
      .filter((b) => b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    card("Lit plate tokens").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(card("HeroMoney").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(card("HeroMoney"));
    await userEvent.keyboard("{ArrowDown}");
    expect(card("Surfaces and controls").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await userEvent.keyboard("{ArrowRight}");
    expect(card("App frame").getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
    expect(card("HeroMoney").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("folding past 20 parts", () => {
  function big(): RequestView {
    const parts = Array.from({ length: 22 }, (_, i) =>
      part({
        id: `p${i}`,
        title: `Part ${i}`,
        phase: i < 18 ? "a" : "b",
        status: i === 3 ? "now" : "done",
        span: { start: at(i) },
      }),
    );
    return request({
      phases: [phase({ id: "a", status: "now" }), phase({ id: "b" })],
      parts,
    });
  }

  it("each band shows its running and failed parts and a + n done row that opens it", async () => {
    render(<FlowBoard sessionId="s1" request={big()} />);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(1);
    const more = screen.getByRole("button", { name: "+ 17 done" });
    expect(screen.getByRole("button", { name: "+ 4 done" })).toBeTruthy();
    await userEvent.click(more);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(18);
    expect(screen.queryByRole("button", { name: "+ 17 done" })).toBeNull();
  });

  it("20 parts or fewer never fold", () => {
    const req = big();
    render(
      <FlowBoard
        sessionId="s1"
        request={{ ...req, parts: req.parts.slice(0, 20) }}
      />,
    );
    expect(screen.queryByRole("button", { name: /done$/ })).toBeNull();
  });

  it("a folded part named in the URL opens its band", () => {
    history.replaceState(null, "", "/s/s1/r/r7/flow?part=p7");
    render(<FlowBoard sessionId="s1" request={big()} />);
    expect(card("Part 7").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("band index", () => {
  it("names every band and scrolls the frame to the one picked", async () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const index = screen.getByRole("navigation", { name: "Phases" });
    const items = within(index).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual([
      "Phase 0: foundation6 parts",
      "Phase 11 part",
      "Other work1 part",
    ]);
    const frame = document.querySelector(".fb-frame") as HTMLElement;
    const scrollTo = vi.fn();
    frame.scrollTo = scrollTo as unknown as typeof frame.scrollTo;
    await userEvent.click(items[1] as HTMLElement);
    const phase1 = screen.getByRole("heading", { name: "Phase 1" })
      .parentElement as HTMLElement;
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        left: Number.parseFloat(phase1.style.left),
      }),
    );
  });

  it("a deep-linked part's band stays open after the selection clears", () => {
    history.replaceState(null, "", "/s/s1/r/r7/flow?part=p7");
    const parts = Array.from({ length: 22 }, (_, i) =>
      part({ id: `p${i}`, title: `Part ${i}`, phase: "a" }),
    );
    render(
      <FlowBoard
        sessionId="s1"
        request={request({ phases: [phase({ id: "a" })], parts })}
      />,
    );
    fireEvent.keyDown(card("Part 7"), { key: "Escape" });
    expect(screen.queryByRole("button", { name: /done$/ })).toBeNull();
    expect(card("Part 7")).toBeTruthy();
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

  it("bands stack and only the selection's links are drawn", async () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    expect(document.querySelector(".flow")?.classList.contains("stacked")).toBe(
      true,
    );
    expect(links()).toHaveLength(0);
    await userEvent.click(card("App frame"));
    expect(on()).toEqual(["basics>frame", "frame>rail", "frame>sweep"]);
    expect(links()).toHaveLength(3);
  });

  it("cards sit one under another, in build order", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const tops = ["Lit plate tokens", "HeroMoney", "App frame", "The rail"].map(
      (n) => Number.parseFloat(card(n).style.top),
    );
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    const lefts = new Set(
      screen
        .getAllByRole("button", { pressed: false })
        .map((b) => b.style.left),
    );
    expect(lefts.size).toBe(1);
  });
});

describe("wide layout", () => {
  it("no two cards overlap and columns run left to right", () => {
    render(<FlowBoard sessionId="s1" request={seven()} />);
    const box = (n: string) => {
      const s = card(n).style;
      return {
        x: Number.parseFloat(s.left),
        y: Number.parseFloat(s.top),
        w: Number.parseFloat(s.width),
        h: Number.parseFloat(s.height),
      };
    };
    const all = screen
      .getAllByRole("button", { pressed: false })
      .map((b) => box(b.getAttribute("aria-label")?.split(",")[0] ?? ""));
    for (const [i, a] of all.entries())
      for (const b of all.slice(i + 1))
        expect(
          a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y,
        ).toBe(true);
    expect(box("Lit plate tokens").x).toBeLessThan(box("HeroMoney").x);
    expect(box("App frame").x).toBeLessThan(box("The rail").x);
    expect(box("The rail").x).toBeLessThan(box("Closed trades").x);
  });

  it("a live update keeps the selection", () => {
    history.replaceState(null, "", "/s/s1/r/r7/flow?part=frame");
    const { rerender } = render(<FlowBoard sessionId="s1" request={seven()} />);
    act(() => {
      rerender(<FlowBoard sessionId="s1" request={seven({ goal: "x" })} />);
    });
    expect(card("App frame").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(card("App frame"), { key: "Escape" });
    expect(card("App frame").getAttribute("aria-pressed")).toBe("false");
  });
});
