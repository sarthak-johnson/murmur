// Live canvas: board, cards, lights, desks and the people walking between spots.

import { type State, TONE } from "../state";
import { drawBackground, drawPlant, filler, SHELF_SLOTS } from "./background";
import { deskTile, drawDesks, seatOf } from "./desks";
import { createLife } from "./life";
import { createLights, type Pool } from "./lights";
import {
  BOARD,
  BOARD_INNER,
  beside,
  boardColumns,
  CLAUDE_DESK,
  CLOCK,
  cableRoute,
  cardOf,
  chairOf,
  DOOR,
  type Face,
  findPath,
  H,
  jobCards,
  OUTSIDE,
  PLANTS,
  plugOf,
  RACKS,
  SHELVES,
  type Spot,
  spotTile,
  T,
  type Tile,
  W,
} from "./map";
import type { Act, Note, Scene } from "./scene";
import {
  blinking,
  CLAUDE_FRAMES,
  CLAUDE_PAL,
  closeEyes,
  type Frames,
  framesFor,
  hash,
  helperLook,
  LINEAGE,
  MARKS,
  type Mark,
  type Pal,
  phaseColor,
  REQ_STATE,
  STATUS,
  sprite,
} from "./sprites";
import { context2d } from "./util";

export { deskTile };

const SPEED = 64; // px per second
const center = (t: Tile) => ({ x: t.x * T + 8, y: t.y * T + 15 });
// Each kind of work throws its own faint screen light: code blue, paper warm, terminal cool grey.
const GLOW: Record<Act, string> = {
  edit: "120,175,255",
  read: "255,232,196",
  search: "196,228,236",
  run: "186,196,214",
};

// Note titles wrap in the DOM at 15 px (11 px under 3x); measure here so the canvas stickies
// line up with them. Pure cache: one measuring context, made on first use.
let mctx: CanvasRenderingContext2D | undefined;
function textWidth(text: string, px: number): number {
  mctx ??= context2d(document.createElement("canvas"));
  mctx.font = `500 ${px}px Geist, system-ui, sans-serif`;
  return mctx.measureText(text).width;
}
function lineCount(text: string, width: number, px = 15): number {
  mctx ??= context2d(document.createElement("canvas"));
  mctx.font = `500 ${px}px Geist, system-ui, sans-serif`;
  let lines = 1;
  let cur = 0;
  for (const w of text.split(/\s+/)) {
    const ww = mctx.measureText(`${w} `).width;
    if (cur + ww > width && cur > 0) {
      lines++;
      cur = ww;
    } else cur += ww;
  }
  return lines;
}

/** Under 3x a sticky narrower than this many CSS px for its title shows only its mark. */
const SMALL_TEXT_MIN = 26;
const SUB_W = 64; // a column wider than two of these flows its stickies into sub-columns

/** A sticky where it sits on the board. Its hit box spans the sub-column (`slotW`) and its text (`rowH`). */
export interface PlacedNote extends Note {
  x: number;
  y: number;
  w: number;
  h: number;
  rowH: number;
  textW: number;
  slotW: number;
  /** Under 3x: how many lines of its title it shows (0, only its mark: too narrow or small). */
  lines: number;
  /** Under 3x: a left-open note says so on a line of its own (it fits). */
  leftLine: boolean;
}
/** A board column where it sits, with the stickies that fit and how many did not. */
export interface PlacedColumn {
  x: number;
  w: number;
  id: string;
  title: string;
  status: Scene["columns"][number]["status"];
  hidden: number;
  notes: PlacedNote[];
  subs: number;
  subW: number;
}

/** Note rects on the board for scale s, shared with the DOM overlay. A wide column (one phase
 * holding a whole plan) flows into sub-columns; when stickies still do not fit, done ones go
 * first, so what is under way always shows. */
export function boardLayout(
  scene: Pick<Scene, "columns">,
  s: number,
): PlacedColumn[] {
  // Asked for several times a frame, and it measures text: kept per scene and scale.
  const kept = layouts.get(scene.columns)?.get(s);
  if (kept) return kept;
  const made = layOut(scene, s);
  const byScale =
    layouts.get(scene.columns) ?? new Map<number, PlacedColumn[]>();
  byScale.set(s, made);
  layouts.set(scene.columns, byScale);
  return made;
}
let layouts = new WeakMap<Scene["columns"], Map<number, PlacedColumn[]>>();
// Measured before the web font came in, every title's lines were the fallback's: measured again.
document.fonts?.addEventListener?.("loadingdone", () => {
  layouts = new WeakMap();
});

