import type {
  AgentView,
  MurmurEvent,
  PartView,
  RequestView,
} from "@murmur/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PartDetail } from "../src/part/PartDetail";
import { type Lane, layoutTimeline } from "../src/part/Timeline";
import { helperRuns } from "../src/session";
import { clock } from "../src/story";

afterEach(cleanup);

const T0 = Date.UTC(2026, 10, 6, 3, 54);
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const agent = (id: string, a: Partial<AgentView> = {}): AgentView => ({
  id,
  type: "general-purpose",
  description: "Build the seed catalogue importer",
  prompt: `Brief for ${id}`,
  status: "done",
  startedAt: iso(0),
  ...a,
});

/** A lane of runs, each [from, to] in minutes after T0, all "Fixed" unless named. */
const lane = (runs: [number, number, string?][], id = "h1"): Lane => ({
  a: agent(id),
  kind: "build",
  runs: runs.map(([f, t, label = "Fixed"]) => ({
    from: iso(f),
    to: iso(t),
    running: false,
    label,
    tone: "plain",
  })),
});

type Box = [number, number];
const meet = ([a, b]: Box, [c, d]: Box) => a < d && c < b;

/** Every drawn label, as a box in px, never touches another label or another bar. */
function expectReadable(
  layout: ReturnType<typeof layoutTimeline>,
  track: number,
) {
  for (const bars of layout.bars) {
    const labels = bars.flatMap((b, i) =>
      b.label ? [{ i, box: [b.label.x, b.label.x + b.label.w] as Box }] : [],
    );
    for (const { i, box } of labels) {
      expect(box[0]).toBeGreaterThanOrEqual(0);
      // Words may run 24 px into the panel's right padding, no further.
      expect(box[1]).toBeLessThanOrEqual(track + 24);
      for (const o of labels)
        if (o.i !== i) expect(meet(box, o.box), "two labels touch").toBe(false);
      bars.forEach((b, j) => {
        if (j !== i)
          expect(meet(box, [b.x, b.x + b.w]), "a label covers a bar").toBe(
            false,
          );
      });
    }
  }
  // The axis's own labels keep apart too, and clear of its breaks.
  const ticks = layout.ticks.map((t) => [t.l, t.l + t.w] as Box);
  ticks.forEach((a, i) => {
    for (const b of ticks.slice(i + 1))
      expect(meet(a, b), "two ticks touch").toBe(false);
    for (const g of layout.breaks)
      expect(meet(a, [g.x, g.x + g.w]), "a tick covers a break").toBe(false);
  });
}

describe("a timeline that reads", () => {
  it("many short runs on one lane merge into one bar named by what they were", () => {
    // Twelve two-minute fix rounds a minute apart: far closer than a label is wide.
    const fixes = Array.from(
      { length: 12 },
      (_, i) => [i * 3, i * 3 + 2] as [number, number],
    );
    const layout = layoutTimeline([lane(fixes)], 640);
    expect(layout.bars[0]?.map((b) => [b.text, b.runs])).toEqual([
      ["12 fix rounds", 12],
    ]);
    expect(layout.bars[0]?.[0]?.label?.side).toBe("in");
    expectReadable(layout, 640);
  });

  it("a merged bar of different runs reads as its first plus how many more", () => {
    const layout = layoutTimeline(
      [
        lane([
          [0, 0.5, "Built"],
          [1, 1.5],
          [2, 2.5],
          [30, 31],
        ]),
      ],
      640,
    );
    expect(layout.bars[0]?.map((b) => b.text)).toEqual(["Built +2", "Fixed"]);
  });

  it("runs far enough apart keep their own bars", () => {
    const layout = layoutTimeline(
      [
        lane([
          [0, 4, "Built"],
          [8, 10],
        ]),
      ],
      640,
    );
    expect(layout.bars[0]?.map((b) => b.text)).toEqual(["Built", "Fixed"]);
  });

  it("a label that would touch another is left to the tooltip", () => {
    // A long build, then a quick review at the very end: no room on its right, and
    // on its left its words would run over the build's bar.
    const layout = layoutTimeline(
      [
        lane([
          [0, 50, "Built"],
          [55.5, 55.6, "Sent back"],
        ]),
      ],
      640,
    );
    expectReadable(layout, 640);
    const quiet = (layout.bars[0] ?? []).filter((b) => !b.label);
    expect(quiet.length).toBeGreaterThan(0);
    for (const b of quiet) expect(b.title).toContain(b.text);
  });

  it("a ten-hour span with long gaps cuts the gaps so runs keep a readable width", () => {
    // Roughly the shape of a real helper sent back many times over a day.
    const runs: [number, number, string?][] = [
      [0, 32, "Built"],
      [44, 57],
      [135, 142],
      [257, 258],
      [322, 341],
      [341, 351],
      [361, 375],
      [439, 453],
      [454, 465],
      [560, 600],
    ];
    const layout = layoutTimeline([lane(runs)], 766);
    expect(layout.breaks.length).toBeGreaterThanOrEqual(3);
    for (const g of layout.breaks) expect(g.skipped).toBeGreaterThan(30);
    // The seven-minute run would be 9 px on a plain ten-hour axis: twice that at least.
    const seven = layout.bars[0]?.find((b) =>
      b.title.includes(clock(iso(135))),
    );
    expect(seven?.w).toBeGreaterThan(2 * (7 / 600) * 766);
    // Time still runs left to right.
    const xs = runs.flatMap(([f, t]) => [layout.at(iso(f)), layout.at(iso(t))]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.max(...xs)).toBeLessThanOrEqual(766);
    expectReadable(layout, 766);
  });

  it("a short span is drawn to scale, with no breaks", () => {
    const layout = layoutTimeline(
      [
        lane([
          [0, 4, "Built"],
          [8, 10],
        ]),
      ],
      640,
    );
    expect(layout.breaks).toEqual([]);
  });

  it("no two labels ever touch, whatever the runs", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const words = ["Built", "Fixed", "Sent back", "Passed", "Reviewed"];
    for (let n = 0; n < 200; n++) {
      const lanes = Array.from(
        { length: 1 + Math.floor(rand() * 3) },
        (_, k) => {
          let t = rand() * 60;
          const runs: [number, number, string][] = [];
          const count = 1 + Math.floor(rand() * 14);
          for (let i = 0; i < count; i++) {
            const from = t + rand() * (rand() < 0.2 ? 200 : 15);
            const to = from + rand() * (rand() < 0.3 ? 40 : 3);
            runs.push([
              from,
              to,
              words[Math.floor(rand() * words.length)] ?? "",
            ]);
            t = to;
          }
          return lane(runs, `h${k}`);
        },
      );
      const track = 370 + Math.floor(rand() * 600);
      expectReadable(layoutTimeline(lanes, track), track);
    }
  });
});

