// Pixel art drawn from small grids. Our own sprites: 14x22 people at 3/4 top-down.
// Keys: H hair, S skin, E eyes, R blush, M mouth, C shirt, D shirt shade, P trousers, B shoes, X hat/headphones, K Claude's mark.
import { canvas2d, pick } from "./util";

type Dir = "down" | "up" | "side";
type Legs = "stand" | "a" | "b";
export type Rows = readonly string[];
export type Poses = Record<Legs, Rows>;
/** A character's frames: three facings in three leg poses, and a seated frame. */
export interface Frames {
  down: Poses;
  up: Poses;
  side: Poses;
  sit: Rows;
}
/** Colours by grid key. */
export type Pal = {
  H: string;
  S: string;
  E: string;
  R: string;
  M: string;
  C: string;
  D: string;
  P: string;
  B: string;
  K?: string;
  X?: string;
  x?: string;
  L?: string;
  G?: string;
};
export type HelperStyle =
  | "short"
  | "long"
  | "tail"
  | "cap"
  | "beanie"
  | "phones";

const HEAD: Record<Dir, Rows> = {
  // a small smile
  down: [
    "....HHHHHH....",
    "...HHHHHHHH...",
    "..HHHHHHHHHH..",
    "..HHHHHHHHHH..",
    "..HSSSSSSSSH..",
    "..SSSSSSSSSS..",
    "..SSESSSSESS..",
    "..SRESSSSERS..",
    "...SSMSSMSS...",
    "....SSMMSS....",
  ],
  up: [
    "....HHHHHH....",
    "...HHHHHHHH...",
    "..HHHHHHHHHH..",
    "..HHHHHHHHHH..",
    "..HHHHHHHHHH..",
    "..HHHHHHHHHH..",
    "..HHHHHHHHHH..",
    "..HHHHHHHHHH..",
    "...HHHHHHHH...",
    "....SSSSSS....",
  ],
  side: [
    "....HHHHHH....",
    "...HHHHHHHH...",
    "..HHHHHHHHHH..",
    "..HHHHHHSSSS..",
    "..HHHHHSSSSS..",
    "..HHHHSSSSSSS.",
    "..HHHHSSSSESS.",
    "...HHHSSSRESS.",
    "....HSSSSMS...",
    ".....SSSSSS...",
  ],
};
const BODY: Rows = [
  "...CCCCCCCC...",
  "..CCCCCCCCCC..",
  ".CCCCCCCCCCCC.",
  ".CDCCCCCCCCDC.",
  ".CDCCCCCCCCDC.",
  ".SDCCCCCCCCDS.",
  "..DDDDDDDDDD..",
];
const BODY_SIDE: Rows = [
  "....CCCCCC....",
  "...CCCCCCCC...",
  "...CCCCCCCC...",
  "...CCDCCCCC...",
  "...CCSCCCCC...",
  "...CCSCCCCC...",
  "....DDDDDD....",
];
const LEGS: Poses = {
  stand: [
    "..PPPPPPPPPP..",
    "..PPPP..PPPP..",
    "..PPPP..PPPP..",
    "..PPP....PPP..",
    "..BBB....BBB..",
  ],
  a: [
    "..PPPPPPPPPP..",
    "..PPPP..PPPP..",
    "..BBBB..PPPP..",
    "........PPP...",
    "........BBB...",
  ],
  b: [
    "..PPPPPPPPPP..",
    "..PPPP..PPPP..",
    "..PPPP..BBBB..",
    "...PPP........",
    "...BBB........",
  ],
};
const LEGS_SIDE: Poses = {
  stand: [
    "....PPPPPP....",
    "....PPPPPP....",
    "....PP..PP....",
    "....PP..PP....",
    "....BB..BBB...",
  ],
  a: [
    "....PPPPPP....",
    "...PPP..PPP...",
    "..PPP....PPP..",
    "..PP......PP..",
    ".BBB......BBB.",
  ],
  b: [
    "....PPPPPP....",
    ".....PPPP.....",
    ".....PPP......",
    ".....PPP......",
    ".....BBBB.....",
  ],
};

