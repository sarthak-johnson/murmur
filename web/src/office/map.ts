// Floor layout: tiles, walls, furniture, named spots and grid pathing. No drawing here.
// 39 x 20 tiles of 16 px: renders at 4x (2496 x 1280) on a 2560 x 1440 screen.

export interface Tile {
  x: number;
  y: number;
}
export type Face = "up" | "down" | "left" | "right";
/** A tile to stand on, which way to face there, and whether to sit. */
export interface Spot extends Tile {
  face?: Face;
  sit?: boolean;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type RoomId = "plan" | "corner" | "work" | "review";
export type TileKind = RoomId | "wall-cap" | "wall-face" | "door";

export const T = 16;
export const COLS = 39;
export const ROWS = 20;
export const W = COLS * T;
export const H = ROWS * T;

// Rooms (tile rects). Top band: planning room and Claude's corner; bottom band: work floor and review room.
export const ROOMS: Record<RoomId, Rect & { label: string }> = {
  plan: { x: 1, y: 2, w: 19, h: 6, label: "Planning" },
  corner: { x: 21, y: 2, w: 17, h: 6, label: "Claude's corner" },
  work: { x: 1, y: 10, w: 25, h: 9, label: "Work floor" },
  review: { x: 27, y: 10, w: 11, h: 9, label: "Review room" },
};
export const DOORWAYS: Rect[] = [
  { x: 9, y: 8, w: 2, h: 2 }, // planning <-> work floor
  { x: 21, y: 8, w: 2, h: 2 }, // corner <-> work floor
  { x: 31, y: 8, w: 2, h: 2 }, // corner <-> review room
  { x: 20, y: 6, w: 1, h: 2 }, // planning <-> corner
];

const byRowThenCol = (a: Tile, b: Tile) => a.y - b.y || a.x - b.x;

export const BOARD = { x: 2, w: 17, px: { x: 34, y: 18, w: 270, h: 82 } };
export const BOARD_INNER = { x: 36, x1: 302, notesY: 37 };
// Desks: the character sits on the far (north) side facing you; the chair is the tile above the desk.
export const WORK_DESKS: Tile[] = [2, 8, 14, 20]
  .flatMap((x) => [12, 16].map((y) => ({ x, y })))
  .sort(byRowThenCol);
export const REVIEW_DESKS: Tile[] = [28, 33]
  .flatMap((x) => [12, 16].map((y) => ({ x, y })))
  .sort(byRowThenCol);
export const CLAUDE_DESK = { x: 23, y: 5, w: 3 };
export const JOB_BOARD = { x: 22, px: { x: 354, y: 18, w: 54, h: 30 } };
export const SHELVES = { x: 26, w: 5, px: { x: 418, y: 10, w: 78, h: 44 } };
export const DOOR = { x: 32, w: 2, px: { x: 512, y: 2, w: 32, h: 30 } };
export const RACKS = { x: 35, w: 3, px: { x: 562, y: 6, w: 44, h: 46 } };
export const CONSOLE = { x: 35, y: 4, w: 3 };
export const PLANTS: Tile[] = [
  { x: 1, y: 7 },
  { x: 37, y: 7 },
  { x: 6, y: 18 },
  { x: 25, y: 10 },
  { x: 37, y: 18 },
];
export const CLOCK = { x: 13, y: 9 };
export const COOLER = { x: 25, y: 14 };
export const RUG = { x: 22, y: 4, w: 5, h: 3 }; // under Claude's desk
export const POSTERS: { x: number; y: number; art: "hills" | "chart" }[] = [
  { x: 16 * 16 + 4, y: 9 * 16 + 2, art: "hills" },
  { x: 28 * 16 + 2, y: 9 * 16 + 2, art: "chart" },
];
// Where the office cat likes to sit and nap. All free floor.
// The first spot is where the cat starts: by Claude, in the light.
export const CAT_SPOTS: Tile[] = [
  { x: 24, y: 7 },
  { x: 5, y: 7 },
  { x: 12, y: 7 },
  { x: 17, y: 6 },
  { x: 29, y: 6 },
  { x: 24, y: 15 },
  { x: 24, y: 18 },
  { x: 12, y: 14 },
  { x: 18, y: 14 },
  { x: 31, y: 14 },
  { x: 30, y: 18 },
];
export const OUTSIDE: Tile = { x: 32, y: 1 };

/** Floor type of a tile, or "wall-cap" / "wall-face" / "door". */
export function tileKind(x: number, y: number): TileKind {
  if (y === 1 && x >= DOOR.x && x < DOOR.x + DOOR.w) return "door";
  for (const d of DOORWAYS) {
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) {
      if (y < 8) return "corner";
      return x < 26 ? "work" : "review";
    }
  }
  if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) return "wall-cap";
  if (y === 1 || y === 9) {
    return (y === 1 && x === 20) || (y === 9 && x === 26)
      ? "wall-cap"
      : "wall-face";
  }
  if (y === 8) return "wall-cap";
  if (x === 20 && y < 8) return "wall-cap";
  if (x === 26 && y > 8) return "wall-cap";
  if (y < 8) return x < 20 ? "plan" : "corner";
  return x < 26 ? "work" : "review";
}