describe("a helper's runs", () => {
  it("a run resumed with no stop seen never ends before it starts", () => {
    const a = agent("h1", { startedAt: iso(0), endedAt: iso(30) });
    const ev = (
      id: string,
      min: number,
      hook: MurmurEvent["hook"],
      payload: Record<string, unknown>,
    ): MurmurEvent => ({
      id,
      sessionId: "s1",
      machineId: "m",
      cwd: "/x/seeds",
      ts: iso(min),
      hook,
      payload,
    });
    const runs = helperRuns(
      a,
      [
        ev("x1", 30, "SubagentStop", { agent_id: "h1" }),
        ev("m1", 90, "PreToolUse", {
          tool_name: "SendMessage",
          tool_input: { to: "h1", message: "One more fix." },
        }),
      ],
      iso(200),
    );
    expect(runs.map((r) => r.to >= r.from)).toEqual([true, true]);
  });
});

describe("the task page over a long day", () => {
  const p: PartView = {
    id: "importer",
    title: "Seed catalogue importer",
    status: "done",
    links: [],
    steps: [],
    files: [],
    choices: [],
    checks: [],
    words: [],
    agents: ["h1"],
    failures: 0,
  };
  const helper = agent("h1", { startedAt: iso(0), endedAt: iso(30) });
  const send = (id: string, min: number): MurmurEvent => ({
    id,
    sessionId: "s1",
    machineId: "m",
    cwd: "/x/seeds",
    ts: iso(min),
    hook: "PreToolUse",
    payload: {
      tool_name: "SendMessage",
      tool_input: { to: "h1", message: "Fix the findings." },
    },
  });
  const stop = (id: string, min: number): MurmurEvent => ({
    ...send(id, min),
    hook: "SubagentStop",
    payload: { agent_id: "h1" },
  });
  const events = [
    stop("x1", 30),
    send("m1", 200),
    stop("x2", 210),
    send("m2", 540),
    stop("x3", 560),
  ];
  const r: RequestView = {
    id: "r1",
    prompt: "import the seed catalogue",
    startedAt: iso(0),
    kind: "feature",
    kindInferred: false,
    goal: "Import the seed catalogue",
    phases: [],
    planInferred: false,
    parts: [p],
    agents: [helper],
    messages: [],
  } as unknown as RequestView;
  const show = () =>
    render(
      <PartDetail
        sessionId="s1"
        request={r}
        part={p}
        events={events}
        onBack={() => {}}
      />,
    );

  it("marks the cut gaps on the axis and across the lane", () => {
    show();
    const tl = screen.getByRole("list", { name: "Timeline" });
    expect(document.querySelectorAll(".axis .break").length).toBe(2);
    expect(tl.querySelectorAll(".gap").length).toBe(2);
    expect((document.querySelector(".axis .break") as HTMLElement).title).toBe(
      "2 h 50 m with no work",
    );
  });

  it("the band runs to the helper's last run, not its first stop", () => {
    show();
    const band = screen.getByText((_, el) => Boolean(el?.matches(".fact.num")));
    expect(band.textContent).toBe(`${clock(iso(0))} to ${clock(iso(560))}`);
  });
});