// Silhouettes: hair styles and things on the head, so helpers differ without status-like colours.
const STYLES: Record<HelperStyle, (rows: Rows, dir: Dir) => Rows> = {
  short: (rows) => rows,
  long: (rows, dir) =>
    rows.map((r, i) => {
      if (i >= 4 && i <= 9 && dir !== "side") return `.HH${r.slice(3, 11)}HH.`;
      if (dir === "side" && i >= 4 && i <= 10)
        return `${r.slice(0, 2)}HHH${r.slice(5)}`;
      return r;
    }),
  tail: (rows, dir) =>
    rows.map((r, i) => {
      if (i < 3 || i > 9) return r;
      if (dir === "side") return `HH${r.slice(2)}`;
      if (dir === "up") return `${r.slice(0, 6)}HH${r.slice(8)}`;
      return `${r.slice(0, 12)}HH`;
    }),
  cap: (rows, dir) =>
    rows.map((r, i) => {
      if (i < 4) return r.replace(/H/g, "X");
      if (i === 4 && dir === "down") return "..XXXXXXXXXX..";
      if (i === 4 && dir === "side") return "..HHHHXXXXXXX.";
      return r;
    }),
  beanie: (rows) =>
    rows.map((r, i) => {
      if (i === 0) return "....XXXXXX....";
      if (i < 3) return r.replace(/H/g, "X");
      if (i === 3) return r.replace(/H/g, "x");
      return r;
    }),
  phones: (rows, dir) =>
    rows.map((r, i) => {
      if (i === 1) return "...XXXXXXXX...";
      if (i >= 5 && i <= 7) {
        return dir === "side"
          ? `${r.slice(0, 5)}XX${r.slice(7)}`
          : `${r[0]}X${r.slice(2, 12)}X${r[13]}`;
      }
      return r;
    }),
};
const STYLE_NAMES: HelperStyle[] = [
  "short",
  "phones",
  "cap",
  "long",
  "beanie",
  "tail",
];

function person(style: HelperStyle, dir: Dir, legs: Legs): Rows {
  const head = STYLES[style](HEAD[dir], dir);
  return [
    ...head,
    ...(dir === "side" ? BODY_SIDE : BODY),
    ...(dir === "side" ? LEGS_SIDE : LEGS)[legs],
  ];
}
// A lanyard (L strap, G badge) for a helper still working for an earlier request.
const set = (row: string, cols: number[], ch: string) =>
  [...row].map((c, i) => (cols.includes(i) && c !== "." ? ch : c)).join("");
function lanyard(rows: Rows, dir: Dir): Rows {
  const b = 10; // first body row
  return rows.map((r, i) => {
    if (dir === "up") return i === b ? set(r, [5, 8], "L") : r;
    if (dir === "side") {
      if (i === b) return set(r, [7], "L");
      return i === b + 1 || i === b + 2 ? set(r, [7], "G") : r;
    }
    if (i === b) return set(r, [5, 8], "L");
    return i === b + 1 || i === b + 2 ? set(r, [6, 7], "G") : r; // badge high enough to show over a desk
  });
}

function poses(p: (dir: Dir, legs: Legs) => Rows): Omit<Frames, "sit"> {
  const pose = (dir: Dir): Poses => ({
    stand: p(dir, "stand"),
    a: p(dir, "a"),
    b: p(dir, "b"),
  });
  return { down: pose("down"), up: pose("up"), side: pose("side") };
}

export function framesFor(style: HelperStyle, carried = false): Frames {
  const p = (dir: Dir, legs: Legs) =>
    carried ? lanyard(person(style, dir, legs), dir) : person(style, dir, legs);
  // Seated: above the desk edge only; hands are drawn on the desk.
  return { ...poses(p), sit: p("down", "stand").slice(0, 16) };
}

// Claude: taller (24 rows), a long cream cardigan, and a small dark mark on the chest.
function claudeRows(dir: Dir, legs: Legs): Rows {
  const p = person("short", dir, legs);
  const body = p.slice(10, 17);
  if (dir !== "up")
    body[2] = dir === "side" ? "...CCCCKCC...." : ".CCCCCCCCCKCC.";
  const coat = dir === "side" ? "...CCCCCCCC..." : ".CCCCCCCCCCCC.";
  return [
    ...p.slice(0, 10),
    ...body.slice(0, 5),
    coat,
    coat,
    body[5] ?? coat,
    coat.replace(/C/g, "D"),
    ...p.slice(17),
  ];
}
export const CLAUDE_FRAMES: Frames = {
  ...poses(claudeRows),
  sit: claudeRows("down", "stand").slice(0, 17),
};

export const CLAUDE_PAL: Pal = {
  H: "#3b2a20",
  S: "#e9c19a",
  E: "#2a1d16",
  R: "#e7a08c",
  M: "#b07a62",
  C: "#ece2cf",
  D: "#c9bca4",
  K: "#4a3a55",
  P: "#3a3f4c",
  B: "#1c1e23",
};
// Muted cool shirts, all under 35% saturation, none reading as a status colour.
const SHIRTS: readonly (readonly [string, string])[] = [
  ["#6b7686", "#566070"],
  ["#678381", "#526a68"],
  ["#7b7491", "#635d77"],
  ["#958d7f", "#7a7366"],
  ["#85707f", "#6c5a67"],
  ["#555a63", "#43474f"],
];
const HAIR = ["#2b1d14", "#4a3020", "#1a1a1f", "#6b4a2e", "#5b5550", "#3d2a3a"];
const SKIN = ["#f1cfac", "#d9a77c", "#b07d55", "#8f5d3e"];
const BLUSH = ["#eca598", "#d88a74", "#b5684f", "#96513d"]; // each skin, a little rosier
const GEAR = ["#3e4350", "#5a5246", "#2f3a3a", "#4b4458"];

