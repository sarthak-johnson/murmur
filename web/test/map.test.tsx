import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentView, PartView, RequestView } from "@murmur/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapView } from "../src/map/MapView";

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
    ])
      expect(selectors).toContain(sel);
    const reduced = flat.slice(flat.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/animation: none/);
  });
});