// Blocked grid: walls plus furniture. Chairs are blocked too; a path may start or end on one.
export const blocked: boolean[][] = Array.from({ length: ROWS }, (_, y) =>
  Array.from({ length: COLS }, (_, x) => {
    const k = tileKind(x, y);
    return k.startsWith("wall") || k === "door";
  }),
);
function block(x: number, y: number, w = 1, h = 1) {
  for (let j = y; j < y + h; j++) {
    const row = blocked[j];
    if (!row) continue;
    for (let i = x; i < x + w; i++) row[i] = true;
  }
}
block(BOARD.x, 2, BOARD.w, 4);
for (const d of [...WORK_DESKS, ...REVIEW_DESKS]) {
  block(d.x, d.y, 3);
  block(d.x + 1, d.y - 1);
}
block(CLAUDE_DESK.x, CLAUDE_DESK.y, CLAUDE_DESK.w);
block(CLAUDE_DESK.x + 1, CLAUDE_DESK.y - 1);
block(JOB_BOARD.x, 2, 3);
block(SHELVES.x, 2, SHELVES.w);
block(RACKS.x, 2, RACKS.w, 2);
block(CONSOLE.x, CONSOLE.y, CONSOLE.w);
for (const p of PLANTS) block(p.x, p.y);
block(COOLER.x, COOLER.y);

const isBlocked = (x: number, y: number) => blocked[y]?.[x] === true;

/** Chair tile of a desk (north of it). */
export const chairOf = (d: Tile): Tile => ({ x: d.x + 1, y: d.y - 1 });

/** Board column geometry for n phases. */
export function boardColumns(n: number): { x: number; w: number }[] {
  const w = BOARD_INNER.x1 - BOARD_INNER.x;
  const cw = Math.floor(w / Math.max(1, n));
  return Array.from({ length: n }, (_, i) => ({
    x: BOARD_INNER.x + i * cw,
    w: cw,
  }));
}

/** Where Claude is, as far as the floor needs to know. */
export interface SpotRef {
  spot: string;
  column?: number | undefined;
  helper?: string | undefined;
}