function layOut(scene: Pick<Scene, "columns">, s: number): PlacedColumn[] {
  const cols = boardColumns(scene.columns.length || 1);
  const full = BOARD.px.y + BOARD.px.h - 2;
  return scene.columns.flatMap((c, i) => {
    const col = cols[i];
    if (!col) return [];
    /** Under 3x, the title's lines of 12 px (at most two) and a left-open note's word line. */
    // A title shows only where its first word fits whole ("Buil…" says nothing), and a
    // left-open note's word line only where it fits whole too.
    const small = (n: Note, subW: number) => {
      const tw = (subW - 20) * s - 4;
      const first = n.title.split(/\s+/)[0] ?? "";
      if (s < 1 || tw < SMALL_TEXT_MIN || textWidth(first, 11) > tw)
        return { lines: 0, rows: 0, left: false };
      const left =
        !!n.stage &&
        (n.status === "open" || n.status === "paused") &&
        textWidth(n.stage, 10) <= tw;
      const lines = left ? 1 : Math.min(2, lineCount(n.title, tw, 11));
      return { lines, rows: lines + (left ? 1 : 0), left };
    };
    const height = (n: Note, subW: number) => {
      if (s < 3)
        return Math.max(12, Math.ceil((small(n, subW).rows * 12 + 2) / s));
      const lines = lineCount(n.title, (subW - 20) * s);
      return Math.max(12, Math.ceil((lines * 19 + (n.stage ? 18 : 0)) / s));
    };
    const place = (list: Note[], subs: number, bottom = full) => {
      const subW = Math.floor(col.w / subs);
      const out: PlacedNote[] = [];
      let k = 0;
      let y = BOARD_INNER.notesY;
      for (const n of list) {
        const h = height(n, subW);
        if (
          out.length &&
          (y + Math.min(h, 12) > bottom || y + h > bottom + 4)
        ) {
          k++;
          if (k >= subs) break;
          y = BOARD_INNER.notesY;
        }
        out.push({
          ...n,
          x: col.x + k * subW + 3,
          y,
          w: 12,
          h: 12,
          rowH: h,
          textW: subW - 20,
          slotW: subW,
          lines: s < 3 ? small(n, subW).lines : 0,
          leftLine: s < 3 && small(n, subW).left,
        });
        y += h + 4;
      }
      return out;
    };
    // The fewest sub-columns that hold every sticky: few stickies get the column's whole width.
    const most = Math.max(1, Math.floor(col.w / SUB_W));
    let subs = 1;
    while (subs < most && place(c.notes, subs).length < c.notes.length) subs++;
    const subW = Math.floor(col.w / subs);
    let list = c.notes;
    let notes = place(list, subs);
    while (
      notes.length < list.length &&
      list.some((n) => n.status === "done")
    ) {
      const firstDone = list.find((k) => k.status === "done");
      list = list.filter((n) => n !== firstDone);
      notes = place(list, subs);
    }
    // Anything still hidden gets a "+N more" line at the foot of the column: keep it clear of the notes.
    if (notes.length < c.notes.length) notes = place(list, subs, full - 9);
    return [
      {
        ...col,
        id: c.id,
        title: c.title,
        status: c.status,
        hidden: c.notes.length - notes.length,
        notes,
        subs,
        subW,
      },
    ];
  });
}

/** Someone on the floor: Claude or a helper. */
export interface Actor {
  id: string;
  frames: Frames;
  pal: Pal;
  x: number;
  y: number;
  path: Tile[];
  goal: Spot;
  /** What to do on arrival: settle at a spot, hand a report to Claude, or leave by your door. */
  arrive?: Spot | "hand" | "vanish" | undefined;
  pose?: "walk" | "sit" | "stand";
  face?: Face;
  leaving?: boolean;
  /** Holding a finished report. */
  carrying?: boolean;
  /** Holding Claude's brief, on the way in. */
  folder?: boolean;
  hopAt?: number;
  walkT?: number;
  lastStep?: number;
}

/** Claude's on-screen anchor: feet when standing, the seat when at its desk. */
export interface ClaudePos {
  x: number;
  y: number;
  sit: boolean;
}

export interface RendererOptions {
  reduced: () => boolean;
}

export interface Renderer {
  update(next: Scene, opts: { animate: boolean }): void;
  /**
   * One frame: `now` is performance time, `t` the ISO time shown, `s` the scale the overlay
   * uses, `k` the whole number of device px per room pixel the canvas is drawn at.
   */
  draw(now: number, t: string, s: number, k?: number): void;
  claudePos(): ClaudePos | null;
  /** Walk faster: true for a drag (3x), a number for a playing replay, false for normal. */
  rush(on: boolean | number): void;
  /** Light the cables of these helpers (pointed at, or selected); empty lights them all. */
  focusOn(ids: Iterable<string>): void;
  /** Everyone on their way somewhere. */
  walkers(): Actor[];
  /** Light a binder for a file; `agent` colours it by that helper's phase. */
  lightFile(path: string, at?: number, agent?: string): void;
}

