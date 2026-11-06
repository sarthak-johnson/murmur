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
/** Room kept under every column node for its most chips (3), used or not. */
const CHIP_ROOM = 80;
const ROW_PITCH = NODE_H + CHIP_ROOM + 20;
const COL_PITCH = 190;

/** Feature maps: fixed pixel positions on a 720 x 440 base, never recomputed. */
const BASE_W = 720;
const BASE_H = 440;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);
const RING: [number, number][] = (
  [
    [0.2, 0.18],
    [0.8, 0.18],
    [0.8, 0.82],
    [0.2, 0.82],
    [0.1, 0.5],
    [0.9, 0.5],
    [0.5, 0.1],
    [0.5, 0.9],
  ] as const
).map(([fx, fy]) => [
  clamp(fx * BASE_W, NODE_W / 2 + PAD, BASE_W - NODE_W / 2 - PAD),
  clamp(fy * BASE_H, NODE_H / 2 + TAG_ROOM, BASE_H - NODE_H / 2 - PAD),
]);
/** Parts past the ring: a grid below it, 4 per row, with the column chip room. */
const GRID_COLS = 4;
const GRID_TOP = 460;
const GRID_PITCH = ROW_PITCH;
export const RING_SIZE = RING.length;
/** Ring chip stacks must end above the first overflow row's phase tag band. */
export const RING_CHIP_BOTTOM = GRID_TOP - NODE_H / 2 - 16;
/** Most chips a part shows: two agents and a `+N more`. */
export const MAX_CHIPS = 3;

/** Number of chips a part shows: up to two agents, then one `+N more`. */
export function chipCount(part: PartView): number {
  const n = part.agents.length;
  return n > 2 ? MAX_CHIPS : n;
}

/** Every column the kind can have, used or not, so columns never move. */
function columns(kind: MapInput["kind"], parts: PartView[]): PartView[][] {
  const order =
    kind === "bug"
      ? ["symptom", "suspect", "ruled_out", "cause", "fix", ""]
      : kind === "refactor"
        ? ["before", "", "after"]
        : ["source", "", "answer"];
  const key = (p: PartView) => (p.tag && order.includes(p.tag) ? p.tag : "");
  const cols = order.map((t) => parts.filter((p) => key(p) === t));
  return kind === "question" ? [cols.flat()] : cols;
}

/**
 * The canvas size MapView should give `layoutMap`. Width is fixed per kind;
 * height only grows as parts arrive, so existing nodes keep their place.
 */
export function mapSize(
  kind: MapInput["kind"],
  parts: PartView[],
): { width: number; height: number } {
  if (kind === "feature") {
    const rows = Math.ceil(Math.max(0, parts.length - RING_SIZE) / GRID_COLS);
    return {
      width: BASE_W,
      height: rows
        ? GRID_TOP + (rows - 1) * GRID_PITCH + NODE_H / 2 + CHIP_ROOM
        : BASE_H,
    };
  }
  const cols = columns(kind, parts);
  const tallest = Math.max(0, ...cols.map((c) => c.length));
  return {
    width: Math.max(BASE_W, cols.length * COL_PITCH),
    height: Math.max(160, TAG_ROOM + tallest * ROW_PITCH),
  };
}

/**
 * Pure, deterministic map layout. `x`, `y` of each box are its centre.
 * Feature: the goal is the centre box; parts 0-7 take the fixed ring slots in
 * declaration order, later parts a grid below the ring. Feature positions are
 * fixed pixels on a 720 x 440 base and ignore `width` and `height`.
 * Bug, refactor, question: every column the kind has, at a fixed 190 px pitch,
 * centred in `width`; parts stack from the top with fixed chip room under each.
 * These kinds show the goal as a caption, so `center` has w = 0 and h = 0.
 */
export function layoutMap(
  kind: MapInput["kind"],
  parts: PartView[],
  width: number,
  _height: number,
): { center: NodeBox; nodes: NodeBox[] } {
  if (kind === "feature") {
    const center = {
      id: "goal",
      x: BASE_W / 2,
      y: BASE_H / 2,
      w: CENTER_W,
      h: CENTER_H,
    };
    const nodes = parts.map((p, i) => {
      const j = i - RING_SIZE;
      const [x, y] =
        j < 0
          ? (RING[i] as [number, number])
          : [
              (BASE_W / GRID_COLS) * ((j % GRID_COLS) + 0.5),
              GRID_TOP + Math.floor(j / GRID_COLS) * GRID_PITCH,
            ];
      return { id: p.id, x, y, w: NODE_W, h: NODE_H };
    });
    return { center, nodes };
  }
  const cols = columns(kind, parts);
  const left = (width - cols.length * COL_PITCH) / 2;
  const at = new Map<string, NodeBox>();
  cols.forEach((col, i) => {
    col.forEach((p, row) => {
      at.set(p.id, {
        id: p.id,
        x: left + (i + 0.5) * COL_PITCH,
        y: TAG_ROOM + row * ROW_PITCH + NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
      });
    });
  });
  const nodes = parts.map((p) => at.get(p.id) as NodeBox);
  return { center: { id: "goal", x: width / 2, y: 0, w: 0, h: 0 }, nodes };
}

/**
 * Fixed frame for link curves, never taken from the growing canvas: links bow
 * away from (x, y), and a curve may only flip back when its bow would cross
 * the frame edges. Feature: the goal centre on the 720 x 440 base. Column
 * kinds: the centre of the fixed width and of the first row band, no bottom.
 */
export function linkFrame(
  kind: MapInput["kind"],
  width: number,
): { x: number; y: number; width: number; height: number } {
  return kind === "feature"
    ? { x: BASE_W / 2, y: BASE_H / 2, width: BASE_W, height: BASE_H }
    : {
        x: width / 2,
        y: TAG_ROOM + ROW_PITCH / 2,
        width,
        height: Number.POSITIVE_INFINITY,
      };
}
