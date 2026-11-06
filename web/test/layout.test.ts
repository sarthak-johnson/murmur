import type { PartView } from "@murmur/core";
import { describe, expect, it } from "vitest";
import { layoutMap, type NodeBox } from "../src/map/layout";

function part(id: string, tag?: string): PartView {
  return {
    id,
    title: id,
    ...(tag ? { tag } : {}),
    status: "todo",
    links: [],
    steps: [],
    files: [],
    choices: [],
    checks: [],
    words: [],
    agents: [],
    failures: 0,
  };
}

function overlaps(a: NodeBox, b: NodeBox) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2
  );
}

describe("layoutMap", () => {
  it("first three parts keep their positions when a fourth is added", () => {
    const three = [part("a"), part("b"), part("c")];
    const before = layoutMap("feature", three, 720, 440).nodes;
    const after = layoutMap("feature", [...three, part("d")], 720, 440).nodes;
    expect(after.slice(0, 3)).toEqual(before);
    expect(after).toHaveLength(4);
  });

  it("bug kind puts the cause right of the suspects", () => {
    const parts = [
      part("cause", "cause"),
      part("s1", "suspect"),
      part("sym", "symptom"),
      part("s2", "suspect"),
    ];
    const { center, nodes } = layoutMap("bug", parts, 720, 440);
    const at = (id: string) => nodes.find((n) => n.id === id) as NodeBox;
    expect(at("cause").x).toBeGreaterThan(at("s1").x);
    expect(at("cause").x).toBeGreaterThan(at("s2").x);
    expect(at("s1").x).toBeGreaterThan(at("sym").x);
    expect(at("s1").x).toBe(at("s2").x);
    expect(at("s2").y).toBeGreaterThan(at("s1").y);
    expect(center.w).toBe(0);
    expect(center.h).toBe(0);
  });

  it("keeps the first ring of eight inside the canvas without overlaps", () => {
    const parts = "abcdefgh".split("").map((id) => part(id));
    const { center, nodes } = layoutMap("feature", parts, 720, 440);
    const all = [center, ...nodes];
    for (const n of all) {
      expect(n.x - n.w / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w / 2).toBeLessThanOrEqual(720);
      expect(n.y - n.h / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h / 2).toBeLessThanOrEqual(440);
    }
    all.forEach((a, i) => {
      for (const b of all.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    });
  });

  it("refactor puts before left, untagged middle, after right", () => {
    const parts = [
      part("after", "after"),
      part("mid"),
      part("before", "before"),
    ];
    const nodes = layoutMap("refactor", parts, 720, 440).nodes;
    const x = (id: string) => nodes.find((n) => n.id === id)?.x ?? Number.NaN;
    expect(x("before")).toBeLessThan(x("mid"));
    expect(x("mid")).toBeLessThan(x("after"));
  });

  it("question puts sources above the answer in one centred column", () => {
    const parts = [part("answer", "answer"), part("src", "source")];
    const nodes = layoutMap("question", parts, 720, 440).nodes;
    const at = (id: string) => nodes.find((n) => n.id === id) as NodeBox;
    expect(at("src").x).toBe(360);
    expect(at("answer").x).toBe(360);
    expect(at("src").y).toBeLessThan(at("answer").y);
  });

  it("is deterministic", () => {
    const parts = [part("a", "fix"), part("b")];
    expect(layoutMap("bug", parts, 720, 440)).toEqual(
      layoutMap("bug", parts, 720, 440),
    );
  });
});