/** The office's string hash: stable per id, so looks and clocks never change between frames. */
export const hash = (s: string): number =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A helper's look: silhouette from its place in the start order, colours from its id. */
export function helperLook(
  id: string,
  i: number,
): { style: HelperStyle; pal: Pal } {
  const h = hash(id);
  const [C, D] = pick(SHIRTS, i + (h % 2));
  const g = pick(GEAR, h);
  return {
    style: pick(STYLE_NAMES, i),
    pal: {
      L: "#eadfc6",
      G: "#e3b84f",
      H: pick(HAIR, h),
      S: pick(SKIN, h >>> 3),
      R: pick(BLUSH, h >>> 3),
      E: "#20160f",
      M: "#9a6a55",
      C,
      D,
      P: "#2f3440",
      B: "#191a1e",
      X: g,
      x: "#2a2e36",
    },
  };
}

/** The same frame with its eyes shut: the upper eye pixels become skin, leaving a lash line. */
export const closeEyes = (rows: Rows): Rows =>
  rows.map((r, i) => (i === 6 ? r.replace(/E/g, "S") : r));

/** Blinks on each character's own clock: a gap of 2.6 to 6 s, now and then a double blink. */
export function blinking(id: string, now: number): boolean {
  const h = hash(id);
  const gap = 2600 + (h % 3400);
  const t = (now + h * 131) % gap;
  const n = Math.floor((now + h * 131) / gap);
  return t < 120 || (n % 4 === (h >>> 5) % 4 && t > 240 && t < 360);
}

// Pure cache: the same grid in the same palette is always the same pixels.
const cache = new Map<string, HTMLCanvasElement>();
/** A cached canvas for a grid in a palette, optionally mirrored. */
export function sprite(
  rows: Rows,
  pal: Readonly<Record<string, string | undefined>>,
  flip = false,
): HTMLCanvasElement {
  const k = rows.join("") + JSON.stringify(pal) + flip;
  const hit = cache.get(k);
  if (hit) return hit;
  const { c, g } = canvas2d(rows[0]?.length ?? 0, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = pal[ch];
      if (ch === "." || !col) return;
      g.fillStyle = col;
      g.fillRect(flip ? row.length - 1 - x : x, y, 1, 1);
    });
  });
  cache.set(k, c);
  return c;
}

// Phase colours: soft pastels that tie a board column to its desks, threads and binders. None of them
// is a status colour (blue running, green done, amber waiting, red failed, grey not started).
// Neighbours sit far apart on the wheel (pink, orange, violet, lemon, teal, ...), so adjacent phases never merge.
export const PHASE = [
  "#f78fc7",
  "#f99a5b",
  "#a98bff",
  "#e8dc72",
  "#4fc6d0",
  "#d7a88a",
  "#e57fa0",
  "#b3c2ff",
];
export const phaseColor = (i: number | null | undefined): string | null =>
  i == null || i < 0 ? null : (PHASE[i % PHASE.length] ?? null);
export const LINEAGE = "#eadfc6"; // threads and lanyards back to an earlier request

export type StatusKey = "done" | "now" | "blocked" | "failed" | "todo";
export interface StatusColors {
  base: string;
  dark: string;
  hi: string;
}
// Status colours: the only place they live on the canvas.
export const STATUS: Record<StatusKey, StatusColors> = {
  done: { base: "#74d394", dark: "#2f6446", hi: "#9be3b2" },
  now: { base: "#6db4ff", dark: "#244a73", hi: "#9ccdff" },
  blocked: { base: "#ffbf4a", dark: "#6f5014", hi: "#ffd685" },
  failed: { base: "#ff6f61", dark: "#7a2a22", hi: "#ff9b90" },
  todo: { base: "#8d939c", dark: "#555b64", hi: "#a9aeb5" },
};
export const REQ_STATE: Record<string, StatusKey> = {
  running: "now",
  waiting: "blocked",
  done: "done",
  failed: "failed",
  "left-open": "todo",
};
type Mark = readonly (readonly [number, number])[];
export const MARKS: Record<"tick" | "bang" | "cross", Mark> = {
  tick: [
    [0, 3],
    [1, 4],
    [2, 5],
    [3, 4],
    [4, 3],
    [5, 2],
    [6, 1],
    [7, 0],
    [1, 3],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 1],
    [6, 0],
  ],
  bang: [
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 5],
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 5],
  ],
  cross: [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [4, 0],
    [3, 1],
    [1, 3],
    [0, 4],
  ],
};