/** Named spot -> { x, y (tile), face, sit }. */
export function spotTile(
  claude: SpotRef,
  scene: { columns: readonly unknown[] },
  deskOf: (agent: string | undefined) => Tile | undefined,
): Spot {
  const atDesk: Spot = { ...chairOf(CLAUDE_DESK), face: "down", sit: true };
  switch (claude.spot) {
    case "board": {
      const cols = boardColumns(scene.columns.length || 1);
      const c = cols[Math.min(claude.column ?? 0, cols.length - 1)];
      if (!c) return atDesk;
      return {
        x: Math.min(18, Math.max(2, Math.floor((c.x + c.w / 2) / T))),
        y: 6,
        face: "up",
      };
    }
    case "terminal":
      return { x: 36, y: 5, face: "up" };
    case "archive":
      return { x: 28, y: 3, face: "up" };
    case "door":
      return { x: 32, y: 3, face: "down" };
    case "helper": {
      const d = deskOf(claude.helper);
      if (d) return { x: d.x + 3, y: d.y - 1, face: "left" };
      return atDesk;
    }
    default:
      return atDesk;
  }
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Take the lowest-scoring entry out of an open list (the first one on a tie). */
function takeBest<N>(open: N[], score: (n: N) => number): N | undefined {
  let bi = 0;
  let bs = Number.POSITIVE_INFINITY;
  open.forEach((n, i) => {
    const s = score(n);
    if (s < bs) {
      bi = i;
      bs = s;
    }
  });
  return open.splice(bi, 1)[0];
}

/** A* over the tile grid, 4 neighbours. Returns tiles after `from`, ending at `to`. */
export function findPath(from: Tile, to: Tile): Tile[] {
  const key = (x: number, y: number) => y * COLS + x;
  const start = key(from.x, from.y);
  const open = [{ x: from.x, y: from.y, g: 0, f: 0 }];
  const came = new Map<number, number>();
  const g = new Map([[start, 0]]);
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  for (
    let cur = takeBest(open, (n) => n.f);
    cur;
    cur = takeBest(open, (n) => n.f)
  ) {
    if (cur.x === to.x && cur.y === to.y) {
      const path: Tile[] = [];
      let k: number | undefined = key(cur.x, cur.y);
      while (k !== undefined && k !== start) {
        path.push({ x: k % COLS, y: Math.floor(k / COLS) });
        k = came.get(k);
      }
      return path.reverse();
    }
    for (const [dx, dy] of STEPS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (isBlocked(nx, ny) && !(nx === to.x && ny === to.y)) continue;
      const ng = cur.g + 1;
      const k = key(nx, ny);
      if (ng >= (g.get(k) ?? Number.POSITIVE_INFINITY)) continue;
      g.set(k, ng);
      came.set(k, key(cur.x, cur.y));
      open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny) });
    }
  }
  return [to]; // ponytail: no route means a layout bug; jump there rather than freeze.
}

/** A free tile next to (x, y), for handing a report to Claude. */
export function beside(x: number, y: number): Tile {
  const around = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [0, -1],
  ] as const;
  for (const [dx, dy] of around) {
    if (!blocked[y + dy]?.[x + dx]) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}

/** Which room a tile is in (for lights). */
export function roomOf(x: number, y: number): RoomId | null {
  for (const [k, r] of Object.entries(ROOMS) as [RoomId, Rect][]) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return k;
  }
  return null;
}

// The floor a desk's name plate sits over: the row under the desk, a tile either side.
const PLATE_TILES = new Set(
  [...WORK_DESKS, ...REVIEW_DESKS].flatMap((d) =>
    [-1, 0, 1, 2, 3, 4].map((dx) => (d.y + 1) * COLS + d.x + dx),
  ),
);
// Also keep cables off Claude's rug (they read as plugged into its desk) and out from under the floor room names.
for (let y = RUG.y; y < RUG.y + RUG.h; y++) {
  for (let x = RUG.x; x < RUG.x + RUG.w; x++) PLATE_TILES.add(y * COLS + x);
}
for (const [x0, x1] of [
  [2, 8],
  [26, 34],
] as const) {
  for (let x = x0; x <= x1; x++) PLATE_TILES.add(7 * COLS + x);
}
/** Where a desk's cable comes up: the floor just right of the desk (routes keep out from under plates). */
export const plugOf = (d: Tile): Tile => ({ x: d.x + 3, y: d.y });

