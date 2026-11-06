import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentView, PartView, RequestView } from "@murmur/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapView, textWidth } from "../src/map/MapView";

afterEach(cleanup);

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

function agent(id: string, description: string): AgentView {
  return {
    id,
    type: "general-purpose",
    description,
    prompt: "",
    status: "running",
    startedAt: "2026-11-06T10:00:00Z",
  };
}

function request(r: Partial<RequestView> = {}): RequestView {
  return {
    id: "r1",
    prompt: "add price alerts",
    startedAt: "2026-11-06T10:00:00Z",
    kind: "feature",
    kindInferred: false,
    goal: "Price alerts",
    phases: [
      { id: "p1", title: "Understand", status: "done", tasks: [] },
      { id: "p2", title: "Server side", status: "now", tasks: [] },
      { id: "p3", title: "App screen", status: "todo", tasks: [] },
    ],
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

const alerts = request({
  agents: [agent("a1", "tests"), agent("a2", "reading")],
  parts: [
    part({
      id: "screen",
      title: "Alert screen",
      phase: "p3",
      links: [{ to: "endpoint", label: "sends the alert to" }],
    }),
    part({
      id: "endpoint",
      title: "Server endpoint",
      phase: "p2",
      status: "now",
      agents: ["a1"],
      links: [{ to: "table", label: "stores in" }],
    }),
    part({ id: "table", title: "Alerts table", phase: "p2", status: "done" }),
    part({
      id: "push",
      title: "Push notification",
      phase: "p2",
      agents: ["a2"],
      links: [{ to: "screen", label: "price crosses, so it triggers" }],
    }),
    part({
      id: "watchlist",
      title: "Watchlist (existing)",
      phase: "p1",
      status: "done",
    }),
  ],
});

function dimOf(el: Element) {
  return (el.querySelector(".dim") as SVGElement).style.opacity;
}

describe("MapView", () => {
  it("highlighted part is the only full-opacity node", () => {
    render(
      <MapView
        request={alerts}
        highlight={{ partId: "endpoint" }}
        onOpenPart={() => {}}
      />,
    );
    const nodes = screen.getAllByRole("button");
    expect(nodes).toHaveLength(5);
    const full = nodes.filter((n) => dimOf(n) === "1");
    expect(full).toEqual([
      screen.getByRole("button", { name: "Server endpoint, in progress" }),
    ]);
    for (const n of nodes) if (n !== full[0]) expect(dimOf(n)).toBe("0.35");
  });

  it("phase highlight keeps that phase's parts full and dims the rest", () => {
    render(
      <MapView
        request={alerts}
        highlight={{ phaseId: "p2" }}
        onOpenPart={() => {}}
      />,
    );
    const full = screen
      .getAllByRole("button")
      .filter((n) => dimOf(n) === "1")
      .map((n) => n.getAttribute("aria-label"));
    expect(full).toEqual([
      "Server endpoint, in progress",
      "Alerts table, done",
      "Push notification, not started",
    ]);
  });

  it("Enter on a node calls onOpenPart", async () => {
    const onOpenPart = vi.fn();
    render(<MapView request={alerts} onOpenPart={onOpenPart} />);
    const node = screen.getByRole("button", { name: "Alerts table, done" });
    node.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenPart).toHaveBeenCalledWith("table");
    await userEvent.keyboard(" ");
    await userEvent.click(
      screen.getByRole("button", { name: "Alert screen, not started" }),
    );
    expect(onOpenPart.mock.calls).toEqual([["table"], ["table"], ["screen"]]);
  });

  it("shows at most two agent chips per part, then +N more", () => {
    const req = request({
      agents: [
        agent("a1", "tests"),
        agent("a2", "reading"),
        agent("a3", "docs"),
      ],
      parts: [part({ id: "x", title: "Endpoint", agents: ["a1", "a2", "a3"] })],
    });
    render(<MapView request={req} onOpenPart={() => {}} />);
    expect(screen.getByText("Agent 1: tests")).toBeTruthy();
    expect(screen.getByText("Agent 2: reading")).toBeTruthy();
    expect(screen.queryByText("Agent 3: docs")).toBeNull();
    expect(screen.getByText("+1 more")).toBeTruthy();
  });

  it("marks a part with three failures as stuck", () => {
    const req = request({
      parts: [part({ id: "x", title: "Endpoint", status: "now", failures: 3 })],
    });
    render(<MapView request={req} onOpenPart={() => {}} />);
    const node = screen.getByRole("button", { name: "Endpoint, stuck" });
    expect(node.classList.contains("stuck")).toBe(true);
  });

  it("tags a node with its phase number, and omits unknown phases", () => {
    const req = request({
      parts: [
        part({ id: "x", title: "Endpoint", phase: "p2" }),
        part({ id: "y", title: "Screen", phase: "nope" }),
      ],
    });
    render(<MapView request={req} onOpenPart={() => {}} />);
    const x = screen.getByRole("button", { name: "Endpoint, not started" });
    const y = screen.getByRole("button", { name: "Screen, not started" });
    expect(x.querySelector(".phase-tag")?.textContent).toBe("phase 2");
    expect(y.querySelector(".phase-tag")).toBeNull();
  });

  it("truncates long titles and keeps the full title for hover", () => {
    const title = "A very long part title that cannot fit inside one node box";
    const req = request({ parts: [part({ id: "x", title })] });
    render(<MapView request={req} onOpenPart={() => {}} />);
    const node = screen.getByRole("button", { name: `${title}, not started` });
    expect(node.querySelector("title")?.textContent).toBe(title);
    const label = node.querySelector(".label")?.textContent ?? "";
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThan(title.length);
  });

  it("shows the goal and one line when there are no parts", () => {
    const { container } = render(
      <MapView request={request()} onOpenPart={() => {}} />,
    );
    expect(screen.getByText("Price alerts")).toBeTruthy();
    expect(
      screen.getByText(
        "The map appears when Claude describes the parts of this work.",
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("the empty line shows only when there are no parts", () => {
    render(
      <MapView
        request={request({
          planInferred: true,
          parts: [part({ id: "dir:web/src", title: "web/src" })],
        })}
        onOpenPart={() => {}}
      />,
    );
    expect(screen.queryByText(/The map appears/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "web/src, not started" }),
    ).toBeTruthy();
  });

  it("shows the goal as a caption for other kinds", () => {
    const req = request({
      kind: "bug",
      goal: "Login fails on Safari",
      parts: [part({ id: "s", title: "Blank page", tag: "symptom" })],
    });
    const { container } = render(
      <MapView request={req} onOpenPart={() => {}} />,
    );
    expect(container.querySelector(".map-caption")?.textContent).toBe(
      "Login fails on Safari",
    );
    expect(container.querySelector(".goal-box")).toBeNull();
  });

  it("draws links as labelled dashed curves", () => {
    const { container } = render(
      <MapView request={alerts} onOpenPart={() => {}} />,
    );
    expect(container.querySelectorAll("path.link")).toHaveLength(3);
    expect(screen.getByText("stores in")).toBeTruthy();
  });

  it("lays out the five-part alerts example with no overlapping boxes", () => {
    const { container } = render(
      <MapView request={alerts} onOpenPart={() => {}} />,
    );
    const boxes = [
      ...container.querySelectorAll("rect.box, rect.goal-box"),
    ].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    }));
    expect(boxes).toHaveLength(6);
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    });
  });

  it("draws spokes only to the eight ring parts", () => {
    const req = request({
      parts: Array.from({ length: 10 }, (_, i) =>
        part({ id: `p${i}`, title: `Part ${i}` }),
      ),
    });
    const { container } = render(
      <MapView request={req} onOpenPart={() => {}} />,
    );
    expect(container.querySelectorAll("line.spoke")).toHaveLength(8);
  });

  it("fades new map items in, except under reduced motion", () => {
    // Vitest stubs CSS imports, so read the file itself.
    const css = readFileSync(
      join(import.meta.dirname, "../src/theme.css"),
      "utf8",
    );
    const flat = css.replace(/\s+/g, " ");
    expect(flat).toMatch(
      /@keyframes map-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/,
    );
    const rule = flat.match(/([^{}]+)\{ animation: map-in 200ms[^}]*\}/);
    const selectors = (rule?.[1] ?? "").split(",").map((x) => x.trim());
    for (const sel of [
      ".map-node",
      ".map-chips",
      ".map .link",
      ".map .link-label",
      ".map .chip",
      ".map .spoke",
    ])
      expect(selectors).toContain(sel);
    const reduced = flat.slice(flat.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/animation: none/);
  });

  function linkGeometry(container: HTMLElement) {
    const d = [...container.querySelectorAll("path.link")].map((l) =>
      l.getAttribute("d"),
    );
    const labels = [...container.querySelectorAll("text.link-label")].map(
      (t) => `${t.getAttribute("x")},${t.getAttribute("y")}`,
    );
    return { d, labels };
  }

  it("a growing canvas never moves existing links or their labels", () => {
    const ring = Array.from({ length: 8 }, (_, i) =>
      part({ id: `p${i}`, title: `Part ${i}` }),
    );
    // Bottom-left (slot 3) to bottom-right (slot 2), and top-left to left.
    const linked = ring.map((p) =>
      p.id === "p3"
        ? { ...p, links: [{ to: "p2", label: "feeds" }] }
        : p.id === "p0"
          ? { ...p, links: [{ to: "p4", label: "reads" }] }
          : p,
    );
    const a = render(
      <MapView request={request({ parts: linked })} onOpenPart={() => {}} />,
    );
    const before = linkGeometry(a.container);
    a.unmount();
    const b = render(
      <MapView
        request={request({
          parts: [...linked, part({ id: "p8", title: "Part 8" })],
        })}
        onOpenPart={() => {}}
      />,
    );
    expect(linkGeometry(b.container)).toEqual(before);
    b.unmount();

    const bugParts = [
      part({
        id: "sym",
        title: "Blank page",
        tag: "symptom",
        links: [{ to: "c", label: "caused by" }],
      }),
      part({ id: "s1", title: "Redirect", tag: "suspect" }),
      part({ id: "c", title: "Cookie flag", tag: "cause" }),
    ];
    const bug = (parts: PartView[]) =>
      render(
        <MapView
          request={request({ kind: "bug", parts })}
          onOpenPart={() => {}}
        />,
      );
    const c = bug(bugParts);
    const bugBefore = linkGeometry(c.container);
    c.unmount();
    const d = bug([
      ...bugParts,
      part({ id: "s2", title: "Cache", tag: "suspect" }),
      part({ id: "s3", title: "Proxy", tag: "suspect" }),
    ]);
    expect(linkGeometry(d.container)).toEqual(bugBefore);
  });

  it("chips on an overflow row never cover a node or its phase tag", () => {
    const parts = Array.from({ length: 14 }, (_, i) =>
      part({
        id: `p${i}`,
        title: `Part ${i}`,
        phase: "p2",
        agents: i === 9 ? ["a1", "a2", "a3"] : [],
      }),
    );
    const req = request({
      agents: [
        agent("a1", "tests"),
        agent("a2", "reading"),
        agent("a3", "docs"),
      ],
      parts,
    });
    const { container } = render(
      <MapView request={req} onOpenPart={() => {}} />,
    );
    const rect = (r: Element) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    });
    const nodes = [...container.querySelectorAll("rect.box, rect.goal-box")]
      .map(rect)
      .map((r) => ({ ...r, y: r.y - 16, h: r.h + 16 }));
    const chips = [...container.querySelectorAll("rect.chip-box")].map(rect);
    expect(chips).toHaveLength(3);
    for (const c of chips)
      for (const n of nodes) {
        const apart =
          c.x + c.w <= n.x ||
          n.x + n.w <= c.x ||
          c.y + c.h <= n.y ||
          n.y + n.h <= c.y;
        expect(apart).toBe(true);
      }
  });

  it("chip stacks of two bottom ring parts never cover each other", () => {
    const parts = Array.from({ length: 6 }, (_, i) =>
      part({
        id: `p${i}`,
        title: `Part ${i}`,
        agents: i === 2 || i === 3 ? [`a${i}`] : [],
      }),
    );
    const req = request({
      agents: [agent("a2", "Build style B"), agent("a3", "Build style C")],
      parts,
    });
    const { container } = render(
      <MapView request={req} onOpenPart={() => {}} />,
    );
    const rect = (r: Element) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    });
    const [a, b] = [...container.querySelectorAll("rect.chip-box")].map(rect);
    if (!a || !b) throw new Error("two chips expected");
    expect(
      a.x + a.w <= b.x ||
        b.x + b.w <= a.x ||
        a.y + a.h <= b.y ||
        b.y + b.h <= a.y,
    ).toBe(true);
  });

  it("a link label in a crowded overflow grid finds a clear spot", () => {
    const agents = Array.from({ length: 36 }, (_, i) =>
      agent(`a${i}`, `Implement Task ${i}`),
    );
    const parts = Array.from({ length: 12 }, (_, i) =>
      part({
        id: `p${i}`,
        title: `Task ${i}`,
        status: "done",
        agents: [`a${3 * i}`, `a${3 * i + 1}`, `a${3 * i + 2}`],
        links: i === 11 ? [{ to: "p8", label: "same files" }] : [],
      }),
    );
    const { container } = render(
      <MapView request={request({ agents, parts })} onOpenPart={() => {}} />,
    );
    const label = container.querySelector(".link-label") as SVGTextElement;
    const w = textWidth("same files", 10.5) + 8;
    const x = Number(label.getAttribute("x")) - w / 2;
    const y = Number(label.getAttribute("y")) - 3 - 8;
    const boxes = [
      ...container.querySelectorAll("rect.chip-box, rect.box, rect.goal-box"),
    ].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    }));
    const hits = boxes.filter(
      (b) => x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + 14,
    );
    expect(hits).toEqual([]);
  });

  it("a cut title ends at a word, and a cut path keeps its last folders", () => {
    render(
      <MapView
        request={request({
          parts: [
            part({ id: "a", title: "Style B, departure board and more" }),
            part({ id: "b", title: "scratchpad/style/shared/deeper" }),
            part({ id: "c", title: ".superpowers/sdd/2026-11-06-lit-plate-x" }),
          ],
        })}
        onOpenPart={() => {}}
      />,
    );
    const label = (name: RegExp) =>
      screen.getByRole("button", { name }).querySelector(".label")?.textContent;
    expect(label(/^Style B/)).toBe("Style B, departure…");
    expect(label(/^scratchpad/)).toBe("…/style/shared/deeper");
    // A last folder too long for the box ends at a dash, not mid-word.
    expect(label(/^\.superpowers/)).toBe("…/2026-11-06-lit-plate…");
  });

  it("a growing canvas never moves existing chips", () => {
    const agents = [agent("a1", "tests"), agent("a2", "reading")];
    const ring = Array.from({ length: 8 }, (_, i) =>
      part({
        id: `p${i}`,
        title: `Part ${i}`,
        agents: i === 3 || i === 7 ? ["a1", "a2"] : [],
      }),
    );
    const chipsOf = (parts: PartView[]) => {
      const { container, unmount } = render(
        <MapView request={request({ agents, parts })} onOpenPart={() => {}} />,
      );
      const out = [...container.querySelectorAll("rect.chip-box")].map(
        (r) => `${r.getAttribute("x")},${r.getAttribute("y")}`,
      );
      unmount();
      return out;
    };
    const before = chipsOf(ring);
    expect(before).toHaveLength(4);
    expect(chipsOf([...ring, part({ id: "p8", title: "Part 8" })])).toEqual(
      before,
    );
  });

  const boxRect = (r: Element) => ({
    x: Number(r.getAttribute("x")),
    y: Number(r.getAttribute("y")),
    w: Number(r.getAttribute("width")),
    h: Number(r.getAttribute("height")),
  });

  it("bottom ring chips never cover an overflow phase tag", () => {
    const agents = [agent("a1", "tests"), agent("a2", "reading")];
    const parts = Array.from({ length: 12 }, (_, i) =>
      part({
        id: `p${i}`,
        title: `Part ${i}`,
        phase: "p2",
        agents: i === 2 || i === 3 ? ["a1", "a2"] : [],
      }),
    );
    const { container } = render(
      <MapView request={request({ agents, parts })} onOpenPart={() => {}} />,
    );
    const tags = [...container.querySelectorAll("rect.box")]
      .map(boxRect)
      .map((r) => ({ x: r.x, y: r.y - 16, w: r.w, h: 16 }));
    const chips = [...container.querySelectorAll("rect.chip-box")].map(boxRect);
    expect(chips).toHaveLength(4);
    for (const c of chips)
      for (const t of tags) {
        const apart =
          c.x + c.w <= t.x ||
          t.x + t.w <= c.x ||
          c.y + c.h <= t.y ||
          t.y + t.h <= c.y;
        expect(apart).toBe(true);
      }
  });

  it("a ring part's chip stack stays put as its agents go from 1 to 3", () => {
    const agents = [
      agent("a1", "tests"),
      agent("a2", "reading"),
      agent("a3", "docs"),
    ];
    for (let slot = 0; slot < 8; slot++) {
      const firstChip = (n: number) => {
        const parts = Array.from({ length: 8 }, (_, i) =>
          part({
            id: `p${i}`,
            title: `Part ${i}`,
            agents: i === slot ? ["a1", "a2", "a3"].slice(0, n) : [],
          }),
        );
        const { container, unmount } = render(
          <MapView
            request={request({ agents, parts })}
            onOpenPart={() => {}}
          />,
        );
        const first = container.querySelector("rect.chip-box");
        const out = first ? boxRect(first) : null;
        unmount();
        return out;
      };
      const one = firstChip(1);
      expect(firstChip(2)).toEqual(one);
      expect(firstChip(3)).toEqual(one);
    }
  });
});