interface Thread {
  agent: string;
  color: string;
  pts: { x: number; y: number }[];
  len: number;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  opts: RendererOptions,
): Renderer {
  // The room is painted at its own size, one canvas px a room pixel, then shown on the page's
  // canvas blown up k times with no smoothing: crisp pixels the browser scales to the fit.
  const art = document.createElement("canvas");
  art.width = W;
  art.height = H;
  const g = context2d(art);
  const out = context2d(canvas);
  const bg = drawBackground();
  const lights = createLights();
  const life = createLife(opts.reduced);
  let lastS = 4;
  let rushing = 1; // walk speed multiplier: a drag, or a replay playing fast
  let focus = new Set<string>(); // helpers whose cables are lit (what the viewer points at)
  const r = filler(g);
  const actors = new Map<string, Actor>();
  const lit = new Map<number, { at: number; color: string | null }>();
  let scene: Scene | null = null;
  let last = performance.now();

  const make = (id: string, look: { frames: Frames; pal: Pal }): Actor => ({
    id,
    frames: look.frames,
    pal: look.pal,
    x: 0,
    y: 0,
    path: [],
    goal: { x: 0, y: 0 },
  });
  function walk(a: Actor, to: Spot, arrive: Actor["arrive"]) {
    const from = {
      x: Math.round((a.x - 8) / T),
      y: Math.round((a.y - 15) / T),
    };
    a.path = findPath(from, to);
    a.goal = to;
    a.arrive = arrive;
    a.pose = "walk";
  }
  function place(a: Actor, t: Spot) {
    const p = center(t);
    a.x = p.x;
    a.y = p.y;
    a.path = [];
    a.goal = t;
    a.pose = t.sit ? "sit" : "stand";
    a.face = t.face ?? "down";
  }

  function update(next: Scene, { animate: wantAnimate }: { animate: boolean }) {
    const prev = scene;
    const same = prev !== null && prev.request.id === next.request.id;
    const animate = wantAnimate && same && !opts.reduced();
    if (!same) actors.clear();
    const deskOf = (id: string | undefined) => {
      const d = next.desks.find((k) => k.agent === id);
      return d && deskTile(d);
    };

    const c = actors.get("claude");
    if (next.claude.spot === "away") {
      if (c && animate && !c.leaving) {
        c.leaving = true;
        walk(c, OUTSIDE, "vanish");
      } else if (!animate) actors.delete("claude");
    } else {
      const t = spotTile(next.claude, next, deskOf);
      if (!c) {
        const fresh = make("claude", {
          frames: CLAUDE_FRAMES,
          pal: CLAUDE_PAL,
        });
        actors.set("claude", fresh);
        place(fresh, t);
      } else if (c.goal.x !== t.x || c.goal.y !== t.y || c.leaving) {
        c.leaving = false;
        if (animate) walk(c, t, t);
        else place(c, t);
      } else if (!c.path.length) place(c, t);
    }
    const ct = actors.get("claude")?.goal;

    const wanted = new Map(
      next.desks.filter((d) => d.status === "running").map((d) => [d.agent, d]),
    );
    const wasRunning = new Set(
      prev?.desks.filter((d) => d.status === "running").map((d) => d.agent),
    );
    for (const [id, d] of wanted) {
      const seat: Spot = { ...chairOf(deskTile(d)), sit: true, face: "down" };
      const a = actors.get(id);
      if (!a) {
        const look = helperLook(id, d.look);
        const fresh = make(id, {
          frames: framesFor(look.style, !!d.fromRequest),
          pal: look.pal,
        });
        actors.set(id, fresh);
        if (animate && !wasRunning.has(id)) {
          // in through your door with Claude's brief
          place(fresh, { ...OUTSIDE });
          walk(fresh, seat, seat);
          fresh.folder = true;
        } else place(fresh, seat);
      } else if (a.goal.x !== seat.x || a.goal.y !== seat.y) {
        if (animate) walk(a, seat, seat);
        else place(a, seat);
      }
    }
    for (const [id, a] of actors) {
      if (id === "claude" || wanted.has(id) || a.leaving) continue;
      if (!animate) {
        actors.delete(id);
        continue;
      }
      // hands the report to Claude, then leaves by your door
      a.leaving = true;
      a.carrying = true;
      a.hopAt = performance.now();
      life.sparkle(a.x, a.y - 26); // a little jump for joy on standing up
      walk(a, ct ? beside(ct.x, ct.y) : OUTSIDE, "hand");
    }
    if (animate && prev) {
      // A helper just finished: a spark runs back along its thread to the sticky, and the thread fades.
      for (const th of threadsFor(prev, lastS)) {
        const d = next.desks.find((k) => k.agent === th.agent);
        if (d?.status !== "running")
          fading.push({ ...th, at: performance.now(), sparked: false });
      }
      // A task just finished: confetti from its sticky. A whole phase: a bigger burst from its header.
      const was = new Map(
        prev.columns.flatMap((c) => c.notes.map((n) => [n.id, n.status])),
      );
      const wasCol = new Map(prev.columns.map((c) => [c.id, c.status]));
      for (const col of boardLayout(next, lastS)) {
        for (const n of col.notes) {
          if (n.status === "done" && was.has(n.id) && was.get(n.id) !== "done")
            life.burst(n.x + 6, n.y + 6);
        }
        if (
          col.status === "done" &&
          wasCol.has(col.id) &&
          wasCol.get(col.id) !== "done"
        ) {
          life.burst(col.x + col.w / 2, BOARD.px.y + 8, 70);
        }
      }
      if (next.waiting && !prev.waiting) life.catTo({ x: 30, y: 3 }); // keeps Claude company at your door
    }
    scene = next;
  }

  function step(a: Actor, dt: number) {
    if (!a.path.length) return;
    a.walkT = (a.walkT ?? 0) + dt * rushing;
    let left = SPEED * rushing * dt;
    for (let next = a.path[0]; left > 0 && next; next = a.path[0]) {
      const p = center(next);
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d) {
        if (Math.abs(dx) > Math.abs(dy)) a.face = dx > 0 ? "right" : "left";
        else a.face = dy > 0 ? "down" : "up";
      }
      if (d <= left) {
        a.x = p.x;
        a.y = p.y;
        left -= d;
        a.path.shift();
      } else {
        a.x += (dx / d) * left;
        a.y += (dy / d) * left;
        left = 0;
      }
    }
    if (a.path.length) return;
    if (a.arrive === "hand") {
      a.carrying = false;
      const c = claudePos();
      if (c) {
        const to = { x: c.x, y: c.y - (c.sit ? 14 : 20) };
        life.paper({ x: a.x + 6, y: a.y - 12 }, to, () => {
          const now = claudePos();
          if (now) life.heart(now.x, now.y - (now.sit ? 26 : 32));
        });
      }
      walk(a, OUTSIDE, "vanish");
    } else if (a.arrive === "vanish") actors.delete(a.id);
    else if (a.arrive) {
      a.pose = a.arrive.sit ? "sit" : "stand";
      if (a.arrive.face) a.face = a.arrive.face;
      if (a.arrive.sit) a.folder = false;
    }
  }

  function drawStanding(a: Actor) {
    const x = Math.round(a.x);
    let y = Math.round(a.y);
    const dir =
      a.face === "left" || a.face === "right" ? "side" : (a.face ?? "down");
    const stride = Math.floor((a.walkT ?? 0) * 8) % 4;
    const tapping =
      a.id === "claude" &&
      !!scene?.waiting &&
      !a.path.length &&
      !opts.reduced(); // a foot taps while it waits
    let f: "a" | "b" | "stand" = "stand";
    if (a.path.length)
      f = (["a", "stand", "b", "stand"] as const)[stride] ?? "stand";
    else if (tapping && Math.floor(performance.now() / 420) % 2) f = "a";
    if (a.path.length && stride !== a.lastStep && f !== "stand")
      life.puff(x, y);
    a.lastStep = stride;
    const hop =
      a.hopAt && !opts.reduced()
        ? Math.max(
            0,
            Math.sin(
              Math.min(1, (performance.now() - a.hopAt) / 380) * Math.PI,
            ),
          ) * 5
        : 0;
    const lift = Math.round(hop) + (a.path.length && f === "stand" ? 1 : 0); // up on the passing step, down on the stride
    let rows = a.frames[dir][f];
    if (dir !== "up" && !opts.reduced() && blinking(a.id, performance.now()))
      rows = closeEyes(rows);
    // shadow stays on the floor
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.fillRect(x - 4, y, 9, 1);
    g.fillRect(x - 3, y + 1, 7, 1);
    g.drawImage(
      sprite(rows, a.pal, a.face === "left"),
      x - 7,
      y - rows.length + 1 - lift,
    );
    y -= lift;
    if (a.carrying) {
      r(x + 4, y - 12, 6, 7, "#eee8da");
      r(x + 5, y - 10, 4, 1, "#9a948a");
      r(x + 5, y - 8, 3, 1, "#9a948a");
    }
    if (a.folder) {
      // Claude's brief
      r(x + 3, y - 12, 7, 6, "#d9b46a");
      r(x + 3, y - 13, 3, 1, "#c49a4f");
      r(x + 4, y - 10, 5, 1, "#b8904a");
    }
  }

  // Each state's mark on its sticky, at its offset; running and not started carry none.
  const NOTE_MARK: Partial<
    Record<State, { mark: Mark; off: readonly [number, number] }>
  > = {
    done: { mark: MARKS.tick, off: [2, 3] },
    waiting: { mark: MARKS.bang, off: [4, 3] },
    failed: { mark: MARKS.cross, off: [3, 3] },
    open: { mark: MARKS.dash, off: [3, 5] },
    paused: { mark: MARKS.bars, off: [3, 3] },
  };

  function drawBoard(sc: Scene, s: number) {
    const cols = boardLayout(sc, s);
    const one = cols.length === 1;
    cols.forEach((col, ci) => {
      const pc = phaseColor(ci);
      // Each phase has its colour: a divider tab over the board and a wash down its column. A one-phase
      // board has nothing to tell apart, so its stickies carry their own task colours instead.
      if (!one && pc) {
        r(col.x + 3, BOARD.px.y - 5, col.w - 6, 4, pc);
        r(col.x + 3, BOARD.px.y - 5, col.w - 6, 1, "rgba(255,255,255,0.35)");
        g.globalAlpha = 0.16;
        r(col.x + 1, BOARD.px.y + 16, col.w - 2, BOARD.px.h - 18, pc);
        g.globalAlpha = 1;
        if (ci === sc.focus)
          claudeFace(col.x + Math.floor(col.w / 2) - 3, BOARD.px.y - 9); // the phase Claude last spoke about
      }
      if (col.x > BOARD_INNER.x)
        r(col.x - 1, BOARD.px.y + 3, 1, BOARD.px.h - 6, "#a3abb4");
      for (const n of col.notes) {
        const ns = STATUS[TONE[n.status]];
        const board = "#c4cad1";
        if (one) {
          const tc = phaseColor(
            sc.columns[ci]?.notes.findIndex((k) => k.id === n.id),
          );
          if (tc) r(n.x - 3, n.y, 2, 12, tc); // its task colour
        }
        g.globalAlpha = n.status === "done" ? 0.75 : 1;
        r(n.x + 1, n.y + 1, 12, 12, "rgba(0,0,0,0.22)");
        r(n.x, n.y, 12, 12, ns.base);
        r(n.x, n.y, 12, 1, ns.hi);
        // folded corner
        r(n.x + 10, n.y + 11, 2, 1, board);
        r(n.x + 11, n.y + 10, 1, 1, board);
        r(n.x + 10, n.y + 10, 1, 1, ns.dark);
        const nm = NOTE_MARK[n.status];
        if (nm)
          for (const [mx, my] of nm.mark)
            r(n.x + nm.off[0] + mx, n.y + nm.off[1] + my, 1, 1, ns.dark);
        // Head chips of the helpers on a running note.
        n.heads.slice(0, 2).forEach((id, k) => {
          const a = actors.get(id);
          if (!a) return;
          const hx = n.x + 1 + k * 6;
          const hy = n.y + 4;
          r(hx - 1, hy - 1, 6, 7, "#e8eef5");
          r(
            hx,
            hy,
            5,
            2,
            a.pal.X && a.frames.down.stand[1]?.includes("X")
              ? a.pal.X
              : a.pal.H,
          );
          r(hx, hy + 2, 5, 3, a.pal.S);
          r(hx + 1, hy + 3, 1, 1, "#20160f");
          r(hx + 3, hy + 3, 1, 1, "#20160f");
        });
        g.globalAlpha = 1;
      }
    });
  }
  /** Claude's face, 7 px: a marker for where its attention is. */
  function claudeFace(x: number, y: number) {
    const P = CLAUDE_PAL;
    r(x, y + 1, 7, 6, "#1c1712");
    r(x + 1, y, 5, 1, "#1c1712");
    r(x + 1, y + 1, 5, 2, P.H);
    r(x + 1, y + 3, 5, 3, P.S);
    r(x + 2, y + 4, 1, 1, P.E);
    r(x + 4, y + 4, 1, 1, P.E);
    r(x + 1, y + 5, 1, 1, P.R);
    r(x + 5, y + 5, 1, 1, P.R);
  }

  // Threads: a cable in the phase colour from each working sticky, down the board and along the floor
  // to every desk on it; a builder and its reviewer share one until they part. A helper still working
  // for an earlier request is tied to that request's card instead.
  const routes = new Map<string, Tile[]>();
  const fading: (Thread & { at: number; sparked: boolean })[] = [];
  let threadMemo: { sc: Scene; s: number; out: Thread[] } | null = null;
  const route = (a: Tile, b: Tile) => {
    const k = `${a.x},${a.y}>${b.x},${b.y}`;
    let tiles = routes.get(k);
    if (!tiles) {
      tiles = cableRoute(a, b);
      routes.set(k, tiles);
    }
    return tiles;
  };
  function threadsFor(sc: Scene, s: number): Thread[] {
    if (threadMemo?.sc === sc && threadMemo.s === s) return threadMemo.out;
    const cols = boardLayout(sc, s);
    const cards = jobCards(sc.jobs, sc.request.id);
    const out: Thread[] = [];
    const working = sc.desks.filter(
      (d) => d.status === "running" && (d.task || d.fromRequest),
    );
    const groupOf = (d: (typeof working)[number]) =>
      d.task ?? `req:${d.fromRequest}`;
    const groups = [...new Set(working.map(groupOf))];
    for (const d of working) {
      const lane = Math.round(
        (groups.indexOf(groupOf(d)) - (groups.length - 1) / 2) * 3,
      );
      let anchor: { x: number; y: number };
      let start: Tile;
      let color: string;
      if (d.task) {
        const col = d.phase === undefined ? undefined : cols[d.phase];
        if (!col) continue;
        const n = col.notes.find((k) => k.id === d.task);
        anchor = n
          ? { x: n.x + 6, y: n.y + 12 }
          : { x: col.x + col.w / 2, y: BOARD.px.y + BOARD.px.h - 2 };
        start = {
          x: Math.min(18, Math.max(2, Math.floor(anchor.x / T))),
          y: 6,
        };
        color = phaseColor(d.group) ?? LINEAGE;
      } else {
        const c =
          d.fromRequest === undefined
            ? undefined
            : cardOf(cards, d.fromRequest);
        if (!c) continue;
        anchor = { x: c.x + c.w / 2, y: c.y + c.h };
        start = { x: 23, y: 3 };
        color = LINEAGE;
      }
      const tl = deskTile(d);
      const tiles = route(start, plugOf(tl));
      const raw = [
        anchor,
        { x: anchor.x, y: start.y * T + 8 + lane },
        ...tiles.map((k) => ({ x: k.x * T + 8 + lane, y: k.y * T + 8 + lane })),
        { x: tl.x * T + 46, y: tl.y * T + 8 + lane },
      ];
      const pts = corners(raw);
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[i - 1];
        if (p && q) len += Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      }
      out.push({ agent: d.agent, color, pts, len });
    }
    threadMemo = { sc, s, out };
    return out;
  }
  /** Only the corners of a path: repeated points and points mid-way along a straight run are dropped. */
  function corners(raw: { x: number; y: number }[]) {
    const out: { x: number; y: number }[] = [];
    for (const p of raw) {
      const q = out.at(-1);
      const o = out.at(-2);
      if (q && q.x === p.x && q.y === p.y) continue;
      if (
        o &&
        q &&
        ((o.x === q.x && q.x === p.x) || (o.y === q.y && q.y === p.y))
      )
        out.pop();
      out.push(p);
    }
    return out;
  }
  /** The point `d` px along a thread's corners. */
  function along(th: Thread, dist: number) {
    let d = dist;
    for (let i = 1; i < th.pts.length; i++) {
      const a = th.pts[i - 1];
      const b = th.pts[i];
      if (!a || !b) continue;
      const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (d <= seg)
        return {
          x: a.x + Math.sign(b.x - a.x) * d,
          y: a.y + Math.sign(b.y - a.y) * d,
        };
      d -= seg;
    }
    return th.pts.at(-1) ?? { x: 0, y: 0 };
  }
  // A cable with each corner rounded by a pixel, and a shadow under it on the floor.
  function cable(th: Thread, alpha: number) {
    g.globalAlpha = alpha;
    const P = th.pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const n = P.length;
    const dir = (a: Tile, b: Tile) => ({
      x: Math.sign(b.x - a.x),
      y: Math.sign(b.y - a.y),
    });
    for (const [col, dy] of [
      ["rgba(0,0,0,0.45)", 1],
      [th.color, 0],
    ] as const) {
      for (let i = 1; i < n; i++) {
        const pa = P[i - 1];
        const pb = P[i];
        if (!pa || !pb) continue;
        const a = { ...pa };
        const b = { ...pb };
        const d = dir(a, b);
        // leave the corner pixel out...
        if (i > 1) {
          a.x += d.x;
          a.y += d.y;
        }
        if (i < n - 1) {
          b.x -= d.x;
          b.y -= d.y;
        }
        if ((b.x - a.x) * d.x < 0 || (b.y - a.y) * d.y < 0) continue;
        r(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y) + dy,
          Math.abs(b.x - a.x) + 1,
          Math.abs(b.y - a.y) + 1,
          col,
        );
        const pc = P[i + 1];
        if (pc) {
          // ...and cut it diagonally
          const e = dir(pb, pc);
          if (e.x !== d.x || e.y !== d.y)
            r(pb.x - d.x + e.x, pb.y - d.y + e.y + dy, 1, 1, col);
        }
      }
    }
    const first = th.pts[0];
    if (first)
      r(Math.round(first.x) - 1, Math.round(first.y) - 1, 3, 3, th.color); // pinned to the sticky
    g.globalAlpha = 1;
  }
  function drawThreads(sc: Scene, now: number) {
    const still = opts.reduced();
    // Pointing at a desk, sticky or phase lights its cables and dims the rest.
    const isLit = (th: Thread) => !focus.size || focus.has(th.agent);
    const list = threadsFor(sc, lastS)
      .slice()
      .sort((a, b) => Number(isLit(a)) - Number(isLit(b))); // lit ones on top
    for (const th of list) {
      const a = actors.get(th.agent);
      if (a?.pose !== "sit" || a.path.length) continue; // the cable goes live when its helper sits down
      let alpha = 0.72;
      if (focus.size) alpha = isLit(th) ? 1 : 0.16;
      cable(th, alpha);
      if (focus.size && !isLit(th)) continue;
      if (still) continue;
      // Work flows up: a soft pulse runs from the desk to the sticky.
      const p = along(
        th,
        th.len - (((now / 1000) * 34 + (hash(th.agent) % 97)) % th.len),
      );
      // a bead of light in the cable's colour
      r(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3, th.color);
      r(Math.round(p.x), Math.round(p.y), 1, 1, "#ffffff");
    }
    for (let i = fading.length - 1; i >= 0; i--) {
      const th = fading[i];
      if (!th) continue;
      const age = (now - th.at) / 1000;
      if (age > 1.8 || still) {
        fading.splice(i, 1);
        continue;
      }
      cable(th, 0.8 * (1 - age / 1.8));
      const first = th.pts[0];
      if (age < 0.9) {
        const p = along(th, th.len * (1 - age / 0.9));
        r(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5, th.color);
        r(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3, "#ffffff");
      } else if (!th.sparked && first) {
        th.sparked = true;
        life.sparkle(first.x, first.y);
      }
    }
  }

  function clock(x: number, y: number, d: Date) {
    r(x + 3, y, 10, 16, "#5c4a3f");
    r(x, y + 3, 16, 10, "#5c4a3f");
    r(x + 1, y + 1, 14, 14, "#5c4a3f");
    r(x + 3, y + 1, 10, 14, "#d9d4c6");
    r(x + 1, y + 3, 14, 10, "#d9d4c6");
    r(x + 2, y + 2, 12, 12, "#d9d4c6");
    // 12, 3, 6, 9
    for (const [tx, ty, tw, th] of [
      [7, 2, 2, 1],
      [13, 7, 1, 2],
      [7, 13, 2, 1],
      [2, 7, 1, 2],
    ] as const) {
      r(x + tx, y + ty, tw, th, "#9a8f80");
    }
    const line = (ang: number, len: number, col: string) => {
      for (let i = 0; i <= len * 2; i++) {
        r(
          Math.round(x + 7.5 + (Math.sin(ang) * i) / 2 - 0.5),
          Math.round(y + 7.5 - (Math.cos(ang) * i) / 2 - 0.5),
          1,
          1,
          col,
        );
      }
    };
    const m = d.getMinutes() + d.getSeconds() / 60;
    const h = (d.getHours() % 12) + m / 60;
    line((h / 12) * 2 * Math.PI, 3.5, "#2a211c");
    line((m / 60) * 2 * Math.PI, 5.5, "#5a463a");
    r(x + 7, y + 7, 2, 2, "#2a211c");
  }

  function draw(now: number, t: string, s: number, k = 1) {
    paint(now, t, s);
    // Resized here, in the frame that draws it, so a new size never shows a blank canvas.
    if (canvas.width !== W * k || canvas.height !== H * k) {
      canvas.width = W * k;
      canvas.height = H * k;
    }
    out.imageSmoothingEnabled = false;
    out.drawImage(art, 0, 0, W * k, H * k);
  }

  function paint(now: number, t: string, s: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lastS = s;
    g.drawImage(bg, 0, 0);
    const sc = scene;
    if (!sc) return;
    const still = opts.reduced();
    PLANTS.forEach((p, i) => {
      const sway = still
        ? 0
        : Math.floor((now + i * 610) / 1500) % 3 === 0
          ? 1
          : 0;
      drawPlant(g, p.x * T, p.y * T, sway);
    });
    // Rack lights chatter, faster while a command runs anywhere.
    const busy =
      sc.claude.spot === "terminal" ||
      sc.desks.some((d) => d.status === "running" && d.act === "run");
    const tick = still ? 0 : Math.floor(now / (busy ? 90 : 420));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 7; j++) {
        const on =
          still ||
          (((tick * 7 + i * 13 + j * 31) * 2654435761) >>> 28) % 5 !== 0;
        r(
          RACKS.px.x + i * 15 + 3,
          RACKS.px.y + 5 + j * 6,
          1,
          1,
          on ? (j % 3 ? "#4d6b8a" : "#9fb3c8") : "#262a31",
        );
        if (j === 3)
          r(
            RACKS.px.x + i * 15 + 10,
            RACKS.px.y + 5 + j * 6,
            1,
            1,
            busy && on ? "#74d394" : "#2f3a33",
          );
      }
    }
    drawThreads(sc, now); // under the stickies, so a cable never crosses the notes below its own
    drawBoard(sc, s);

    // Request board: earlier requests as small cards, this floor's request as a big pinned sheet
    // (the words you asked are laid over it in the DOM). The top band is the request's state.
    for (const c of jobCards(sc.jobs, sc.request.id)) {
      const key = c.state === undefined ? undefined : REQ_STATE[c.state];
      const band = (key && STATUS[key].base) ?? STATUS.todo.base;
      r(c.x + 1, c.y + 1, c.w, c.h, "rgba(0,0,0,0.3)");
      r(c.x, c.y, c.w, c.h, c.big ? "#f1ebdd" : "#e8e2d4");
      r(c.x, c.y, c.w, c.big ? 4 : 3, band);
      if (c.big) {
        // a red pin
        r(c.x + c.w / 2 - 1, c.y - 2, 3, 3, "#d9544a");
        r(c.x + c.w / 2, c.y - 2, 1, 1, "#ff9b90");
      } else if (c.more) {
        // a stack of older cards
        r(c.x + 2, c.y + 2, c.w, c.h, "#d8d1c2");
        r(c.x + 1, c.y + 1, c.w, c.h, "#e0d9ca");
      }
      if (c.big && lastS < 3) {
        // too small to write on at 2x: a few lines
        for (let i = 0; i < 4; i++)
          r(c.x + 3, c.y + 8 + i * 4, [16, 13, 15, 9][i] ?? 0, 1, "#b9b2a3");
      }
    }

    // Binders light in the colour of whoever touched the file (warm white for Claude's own reads).
    for (const [k, { at, color }] of lit) {
      const age = (now - at) / 2600;
      if (age >= 1) {
        lit.delete(k);
        continue;
      }
      const sh = Math.floor(k / 15);
      const b = k % 15;
      const x = SHELVES.px.x + 5 + b * 4 + (b > 7 ? 3 : 0);
      const y = SHELVES.px.y + 4 + sh * 14;
      g.globalAlpha = 0.65 * (1 - age);
      r(x - 1, y - 1, 5, 12, color ?? "#ffeec8");
      g.globalAlpha = 0.8 * (1 - age);
      r(x, y, 3, 10, "#fff8e6");
      g.globalAlpha = 1;
    }

    const d = DOOR.px;
    if (sc.waiting) {
      r(d.x, d.y, d.w, d.h, "#0e0c0b");
      r(d.x, d.y + d.h - 6, d.w, 6, "rgba(255,191,74,0.35)");
      // leaf swung open
      r(d.x + d.w - 5, d.y, 5, d.h, "#7a573f");
      r(d.x + d.w - 5, d.y, 1, d.h, "#8f6a4e");
    } else {
      r(d.x, d.y, d.w, d.h, "#6a4a35");
      for (const px of [d.x + 2, d.x + d.w / 2 + 1]) {
        r(px, d.y + 3, d.w / 2 - 3, 10, "#5a3e2c");
        r(px, d.y + 16, d.w / 2 - 3, 11, "#5a3e2c");
      }
      r(d.x + d.w / 2 - 3, d.y + 15, 2, 2, "#c9b48a");
      r(d.x + d.w / 2 + 1, d.y + 15, 2, 2, "#c9b48a");
    }
    clock(CLOCK.x * T, CLOCK.y * T, new Date(t));

    for (const a of actors.values()) step(a, dt);
    life.update(dt, now);
    const seated = new Map(
      [...actors].filter(([, a]) => a.pose === "sit" && !a.path.length),
    );
    drawDesks(g, sc, seated, now, opts.reduced());
    const standing = [...actors.values()]
      .filter((a) => !seated.has(a.id))
      .map((a) => ({ y: a.y, draw: () => drawStanding(a) }));
    for (const it of [...standing, life.catDrawable(g, now)].sort(
      (a, b) => a.y - b.y,
    ))
      it.draw();

    const pools: Pool[] = [];
    for (const dk of sc.desks) {
      if (dk.status === "running" && seated.has(dk.agent)) {
        const tl = deskTile(dk);
        pools.push({
          x: tl.x * T + 26,
          y: tl.y * T,
          r: 34,
          tint: dk.act && GLOW[dk.act],
        });
      }
    }
    const c = claudePos();
    if (c) pools.push({ x: c.x, y: c.y - 10, r: 32 });
    if (sc.claude.spot === "board") {
      const col = boardColumns(sc.columns.length || 1)[sc.claude.column ?? 0];
      if (col) pools.push({ x: col.x + col.w / 2, y: BOARD.px.y + 50, r: 50 });
    }
    lights.draw(g, pools, !!sc.waiting, c);
    life.draw(g, pools);
  }

  function claudePos(): ClaudePos | null {
    const a = actors.get("claude");
    if (!a) return null;
    if (a.pose === "sit" && !a.path.length) {
      const s = seatOf(CLAUDE_DESK, true);
      return { x: s.x, y: s.y, sit: true };
    }
    return { x: a.x, y: a.y, sit: false };
  }

  return {
    update,
    draw,
    claudePos,
    rush: (on) => {
      rushing = typeof on === "number" ? on : on ? 3 : 1;
    },
    focusOn: (ids) => {
      focus = new Set(ids);
    },
    walkers: () => [...actors.values()].filter((a) => a.path.length),
    lightFile: (path, at = performance.now(), agent) => {
      const d = agent ? scene?.desks.find((k) => k.agent === agent) : undefined;
      let color: string | null = null;
      if (d) color = d.task ? phaseColor(d.group) : LINEAGE;
      lit.set(hash(path) % SHELF_SLOTS, { at, color });
    },
  };
}
