import type { MapInput, PartView } from "@murmur/core";

/** A box on the map. `x`, `y` are the box centre; `w`, `h` its size. */
export interface NodeBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NODE_W = 160;
export const NODE_H = 40;
export const CENTER_W = 180;
export const CENTER_H = 44;
export const CHIP_H = 20;
export const CHIP_GAP = 4;
const PAD = 8;
/** Room above a node for its phase tag. */
const TAG_ROOM = 18;
const ROW_GAP = 28;
const COL_PITCH = 190;

const FEATURE_SLOTS: [number, number][] = [
  [0.2, 0.18],
  [0.8, 0.18],
  [0.8, 0.82],
  [0.2, 0.82],
  [0.1, 0.5],
  [0.9, 0.5],
  [0.5, 0.1],
  [0.5, 0.9],
];

/** Number of chips a part shows: up to two agents, then one `+N more`. */
export function chipCount(part: PartView): number {
  const n = part.agents.length;
  return n > 2 ? 3 : n;
}

function chipSpace(part: PartView): number {
  const n = chipCount(part);
  return n ? 8 + n * (CHIP_H + CHIP_GAP) : 0;
}

/** Columns for the column kinds, left to right, each in declaration order. */
function columns(kind: MapInput["kind"], parts: PartView[]): PartView[][] {
  const order =
    kind === "bug"
      ? ["symptom", "suspect", "ruled_out", "cause", "fix", ""]
      : kind === "refactor"
        ? ["before", "", "after"]
        : ["source", "", "answer"];
  const key = (p: PartView) => (p.tag && order.includes(p.tag) ? p.tag : "");
  const cols = order.map((t) => parts.filter((p) => key(p) === t));
  if (kind === "question") return [cols.flat()];
  // Bug keeps only the columns in use so five tags fit; refactor keeps all three.
  return kind === "bug" ? cols.filter((c) => c.length) : cols;
}

/** The canvas size MapView should give `layoutMap` for these parts. */
export function mapSize(
  kind: MapInput["kind"],
  parts: PartView[],
): { width: number; height: number } {
  if (kind === "feature") return { width: 720, height: 440 };
  const cols = columns(kind, parts);
  const tallest = Math.max(
    0,
    ...cols.map((c) =>
      c.reduce((h, p) => h + NODE_H + chipSpace(p) + ROW_GAP, 0),
    ),
  );
  return {
    width: Math.max(720, cols.length * COL_PITCH),
    height: Math.max(160, TAG_ROOM + tallest),
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

/**
 * Pure, deterministic map layout.
 * Feature: the goal is the centre box; part i takes slot i % 8 on ring
 * floor(i / 8), so adding parts never moves existing ones.
 * Bug, refactor, question: columns top-aligned, parts stacked in declaration
 * order with room for their agent chips. These kinds show the goal as a caption,
 * so `center` comes back with w = 0 and h = 0.
 */
export function layoutMap(
  kind: MapInput["kind"],
  parts: PartView[],
  width: number,
  height: number,
): { center: NodeBox; nodes: NodeBox[] } {
  if (kind === "feature") {
    const center = {
      id: "goal",
      x: width / 2,
      y: height / 2,
      w: CENTER_W,
      h: CENTER_H,
    };
    // ponytail: rings past the first clamp to the canvas edge and can overlap
    // once a request has more than 8 parts; a force layout fixes that if it shows up.
    const nodes = parts.map((p, i) => {
      const [sx, sy] = FEATURE_SLOTS[i % 8] as [number, number];
      const scale = 1.35 ** Math.floor(i / 8);
      return {
        id: p.id,
        x: clamp(
          width * (0.5 + (sx - 0.5) * scale),
          NODE_W / 2 + PAD,
          width - NODE_W / 2 - PAD,
        ),
        y: clamp(
          height * (0.5 + (sy - 0.5) * scale),
          NODE_H / 2 + TAG_ROOM,
          height - NODE_H / 2 - PAD,
        ),
        w: NODE_W,
        h: NODE_H,
      };
    });
    return { center, nodes };
  }
  const cols = columns(kind, parts);
  const nodes: NodeBox[] = [];
  cols.forEach((col, i) => {
    let top = TAG_ROOM;
    for (const p of col) {
      nodes.push({
        id: p.id,
        x: (width * (i + 0.5)) / cols.length,
        y: top + NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
      });
      top += NODE_H + chipSpace(p) + ROW_GAP;
    }
  });
  const order = new Map(parts.map((p, i) => [p.id, i]));
  nodes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { center: { id: "goal", x: width / 2, y: 0, w: 0, h: 0 }, nodes };
}
