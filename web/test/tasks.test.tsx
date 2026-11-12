import type {
  AgentView,
  MessageView,
  PartView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stacks } from "../src/live/Track";
import { Live, roomInJsdom } from "./officeShell";

roomInJsdom();

import type { Tab } from "../src/router";
import { clock } from "../src/story";
import { clockAt } from "./clock";

const at = (min: number) =>
  new Date(Date.UTC(2026, 10, 9, 15, min)).toISOString();
// The fixture's moment: live, not quiet, whatever day the tests run.
clockAt(at(10));

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
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

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
const agent = (id: string, a: Partial<AgentView> = {}): AgentView => ({
  id,
  type: "general-purpose",
  description: id,
  prompt: "",
  status: "done",
  startedAt: at(1),
  ...(a.status === "running" ? {} : { endedAt: at(5) }),
  ...a,
});
const file = (path: string) => ({
  path,
  added: 3,
  removed: 1,
  isNew: false,
  eventIds: [],
});
const msg = (id: string, min: number, text: string, m = {}): MessageView => ({
  id,
  ts: at(min),
  text,
  ...m,
});

/** A garden guide being written: one task done, one running, one not started, one failed. */
type Over = { [K in keyof RequestView]?: RequestView[K] | undefined };
function guide(r: Over = {}): RequestView {
  return {
    id: "r1",
    prompt: "write the garden guide",
    startedAt: at(0),
    kind: "feature",
    kindInferred: false,
    goal: "Write the garden guide",
    phases: [
      {
        id: "p1",
        title: "Draft",
        status: "now",
        tasks: [
          task("t1", "Task 1: Outline the guide", "done", { part: "outline" }),
          task("t2", "Write the watering section", "now", { part: "water" }),
          task("t3", "Pick the photos", "todo", { part: "photos" }),
        ],
      },
      {
        id: "p2",
        title: "Ship",
        status: "todo",
        tasks: [
          task("t4", "Send to the printer", "failed", {
            part: "send",
            problem: "The printer rejected the file",
          }),
        ],
      },
    ],
    planInferred: false,
    parts: [
      part({
        id: "outline",
        title: "Outline",
        status: "done",
        agents: ["a1", "a2"],
        aim: { aim: "Lay out the chapters", doneWhen: "" },
        steps: [
          {
            ts: at(5),
            text: "Outline agreed with eight chapters",
            status: "done",
            eventIds: [],
          },
        ],
        files: [file("a.md"), file("b.md"), file("c.md")],
      }),
      part({
        id: "water",
        title: "Watering",
        status: "now",
        agents: ["a3"],
        aim: { aim: "How often each bed needs water", doneWhen: "" },
      }),
      part({ id: "photos", title: "Photos" }),
      part({
        id: "send",
        title: "Printer",
        aim: { aim: "Get it printed", doneWhen: "" },
      }),
    ],
    looseFiles: [],
    now: null,
    agents: [
      agent("a1", { part: "outline", startedAt: at(1), endedAt: at(3) }),
      agent("a2", { part: "outline", startedAt: at(3), endedAt: at(5) }),
      agent("a3", {
        part: "water",
        status: "running",
        startedAt: at(6),
        description: "Write watering",
      }),
    ],
    assumptions: [],
    flags: [],
    finished: false,
    tally: { helpers: 3, files: 3, commands: 20 },
    state: "running",
    messages: [msg("m1", 2, "Outlining first.", { phase: "p1" })],
    ...r,
  } as RequestView;
}

const session = (req: RequestView): SessionView => ({
  sessionId: "s1",
  cwd: "/x/garden",
  title: "garden",
  startedAt: at(0),
  lastEventAt: at(8),
  ended: false,
  requests: [req],
  needsYou: null,
});

const show = (req: RequestView, tab?: Tab, partId?: string) =>
  render(
    <Live
      sessionId="s1"
      requestId={req.id}
      partId={partId}
      tab={tab}
      view={session(req)}
      status="live"
      lastLooked={null}
    />,
  );

