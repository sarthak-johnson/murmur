// The still floor: floors, walls and fixed furniture. Drawn once. Desks are live (desks.ts).
import {
  BOARD,
  COLS,
  CONSOLE,
  COOLER,
  DOOR,
  H,
  JOB_BOARD,
  POSTERS,
  RACKS,
  ROWS,
  RUG,
  SHELVES,
  T,
  tileKind,
  W,
} from "./map";
import { canvas2d, pick } from "./util";

export const WOOD = {
  top: "#5e4130",
  hi: "#73513c",
  face: "#46301f",
  leg: "#2f2016",
};
export const BINDERS = [
  "#6b5a7a",
  "#5a6b7a",
  "#7a6b5a",
  "#5e7066",
  "#7a5e66",
  "#666a74",
  "#7d7060",
  "#585e72",
];
export const SHELF_SLOTS = 3 * 15; // shelves x binders, for lighting binders by file

/** Fills one rect in a colour: every drawing here is made of these. */
export type Fill = (
  x: number,
  y: number,
  w: number,
  h: number,
  col: string,
) => void;
export const filler =
  (g: CanvasRenderingContext2D): Fill =>
  (x, y, w, h, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };

function floorTile(r: Fill, x: number, y: number) {
  const k = tileKind(x, y);
  const px = x * T;
  const py = y * T;
  if (k === "plan") {
    r(px, py, T, T, "#1f232c");
    if ((x + y) % 2 === 0) {
      r(px + 4, py + 4, 2, 2, "#242936");
      r(px + 12, py + 12, 2, 2, "#242936");
    }
  } else if (k === "review") {
    r(px, py, T, T, "#241e2a");
    if ((x + y) % 2) r(px + 8, py + 8, 2, 2, "#2a2331");
  } else if (k === "work") {
    r(px, py, T, T, "#2b221d");
    r(px, py + 7, T, 1, "#262019");
    r(px, py + 15, T, 1, "#262019");
    if ((x + y * 3) % 4 === 0) r(px + 6, py, 1, 7, "#262019");
    if ((x + y * 3 + 2) % 4 === 0) r(px + 11, py + 8, 1, 7, "#262019");
  } else if (k === "corner") {
    r(px, py, T, T, (x + y) % 2 ? "#28231f" : "#2c2622");
    r(px, py, T, 1, "#211d1a");
    r(px, py, 1, T, "#211d1a");
  } else if (k === "wall-cap") {
    r(px, py, T, T, "#100d0c");
    r(px, py, T, 1, "#2a211c");
  } else if (k === "wall-face" || k === "door") {
    r(px, py, T, T, "#3a2d26");
    r(px, py, T, 3, "#46372e");
    r(px, py + 13, T, 3, "#2a1f1a");
    if (x % 4 === 0) r(px, py + 3, 1, 10, "#33271f");
  }
}