/** Cable route between two free tiles: like findPath, but every turn costs extra, so cables run in long
 * straight lines and round corners once instead of zigzagging. Returns tiles from `from` to `to`. */
export function cableRoute(from: Tile, to: Tile): Tile[] {
  const TURN = 6;
  const key = (x: number, y: number, d: number) => (y * COLS + x) * 4 + d;
  const under = (x: number, y: number) =>
    PLATE_TILES.has(y * COLS + x) ? 10 : 0; // keep out from under name plates
  const open: { x: number; y: number; d: number; g: number }[] = [];
  const best = new Map<number, number>();
  const came = new Map<number, number>();
  for (let d = 0; d < 4; d++) {
    open.push({ x: from.x, y: from.y, d, g: 0 });
    best.set(key(from.x, from.y, d), 0);
  }
  const score = (n: { x: number; y: number; g: number }) =>
    n.g + Math.abs(n.x - to.x) + Math.abs(n.y - to.y);
  for (let cur = takeBest(open, score); cur; cur = takeBest(open, score)) {
    if (cur.x === to.x && cur.y === to.y) {
      const out: Tile[] = [];
      for (
        let k: number | undefined = key(cur.x, cur.y, cur.d);
        k !== undefined;
        k = came.get(k)
      ) {
        const t = Math.floor(k / 4);
        out.push({ x: t % COLS, y: Math.floor(t / COLS) });
      }
      return out.reverse();
    }
    for (const [d, [dx, dy]] of STEPS.entries()) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (isBlocked(nx, ny) && !(nx === to.x && ny === to.y)) continue;
      const g = cur.g + 1 + (d === cur.d ? 0 : TURN) + under(nx, ny);
      const k = key(nx, ny, d);
      if (g >= (best.get(k) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(k, g);
      came.set(k, key(cur.x, cur.y, cur.d));
      open.push({ x: nx, y: ny, d, g });
    }
  }
  return [from, to];
}

/** A request as the request board needs it. */
export interface JobRef {
  id: string;
  n: number;
  state?: string | undefined;
}
/** A card on the request board: a request, or the "+N" stack that stands for older ones. */
export interface Card extends Rect {
  id: string;
  n?: number;
  state?: string | undefined;
  /** The stack of older requests: how many it holds, and their numbers. */
  more?: number;
  ns?: number[];
  /** The request on this floor, as a big pinned sheet. */
  big?: boolean;
}

/** Cards on the request board: the request on this floor as a big pinned sheet, earlier ones small. */
export function jobCards(jobs: readonly JobRef[], currentId: string): Card[] {
  const jb = JOB_BOARD.px;
  const cur = jobs.find((j) => j.id === currentId);
  const others = jobs.filter((j) => j.id !== currentId);
  // Six slots: the latest earlier requests; when there are more, the first slot stands for the older ones.
  const shown = others.length > 6 ? others.slice(-5) : others;
  const older = others.slice(0, others.length - shown.length);
  const slots: Omit<Card, keyof Rect>[] = [
    ...(older.length
      ? [
          {
            id: "older",
            more: older.length,
            ns: older.map((j) => j.n),
            state: "left-open",
          },
        ]
      : []),
    ...shown,
  ];
  const cards: Card[] = slots.map((j, i) => ({
    ...j,
    x: jb.x + 2 + (i % 3) * 9,
    y: jb.y + 3 + Math.floor(i / 3) * 13,
    w: 7,
    h: 11,
  }));
  if (cur)
    cards.push({ ...cur, big: true, x: jb.x + 30, y: jb.y + 2, w: 22, h: 26 });
  return cards;
}
/** The card a request is on: its own, else the "+N older" card that stands for it. */
export const cardOf = (cards: readonly Card[], n: number): Card | undefined =>
  cards.find((c) => c.n === n) ?? cards.find((c) => c.ns?.includes(n));