const tabs = () =>
  [
    ...screen
      .getByRole("navigation", { name: "This request" })
      .querySelectorAll("a"),
  ].map((a) => a.textContent);
const list = () => screen.getByRole("region", { name: "Tasks" });
const groups = () => [...list().querySelectorAll(".tk-group")];
const rows = () => [...list().querySelectorAll("a.tk-row")] as HTMLElement[];

describe("the Tasks tab", () => {
  it("sits second, with its own URL, current when shown", () => {
    show(guide(), "tasks");
    expect(tabs()).toEqual(["Story", "Tasks", "Flow", "Files", "Helpers"]);
    const link = screen.getByRole("link", { name: "Tasks" });
    // The only request is the floor Claude is on: the address follows the session.
    expect(link.getAttribute("href")).toBe("/s/s1?open=tasks");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("lists the tasks by phase, in the plan's order, each numbered in the plan", () => {
    show(guide(), "tasks");
    const heads = groups().map((g) => g.querySelector("h2")?.textContent);
    expect(heads).toEqual(["Draft", "Ship"]);
    expect(groups()[0]?.querySelector(".tk-meta")?.textContent).toContain(
      "1 of 3 done",
    );
    expect(groups()[0]?.querySelector(".tk-meta")?.textContent).toContain(
      `${clock(at(1))} to ${clock(at(6))}`,
    );
    expect(rows().map((r) => r.querySelector(".tk-n")?.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    // The full title, without the plan's own number in front.
    expect(rows().map((r) => r.querySelector(".tk-t")?.textContent)).toEqual([
      "Outline the guide",
      "Write the watering section",
      "Pick the photos",
      "Send to the printer",
    ]);
  });

  it("says per state what a task is for or how it ended, and its facts", () => {
    show(guide(), "tasks");
    const [done, now, todo, failed] = rows();
    const line = (r?: HTMLElement) => r?.querySelector(".tk-line")?.textContent;
    const facts = (r?: HTMLElement) =>
      r?.querySelector(".tk-facts")?.textContent;
    expect(done?.querySelector(".mk")?.className).toContain("done");
    expect(line(done)).toBe("Outline agreed with eight chapters");
    expect(facts(done)).toBe("2 helpers · 3 files · took 4 m");
    expect(now?.querySelector(".mk")?.className).toContain("running");
    expect(line(now)).toBe("How often each bed needs water");
    expect(facts(now)).toBe(`1 helper · started ${clock(at(6))}`);
    // Not started and never described: no line, no facts.
    expect(todo?.querySelector(".mk")?.className).toContain("open");
    expect(todo?.querySelector(".tk-line")).toBeNull();
    expect(todo?.querySelector(".tk-facts")).toBeNull();
    expect(failed?.querySelector(".mk")?.className).toContain("failed");
    expect(line(failed)).toBe("The printer rejected the file");
  });

  it("says no line that only repeats the title", () => {
    const req = guide();
    const water = req.parts.find((p) => p.id === "water") as PartView;
    water.aim = { aim: "Write the watering section.", doneWhen: "" };
    show(req, "tasks");
    expect(rows()[1]?.querySelector(".tk-line")).toBeNull();
  });

  it("says each row's state in words for a screen reader, its title never cut mid-word", () => {
    show(guide(), "tasks");
    const name = (href: string) =>
      rows().find((r) => r.getAttribute("href") === href)?.textContent;
    expect(name("/s/s1/r/r1?open=task:t1")).toContain(", done");
    expect(name("/s/s1/r/r1?open=task:t2")).toContain(", running");
    expect(name("/s/s1/r/r1?open=task:t3")).toContain(", not started");
    expect(name("/s/s1/r/r1?open=task:t4")).toContain(", failed");
    const title = rows()[1]?.querySelector(".tk-t");
    expect(title?.querySelectorAll(".w").length).toBeGreaterThan(1);
    expect(title?.textContent).toBe("Write the watering section");
  });

  it("opens each task's page, rows in order as links, the running one the only pulse", () => {
    show(guide(), "tasks");
    expect(rows().map((r) => r.getAttribute("href"))).toEqual([
      "/s/s1/r/r1?open=task:t1",
      "/s/s1/r/r1?open=task:t2",
      "/s/s1/r/r1?open=task:t3",
      "/s/s1/r/r1?open=task:t4",
    ]);
    const pulses = document.querySelectorAll(".pulse");
    expect(pulses).toHaveLength(1);
    expect(pulses[0]?.closest("a.tk-row")?.getAttribute("href")).toBe(
      "/s/s1/r/r1?open=task:t2",
    );
  });

  it("puts work after the plan last, its helpers as rows", () => {
    const req = guide({
      beyond: { since: at(7), agents: ["a4"], messages: [], rounds: 0 },
      agents: [
        ...guide().agents,
        agent("a4", {
          description: "Fix the margins",
          part: "send",
          startedAt: at(7),
          endedAt: at(9),
        }),
      ],
    });
    show(req, "tasks");
    const last = groups().at(-1);
    expect(last?.querySelector("h2")?.textContent).toBe("Beyond the plan");
    expect(
      [...(last?.querySelectorAll(".tk-t") ?? [])].map((t) => t.textContent),
    ).toEqual(["Fix the margins"]);
    expect(last?.querySelector("a.tk-row")?.getAttribute("href")).toBe(
      "/s/s1/r/r1?open=task:send",
    );
  });

  it("lists a request's parts as its tasks when it has no plan", () => {
    show(guide({ phases: [] }), "tasks");
    expect(groups()).toHaveLength(1);
    expect(rows().map((r) => r.querySelector(".tk-t")?.textContent)).toEqual([
      "Outline",
      "Watering",
      "Photos",
      "Printer",
    ]);
  });
});

describe("the phase track", () => {
  const track = () => screen.getByRole("region", { name: "Phase track" });

  it("names every station, each in its own slot centred under its dot", () => {
    show(guide());
    const caps = [...track().querySelectorAll(".trk-seg")].map((seg) =>
      [...seg.querySelectorAll(".cap")].map((c) => ({
        text: c.textContent,
        left: Number.parseFloat((c as HTMLElement).style.left),
        width: Number.parseFloat((c as HTMLElement).style.width),
      })),
    );
    expect(caps[0]?.map((c) => c.text)).toEqual([
      "Outline the guide",
      "Write the watering section",
      "Pick the photos",
    ]);
    for (const seg of caps)
      seg.forEach((c, i) => {
        expect(c.width).toBeCloseTo(100 / seg.length);
        expect(c.left).toBeCloseTo((i * 100) / seg.length);
        // Each slot ends where the next begins: no two overlap.
        const next = seg[i + 1];
        if (next) expect(c.left + c.width).toBeLessThanOrEqual(next.left);
      });
    expect(track().querySelectorAll(".cap.on")).toHaveLength(0);
  });

  it("stacks, every station named, when a phase's slots get too narrow to read", () => {
    // Three phases of 5, 1 and 2 stations at 1100 px: slots of about 116 px.
    expect(stacks(1100, [5, 1, 2])).toBe(false);
    // Twelve stations in 700 px leave 40 px each.
    expect(stacks(700, [12, 1])).toBe(true);
    // A word wider than its slot is cut wherever it sits, so that stacks too.
    expect(stacks(1100, [5, 1, 2], [150, 0, 0])).toBe(true);
    expect(stacks(1100, [5, 1, 2], [90, 0, 0])).toBe(false);
  });

  describe("measured in the page", () => {
    // The room's canvas (officeShell) measures 7 px a character.
    let width: { mockRestore(): void } | undefined;
    const widthAt = (px: number) => {
      width = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(px);
    };
    afterEach(() => {
      width?.mockRestore();
    });
    const withTitle = (title: string) =>
      guide({
        phases: [
          {
            id: "p1",
            title: "Draft",
            status: "now",
            tasks: [task("t1", title, "now", { part: "water" })],
          },
        ],
      });

    it("lies flat when every slot is readable", () => {
      widthAt(1100);
      show(guide());
      expect(track().classList.contains("stack")).toBe(false);
    });

    it("stacks when the slots are too narrow, whatever the viewport says", () => {
      widthAt(200);
      show(guide());
      expect(track().classList.contains("stack")).toBe(true);
    });

    it("stacks when a caption holds a word wider than its slot", () => {
      widthAt(1100);
      show(withTitle(`src/${"a".repeat(160)}`));
      expect(track().classList.contains("stack")).toBe(true);
    });

    it("counts a path's folders as words, so it can wrap at a slash", () => {
      widthAt(1100);
      show(withTitle(`${"a".repeat(50)}/${"b".repeat(50)}/${"c".repeat(50)}`));
      expect(track().classList.contains("stack")).toBe(false);
    });
  });

  it("breaks a caption only between words, at a path's slash or after a hyphen", () => {
    show(
      guide({
        phases: [
          {
            id: "p1",
            title: "Draft",
            status: "now",
            tasks: [
              task("t1", "Src/features/idea buy-flow bugs", "now", {
                part: "water",
              }),
            ],
          },
        ],
      }),
    );
    const cap = track().querySelector(".cap") as HTMLElement;
    expect(cap.textContent).toBe("Src/features/idea buy-flow bugs");
    expect([...cap.querySelectorAll(".w")].map((w) => w.textContent)).toEqual([
      "Src/",
      "features/",
      "idea",
      "buy-",
      "flow",
      "bugs",
    ]);
  });
});

describe("a task's page", () => {
  const navs = () => document.querySelectorAll("nav.pd-nav");

  it("draws Previous and Next once when nothing sits between top and foot", () => {
    show(guide(), "story", "photos");
    expect(navs()).toHaveLength(1);
  });

  it("repeats them at the foot under a long page", () => {
    show(guide(), "story", "outline");
    expect(navs()).toHaveLength(2);
  });

  it("says what a task not started will be: its place, its neighbours, what Claude is on", () => {
    show(guide(), "story", "photos");
    const about = screen.getByRole("region", {
      name: "Where it sits in the plan",
    });
    expect([...about.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Last of 3 tasks in Draft, after Task 2 · Write the watering section.",
      "Next is Task 4 · Send to the printer.",
      "Claude is on Task 2 · Write the watering section now.",
    ]);
    const on = within(about).getByRole("link", {
      name: "Task 2 · Write the watering section",
    });
    expect(on.getAttribute("href")).toBe("/s/s1/r/r1?open=task:t2");
    expect(about.textContent).toContain("Claude is on");
    expect(
      screen.queryByText("Claude has not described this part yet."),
    ).toBeNull();
  });

  it("names no live task once the request is over", () => {
    show(guide({ finished: true, state: "left-open" }), "story", "photos");
    const about = screen.getByRole("region", {
      name: "Where it sits in the plan",
    });
    expect(about.textContent).not.toContain("Claude is on");
  });
});

describe("the story of a running request", () => {
  it("says what Claude is on before it has written a word", () => {
    // Claude's words go out with every tool's hook now; until the first one the story
    // still says where the work is, never an empty column.
    const req = guide({
      messages: [],
      agents: [],
      now: { text: "Reading the old guide", why: "", ts: at(4) },
    });
    show(req);
    const story = screen.getByRole("region", { name: "What happened" });
    expect(story.textContent).toContain("Reading the old guide");
  });

  it("names the task under way when Claude has said nothing at all", () => {
    show(guide({ messages: [], agents: [] }));
    const story = screen.getByRole("region", { name: "What happened" });
    expect(story.textContent).toContain("Write the watering section");
  });
});