export function drawBackground(): HTMLCanvasElement {
  const { c, g } = canvas2d(W, H);
  const r = filler(g);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) floorTile(r, x, y);
  }

  // Whiteboard: the notes are drawn live.
  const b = BOARD.px;
  r(b.x - 2, b.y - 2, b.w + 4, b.h + 4, "#7c838c");
  r(b.x - 1, b.y - 1, b.w + 2, b.h + 2, "#5d636b");
  r(b.x, b.y, b.w, b.h, "#c4cad1");
  r(b.x, b.y, b.w, 17, "#b3bac3");
  r(b.x + 10, b.y + b.h + 2, b.w - 20, 3, "#5d636b");
  r(b.x + 30, b.y + b.h + 1, 6, 2, "#4b78b0");
  r(b.x + 40, b.y + b.h + 1, 6, 2, "#2b2f36");

  // Request board (cards are live).
  const jb = JOB_BOARD.px;
  r(jb.x - 2, jb.y - 2, jb.w + 4, jb.h + 4, "#4d3527");
  r(jb.x, jb.y, jb.w, jb.h, "#7a5a3a");
  for (let i = 0; i < 14; i++) {
    r(jb.x + ((i * 37) % jb.w), jb.y + ((i * 13) % jb.h), 1, 1, "#6a4d31");
  }

  // Archive shelves against the wall.
  const sh = SHELVES.px;
  r(sh.x, sh.y, sh.w, sh.h, "#4d3527");
  r(sh.x + 2, sh.y + 2, sh.w - 4, sh.h - 4, "#2a1d15");
  for (let s = 0; s < 3; s++) {
    r(sh.x + 2, sh.y + 14 + s * 14, sh.w - 4, 2, "#4d3527");
    for (let k = 0; k < 15; k++) {
      r(
        sh.x + 5 + k * 4 + (k > 7 ? 3 : 0),
        sh.y + 4 + s * 14,
        3,
        10,
        pick(BINDERS, k + s * 3),
      );
    }
  }

  // Server racks and the console in front of them.
  for (let i = 0; i < 3; i++) {
    const x = RACKS.px.x + i * 15;
    const y = RACKS.px.y;
    r(x, y, 14, RACKS.px.h, "#2c3038");
    r(x + 1, y + 1, 12, RACKS.px.h - 2, "#1b1e24");
    for (let j = 0; j < 7; j++) {
      r(x + 2, y + 4 + j * 6, 10, 3, "#262a31");
      r(x + 3, y + 5 + j * 6, 1, 1, j % 3 ? "#4d6b8a" : "#9fb3c8");
    }
  }
  const cx = CONSOLE.x * T;
  const cy = CONSOLE.y * T;
  r(cx + 2, cy + 2, CONSOLE.w * T - 4, 9, "#3a3e46");
  r(cx + 2, cy + 11, CONSOLE.w * T - 4, 4, "#262a30");
  // screen with a prompt
  r(cx + 5, cy + 3, 18, 7, "#11161b");
  r(cx + 6, cy + 5, 2, 1, "#74d394");
  r(cx + 9, cy + 5, 9, 1, "#4f7a63");
  r(cx + 6, cy + 7, 6, 1, "#3d5a4b");
  for (let k = 0; k < 9; k++) {
    r(cx + 26 + (k % 3) * 5, cy + 4 + Math.floor(k / 3) * 2, 4, 1, "#535965"); // keys
  }

  // Your door: frame here; the leaf (shut or open) is live.
  const d = DOOR.px;
  r(d.x - 3, d.y - 1, d.w + 6, d.h + 2, "#5c4a3f");
  r(d.x - 3, d.y - 1, d.w + 6, 2, "#6b5749");
  // The YOU plate, its word in pixels: whole and crisp at every scale.
  const px = d.x + d.w + 3;
  const py = d.y + 10;
  r(px, py, 15, 9, "#d9d4c6");
  r(px + 1, py + 1, 13, 7, "#c4bdae");
  const YOU = ["101111101", "101101101", "010101101", "010101101", "010111111"];
  YOU.forEach((row, y) => {
    for (let x = 0; x < row.length; x++)
      if (row[x] === "1")
        r(px + 2 + x + Math.floor(x / 3), py + 2 + y, 1, 1, "#2a211c");
  });

  // Rug under Claude's desk: a soft border and a few woven dots.
  {
    const x = RUG.x * T + 4;
    const y = RUG.y * T + 6;
    const w = RUG.w * T - 8;
    const h = RUG.h * T - 10;
    r(x, y, w, h, "#3a2b29");
    r(x + 2, y + 2, w - 4, h - 4, "#45322f");
    r(x + 4, y + 4, w - 8, h - 8, "#3d2d2b");
    for (let i = 8; i < w - 8; i += 8) {
      r(x + i, y + 3, 2, 1, "#5e4540");
      r(x + i, y + h - 4, 2, 1, "#5e4540");
    }
  }
  // Doormat inside your door.
  r(DOOR.px.x + 2, 2 * T + 1, DOOR.px.w - 4, 5, "#3d3226");
  r(DOOR.px.x + 3, 2 * T + 2, DOOR.px.w - 6, 3, "#4d3f2f");

  // Framed pictures on the work floor and review room walls.
  for (const p of POSTERS) {
    r(p.x, p.y, 22, 12, "#2a1f1a");
    r(p.x + 1, p.y + 1, 20, 10, "#c9b48a");
    if (p.art === "hills") {
      // dusk sky
      r(p.x + 2, p.y + 2, 18, 8, "#f0b98a");
      r(p.x + 2, p.y + 2, 18, 3, "#e98d7a");
      r(p.x + 13, p.y + 3, 3, 3, "#ffe2a8"); // sun
      r(p.x + 2, p.y + 7, 18, 3, "#5e7f6a");
      r(p.x + 5, p.y + 6, 6, 1, "#5e7f6a");
      r(p.x + 6, p.y + 5, 3, 1, "#5e7f6a");
      r(p.x + 14, p.y + 6, 5, 1, "#4d6b59");
    } else {
      r(p.x + 2, p.y + 2, 18, 8, "#eae4d6");
      // a chart going up
      [2, 3, 3, 5, 4, 6, 7].forEach((h, i) => {
        r(p.x + 4 + i * 2, p.y + 9 - h, 1, h, i === 6 ? "#74d394" : "#8b93a6");
      });
    }
  }

  // Water cooler: a blue bottle on a cream stand.
  {
    const x = COOLER.x * T + 3;
    const y = COOLER.y * T;
    r(x + 1, y - 10, 8, 9, "#6ba4d6");
    r(x + 2, y - 11, 6, 1, "#8dbbe3");
    r(x + 2, y - 9, 2, 6, "#a9cdee");
    r(x + 3, y - 12, 4, 2, "#4a7ca8");
    r(x, y - 1, 10, 14, "#d8d1c2");
    r(x, y - 1, 10, 1, "#e9e3d6");
    r(x + 2, y + 3, 2, 2, "#4b78b0");
    r(x + 6, y + 3, 2, 2, "#c45a50");
    r(x + 1, y + 13, 8, 2, "#2a221d");
  }
  return c;
}

/** A potted plant at tile (x, y); its leaves lean by `sway` px. Drawn live so it can move. */
export function drawPlant(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  sway: number,
) {
  const r = filler(g);
  r(x + 4, y + 9, 8, 6, "#6b4a35");
  r(x + 3, y + 8, 10, 2, "#7d5a42");
  r(x + 4, y + 14, 8, 1, "#4f3627");
  r(x + 2, y + 1, 12, 8, "#2f4d45");
  r(x + 5 + sway, y - 3, 6, 6, "#355a50");
  r(x + 1 + sway, y + 3, 3, 3, "#355a50");
  r(x + 12 + sway, y + 2, 3, 3, "#355a50");
  // leaf highlights
  r(x + 7 + sway, y - 3, 2, 1, "#4a7466");
  r(x + 3, y + 2, 2, 1, "#4a7466");
}
