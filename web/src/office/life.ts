// Ambient life on the floor: celebration bits, the report that flies to Claude, footstep dust,
// dust in the lamp light, and the office cat. None of it carries meaning; it never covers text.
import type { Pool } from "./lights";
import { CAT_SPOTS, findPath, H, T, type Tile, W } from "./map";
import { type Rows, sprite } from "./sprites";

const CONFETTI = [
  "#ffd34d",
  "#ff7eb6",
  "#7ee0ff",
  "#b28dff",
  "#8df0a8",
  "#fff3c4",
  "#ff9e5e",
]; // bright, so a burst reads as a burst
const HEART: Rows = [".#.#.", "#####", "#####", ".###.", "..#.."];
// a 4x4 "z"
const Z = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [2, 1],
  [1, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
] as const;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// The cat: orange tabby, side view facing right. O fur, o stripe, W cream, E eye, N nose.
const CAT_PAL = {
  O: "#d98e4f",
  o: "#b06a35",
  W: "#f1dcc0",
  E: "#2a1d16",
  N: "#e79a8f",
};
const CAT: Record<"a" | "b" | "sit" | "sleep" | "breathe", Rows> = {
  a: [
    "........O.O",
    "O.......OOO",
    "O.......OEO",
    ".OOoOoOOOON",
    ".OOOOOOOOW.",
    "..OWWWWWO..",
    "..O.O..O.O.",
  ],
  b: [
    "........O.O",
    "O.......OOO",
    ".O......OEO",
    ".OOoOoOOOON",
    ".OOOOOOOOW.",
    "..OWWWWWO..",
    ".O..O.O..O.",
  ],
  sit: [
    "......O.O",
    "......OOO",
    "......OEO",
    "O....OOON",
    "O...OOOW.",
    ".O.OoOOO.",
    "..OOOWWO.",
    "..OOOWWO.",
  ],
  sleep: [
    "...........",
    "...........",
    "....OO.O.O.",
    "..OOoOoOOOO",
    ".OOOOOOOoEO",
    "OWWOOOOOOOO",
    ".OOOOOOOOO.",
  ],
  // back rises a pixel
  breathe: [
    "...........",
    "...OOO.....",
    "..OOOO.O.O.",
    "..OOoOoOOOO",
    ".OOOOOOOoEO",
    "OWWOOOOOOOO",
    ".OOOOOOOOO.",
  ],
};

type Point = { x: number; y: number };
interface BitBase {
  x: number;
  y: number;
  life: number;
  age: number;
}
type Bit =
  | (BitBase & { k: "bit"; vx: number; vy: number; c: string; ph: number })
  | (BitBase & { k: "spark" | "heart" | "puff" })
  | (BitBase & {
      k: "paper";
      from: Point;
      to: Point;
      onLand?: (() => void) | undefined;
      landed?: boolean;
    });

/** Something drawn in y order with the people. */
export interface Drawable {
  y: number;
  draw(): void;
}

export interface Life {
  burst(x: number, y: number, n?: number): void;
  sparkle(x: number, y: number): void;
  heart(x: number, y: number): void;
  puff(x: number, y: number): void;
  /** A report sheet arcing from one point to another; onLand fires as it lands. */
  paper(from: Point, to: Point, onLand?: () => void): void;
  update(dt: number, now: number): void;
  draw(g: CanvasRenderingContext2D, pools: readonly Pool[]): void;
  /** The cat as something to y-sort with the people. */
  catDrawable(g: CanvasRenderingContext2D, now: number): Drawable;
  /** Send the cat somewhere now (it keeps Claude company at the door while you are asked something). */
  catTo(to: Tile, stay?: number): void;
}

export function createLife(reduced: () => boolean): Life {
  const bits: Bit[] = [];
  const motes = Array.from({ length: 48 }, () => ({
    x: rand(0, W),
    y: rand(0, H),
    vx: rand(1.5, 4),
    ph: rand(0, 6),
  }));
  const start = CAT_SPOTS[0] ?? { x: 24, y: 7 };
  const cat: {
    x: number;
    y: number;
    path: Tile[];
    state: "walk" | "sit" | "sleep";
    until: number;
    flip: boolean;
    walkT: number;
    hold?: number;
  } = {
    x: start.x * T + 8,
    y: start.y * T + 14,
    path: [],
    state: "sleep",
    until: performance.now() + 9000,
    flip: false,
    walkT: 0,
  };

  function burst(x: number, y: number, n = 24) {
    if (reduced()) return;
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15); // a tight fountain
      const v = rand(45, 95);
      bits.push({
        k: "bit",
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        c: CONFETTI[i % CONFETTI.length] ?? "#ffffff",
        life: rand(0.8, 1.2),
        age: 0,
        ph: rand(0, 6),
      });
    }
    bits.push({ k: "spark", x, y, life: 0.5, age: 0 });
  }
  function sparkle(x: number, y: number) {
    if (!reduced()) bits.push({ k: "spark", x, y, life: 0.55, age: 0 });
  }
  function heart(x: number, y: number) {
    if (!reduced()) bits.push({ k: "heart", x, y, life: 1.3, age: 0 });
  }
  function puff(x: number, y: number) {
    if (!reduced())
      bits.push({ k: "puff", x: x + rand(-2, 2), y, life: 0.35, age: 0 });
  }
  function paper(from: Point, to: Point, onLand?: () => void) {
    if (reduced()) {
      onLand?.();
      return;
    }
    bits.push({
      k: "paper",
      x: from.x,
      y: from.y,
      from,
      to,
      life: 0.6,
      age: 0,
      onLand,
    });
  }

  const catTile = () => ({
    x: Math.round((cat.x - 8) / T),
    y: Math.round((cat.y - 14) / T),
  });
  function catGo(now: number) {
    const spots = CAT_SPOTS.filter(
      (s) =>
        Math.abs(s.x * T + 8 - cat.x) + Math.abs(s.y * T + 14 - cat.y) > 3 * T,
    );
    const to = spots[Math.floor(Math.random() * spots.length)];
    if (!to) return;
    cat.path = findPath(catTile(), to);
    cat.state = "walk";
    cat.until = now + 60000;
  }

  function update(dt: number, now: number) {
    for (const b of bits) {
      b.age += dt;
      if (b.k === "bit") {
        b.vy += 160 * dt;
        b.vx *= 0.985;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      if (b.k === "paper" && b.age >= b.life && !b.landed) {
        b.landed = true;
        b.onLand?.();
      }
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      if (b && b.age >= b.life) bits.splice(i, 1);
    }
    for (const m of motes) {
      m.x += m.vx * dt;
      m.y += Math.sin(now / 1900 + m.ph) * 2 * dt;
      if (m.x > W) {
        m.x = 0;
        m.y = rand(0, H);
      }
    }

    if (reduced()) {
      cat.state = "sleep";
      return;
    }
    if (cat.state === "walk") {
      let left = 26 * dt;
      cat.walkT += dt;
      for (let next = cat.path[0]; left > 0 && next; next = cat.path[0]) {
        const p = { x: next.x * T + 8, y: next.y * T + 14 };
        const dx = p.x - cat.x;
        const dy = p.y - cat.y;
        const d = Math.hypot(dx, dy);
        if (dx) cat.flip = dx < 0;
        if (d <= left) {
          cat.x = p.x;
          cat.y = p.y;
          left -= d;
          cat.path.shift();
        } else {
          cat.x += (dx / d) * left;
          cat.y += (dy / d) * left;
          left = 0;
        }
      }
      if (!cat.path.length) {
        cat.state = "sit";
        cat.until = Math.max(now + rand(3500, 7000), cat.hold ?? 0);
      }
    } else if (now > cat.until) {
      if (cat.state === "sit" && Math.random() < 0.6) {
        cat.state = "sleep";
        cat.until = now + rand(12000, 26000);
      } else catGo(now);
    }
  }

  const catDrawable = (g: CanvasRenderingContext2D, now: number): Drawable => ({
    y: cat.y,
    draw() {
      let rows: Rows;
      if (cat.state === "walk")
        rows = Math.floor(cat.walkT * 6) % 2 ? CAT.a : CAT.b;
      else rows = CAT[cat.state];
      const frame =
        cat.state === "sleep" && !reduced() && Math.floor(now / 1100) % 2
          ? CAT.breathe
          : rows;
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(Math.round(cat.x) - 5, Math.round(cat.y), 10, 1);
      g.drawImage(
        sprite(frame, CAT_PAL, cat.flip),
        Math.round(cat.x) - 5,
        Math.round(cat.y) - frame.length + 1,
      );
      if (cat.state === "sleep" && !reduced()) {
        for (let k = 0; k < 2; k++) {
          const p = (now / 2400 + k * 0.5) % 1;
          const a = Math.min(1, p * 3) * (1 - p) * 0.8;
          g.fillStyle = `rgba(214,222,236,${a.toFixed(3)})`;
          for (const [zx, zy] of Z) {
            g.fillRect(
              Math.round(cat.x + 4 + p * 6 + (cat.flip ? -10 : 0)) + zx,
              Math.round(cat.y - 8 - p * 12) + zy,
              1,
              1,
            );
          }
        }
      }
    },
  });

  function draw(g: CanvasRenderingContext2D, pools: readonly Pool[]) {
    // Dust only shows where a lamp catches it.
    if (!reduced()) {
      for (const m of motes) {
        for (const p of pools) {
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < p.r * 0.85) {
            g.fillStyle = `rgba(255,236,205,${(0.32 * (1 - d / (p.r * 0.85))).toFixed(3)})`;
            g.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
            break;
          }
        }
      }
    }
    for (const b of bits) {
      const p = b.age / b.life;
      if (b.k === "bit") {
        g.globalAlpha = Math.min(1, (1 - p) * 2.5);
        const turn = Math.sin(b.age * 16 + b.ph); // flutter: the bit turns edge-on and back
        g.fillStyle = b.c;
        g.fillRect(
          Math.round(b.x),
          Math.round(b.y),
          2,
          Math.abs(turn) > 0.5 ? 1 : 2,
        );
      } else if (b.k === "spark") {
        // A four-point twinkle: gold arms that taper to white tips, swelling then shrinking.
        const s = Math.round(1 + Math.sin(p * Math.PI) * 3);
        const x = Math.round(b.x);
        const y = Math.round(b.y);
        for (let k = 1; k <= s; k++) {
          g.globalAlpha = (1 - p * 0.5) * (1 - (k - 1) / (s + 1));
          g.fillStyle = k === s ? "#ffffff" : "#ffd96b";
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            g.fillRect(x + dx * k, y + dy * k, 1, 1);
          }
        }
        g.globalAlpha = 1;
        g.fillStyle = "#ffffff";
        g.fillRect(x, y, 1, 1);
      } else if (b.k === "heart") {
        g.globalAlpha = Math.min(1, (1 - p) * 2);
        const y = Math.round(b.y - p * 14 - Math.sin(p * Math.PI) * 2);
        g.drawImage(sprite(HEART, { "#": "#ff8fa8" }), Math.round(b.x) - 2, y);
      } else if (b.k === "puff") {
        g.globalAlpha = 0.28 * (1 - p);
        g.fillStyle = "#cfc6b8";
        g.fillRect(Math.round(b.x - p * 2), Math.round(b.y - p * 2), 1, 1);
        g.fillRect(Math.round(b.x + 1 + p * 2), Math.round(b.y - p * 2), 1, 1);
      } else if (b.k === "paper") {
        const e = Math.min(1, p);
        const x = b.from.x + (b.to.x - b.from.x) * e;
        const y =
          b.from.y + (b.to.y - b.from.y) * e - Math.sin(e * Math.PI) * 16;
        g.globalAlpha = 1;
        g.fillStyle = "#eee8da";
        g.fillRect(Math.round(x) - 2, Math.round(y) - 3, 5, 6);
        g.fillStyle = "#9a948a";
        g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 1);
        g.fillRect(Math.round(x) - 1, Math.round(y) + 1, 2, 1);
      }
      g.globalAlpha = 1;
    }
  }

  function catTo(to: Tile, stay = 45000) {
    if (reduced()) return;
    cat.hold = performance.now() + stay; // and stays a while once there
    cat.path = findPath(catTile(), to);
    cat.state = "walk";
    cat.until = performance.now() + 60000;
  }

  return {
    burst,
    sparkle,
    heart,
    puff,
    paper,
    update,
    draw,
    catDrawable,
    catTo,
  };
}
