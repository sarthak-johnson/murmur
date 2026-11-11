// Desks, drawn live so empty ones can fade and seated people sit between chair and desk.
// A working desk shows what kind of work it is by shape, never by status colour: code being typed,
// a page being read, a magnifier sweeping results, or a terminal scrolling.
import { filler, WOOD } from "./background";
import { CLAUDE_DESK, REVIEW_DESKS, T, type Tile, WORK_DESKS } from "./map";
import type { Act, Desk, Scene } from "./scene";
import {
  blinking,
  closeEyes,
  type Frames,
  hash,
  LINEAGE,
  MARKS,
  type Pal,
  phaseColor,
  STATUS,
  sprite,
} from "./sprites";

/** The tile a desk stands on. */
export function deskTile(d: Pick<Desk, "kind" | "slot">): Tile {
  const tile = (d.kind === "review" ? REVIEW_DESKS : WORK_DESKS)[d.slot];
  if (!tile) throw new Error(`Murmur office: no ${d.kind} desk ${d.slot}`);
  return tile;
}
/** Where a seated person's feet anchor sits for a desk tile (centre x, y). */
export const seatOf = (tile: Tile, claude = false) => ({
  x: tile.x * T + (claude ? 24 : 28),
  y: tile.y * T + 4,
});

/** Someone sitting at a desk. */
export interface Sitter {
  id: string;
  frames: Frames;
  pal: Pal;
}
type DeskAct = Act | "watch";
type ScreenState = "running" | "done" | "failed" | "off";

// Head bob per kind of work: [period ms, ms spent dipped]. Typing nods often, reading leans in now and then.
const BOB: Record<DeskAct, readonly [number, number]> = {
  edit: [1800, 220],
  run: [2600, 300],
  read: [4200, 900],
  search: [3400, 600],
  watch: [5200, 1200],
};
const READ_WIDTHS = [10, 7, 9, 6, 8, 10];
const RUN_WIDTHS = [6, 11, 4, 9, 7, 10, 5];
const at = (list: readonly number[], i: number) => list[i % list.length] ?? 0;

export function drawDesks(
  g: CanvasRenderingContext2D,
  scene: Scene,
  seated: ReadonlyMap<string, Sitter>,
  now: number,
  reduced: boolean,
) {
  const r = filler(g);
  const clock = (id: string) => (reduced ? 0 : now + (hash(id) % 997) * 7); // each desk on its own beat

  // Chair back shows just around the shoulders; a tucked one only peeks over the desk.
  function chair(cx: number, top: number, tucked: boolean) {
    if (tucked) {
      r(cx - 7, top - 1, 14, 3, "#30343d");
      r(cx - 7, top - 1, 14, 1, "#3d424d");
      return;
    }
    r(cx - 9, top - 7, 18, 9, "#2c3038");
    r(cx - 8, top - 8, 16, 1, "#3a3f4a");
    r(cx - 9, top - 7, 1, 9, "#363a44");
    r(cx + 8, top - 7, 1, 9, "#363a44");
  }

  function screen(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    act: DeskAct,
    t: number,
    count = 0,
  ) {
    if (act === "edit") {
      r(sx, sy, sw, sh, "#2d5f93");
      const typed = 1 + (Math.floor(t / 210) % 9);
      r(sx + 2, sy + 2, 9, 1, "#9ccdff");
      r(sx + 4, sy + 4, 6, 1, "#9ccdff");
      r(sx + 4, sy + 6, typed, 1, "#cfe6ff");
      if (Math.floor(t / 480) % 2) r(sx + 4 + typed, sy + 5, 1, 3, "#ffffff"); // cursor
    } else if (act === "read" || act === "search") {
      r(sx, sy, sw, sh, act === "read" ? "#ddd6c4" : "#d3dadb");
      const off = Math.floor(t / 700) % 2;
      for (let i = 0; i < 5; i++) {
        const y = sy + 1 + i * 2 - off;
        if (y > sy)
          r(sx + 2, y, at(READ_WIDTHS, i + Math.floor(t / 1400)), 1, "#8b8577");
      }
      if (act === "search") {
        const mx = sx + 2 + (Math.floor(t / 380) % (sw - 6));
        const my = sy + 3;
        r(mx, my, 3, 1, "#2f4a5e");
        r(mx, my + 2, 3, 1, "#2f4a5e");
        r(mx - 1, my + 1, 1, 1, "#2f4a5e");
        r(mx + 3, my + 1, 1, 1, "#2f4a5e");
        r(mx + 3, my + 3, 2, 1, "#2f4a5e");
      }
    } else if (act === "run") {
      r(sx, sy, sw, sh, "#12161b");
      const off = Math.floor(t / 260);
      for (let i = 0; i < 3; i++)
        r(sx + 1, sy + 1 + i * 2, at(RUN_WIDTHS, i + off), 1, "#8f9aa6");
      r(sx + 1, sy + 7, 1, 1, "#d6dee6");
      if (Math.floor(t / 420) % 2) r(sx + 3, sy + 6, 2, 2, "#d6dee6"); // block cursor
    } else if (act === "watch") {
      r(sx, sy, sw, sh, "#18222e");
      for (let i = 0; i < Math.min(count, 8); i++) {
        const x = sx + 1 + (i % 4) * 3;
        const y = sy + 1 + Math.floor(i / 4) * 4;
        const on = Math.floor(t / 600 + i * 1.7) % 3;
        r(x, y, 2, 2, on ? STATUS.now.base : STATUS.now.dark);
      }
    } else r(sx, sy, sw, sh, "#121418");
  }

  function monitor(
    x: number,
    y: number,
    state: ScreenState,
    act: DeskAct,
    t: number,
    count = 0,
    wide = 16,
  ) {
    r(x, y, wide, 12, "#1e2127");
    r(x + wide / 2 - 1, y + 12, 2, 2, "#2a2d33");
    const sx = x + 1;
    const sy = y + 1;
    const sw = wide - 2;
    const sh = 9;
    if (state === "running") screen(sx, sy, sw, sh, act, t, count);
    else if (state === "done") {
      r(sx, sy, sw, sh, "#1d3527");
      for (const [mx, my] of MARKS.tick)
        r(
          sx + Math.floor(sw / 2) - 4 + mx,
          sy + 1 + my,
          1,
          1,
          STATUS.done.base,
        );
    } else if (state === "failed") {
      r(sx, sy, sw, sh, "#3a1d1a");
      for (const [mx, my] of MARKS.cross)
        r(
          sx + Math.floor(sw / 2) - 2 + mx,
          sy + 2 + my,
          1,
          1,
          STATUS.failed.base,
        );
    } else r(sx, sy, sw, sh, "#121418");
  }

  function desk(tile: Tile, w = 3, mug = true) {
    const x = tile.x * T;
    const y = tile.y * T;
    const ww = w * T;
    r(x + 1, y + 2, ww - 2, 10, WOOD.top);
    r(x + 1, y + 2, ww - 2, 1, WOOD.hi);
    r(x + 1, y + 12, ww - 2, 4, WOOD.face);
    r(x + 2, y + 16, 2, 2, WOOD.leg);
    r(x + ww - 4, y + 16, 2, 2, WOOD.leg);
    if (mug) {
      // mug with coffee
      r(x + ww - 10, y + 5, 4, 4, "#c9c2b4");
      r(x + ww - 6, y + 6, 1, 2, "#c9c2b4");
      r(x + ww - 9, y + 5, 2, 1, "#5a3e2c");
    }
  }

  // A small flag on the monitor in the phase colour: which column of the board this desk works for.
  function pennant(x: number, y: number, color: string, t: number) {
    const flap = !reduced && t && Math.floor(t / 520) % 2 ? 1 : 0;
    r(x, y - 6, 1, 8, "#8a8478");
    r(x + 1, y - 6, 4 - flap, 1, color);
    r(x + 1, y - 5, 3, 1, color);
    r(x + 1, y - 4, 2 - flap, 1, color);
  }
  function folder(x: number, y: number) {
    r(x, y, 7, 5, "#d9b46a");
    r(x, y - 1, 3, 1, "#c49a4f");
    r(x + 1, y + 2, 5, 1, "#b8904a");
  }

  function steam(x: number, y: number, t: number) {
    for (let k = 0; k < 2; k++) {
      const p = (t / 1700 + k * 0.5) % 1;
      const a = 0.5 * (1 - p) * Math.min(1, p * 4);
      r(
        Math.round(x + Math.sin(p * 6 + k * 2)),
        Math.round(y - p * 9),
        1,
        1,
        `rgba(236,232,240,${a.toFixed(3)})`,
      );
    }
  }

  function person(
    a: Sitter,
    cx: number,
    deskY: number,
    act: DeskAct,
    t: number,
  ) {
    const [period, dip] = BOB[act];
    const bob = !reduced && t % period < dip ? 1 : 0;
    const rows =
      !reduced && blinking(a.id, now) ? closeEyes(a.frames.sit) : a.frames.sit;
    g.drawImage(sprite(rows, a.pal), cx - 7, deskY - 12 + bob);
  }

  function hands(
    a: Sitter,
    cx: number,
    deskY: number,
    act: DeskAct,
    t: number,
  ) {
    const skin = a.pal.S;
    r(cx - 4, deskY + 7, 8, 2, "#3a3e46"); // keyboard
    if (act === "read" || act === "search") {
      // Left hand rests; the right one is on the mouse, flicking the wheel or sliding it.
      const m = act === "search" && Math.floor(t / 380) % 4 === 0 ? 1 : 0;
      const flick = act === "read" && Math.floor(t / 700) % 2 ? 1 : 0;
      r(cx - 6, deskY + 5, 3, 2, skin);
      r(cx + 6 + m, deskY + 7, 3, 2, "#3a3e46");
      r(cx + 6 + m, deskY + 5 + flick, 3, 2, skin);
      return;
    }
    const typing = act === "edit" || (t / 1000) % 3 < 1.3; // a command is typed in a burst, then watched
    const f = typing && !reduced ? Math.floor(t / 130) % 2 : 0;
    r(cx - 6, deskY + 4 + f, 3, 2, skin);
    r(cx + 3, deskY + 5 - f, 3, 2, skin);
  }

  const screenOf = (d: Desk | undefined, sitting: boolean): ScreenState => {
    if (!d) return "off";
    if (d.status === "running") return sitting ? "running" : "off";
    return d.status === "done" ? "done" : "failed";
  };

  const byTile = new Map(scene.desks.map((d) => [deskTile(d), d]));
  for (const tile of [...WORK_DESKS, ...REVIEW_DESKS]) {
    const d = byTile.get(tile);
    const a = d ? seated.get(d.agent) : undefined;
    const cx = tile.x * T + 28;
    const deskY = tile.y * T + 2;
    const act = d?.act ?? "edit";
    const t = d ? clock(d.agent) : 0;
    g.globalAlpha = d ? 1 : 0.35;
    chair(cx, tile.y * T, !a); // nobody sitting: chair tucked in
    if (a) person(a, cx, deskY, act, t);
    desk(tile);
    if (a) hands(a, cx, deskY, act, t);
    else r(tile.x * T + 22, deskY + 7, 8, 2, "#3a3e46");
    // The screen wakes when its helper sits down.
    monitor(tile.x * T + 4, tile.y * T - 9, screenOf(d, !!a), act, t);
    const working = !!a && d?.status === "running";
    if (working && !reduced) steam(tile.x * T + 39, tile.y * T + 4, t);
    if (working) folder(tile.x * T + 5, deskY + 5); // the brief it walked in with
    let flag: string | null = null;
    if (d?.task) flag = phaseColor(d.group);
    else if (d?.fromRequest) flag = LINEAGE;
    if (d && flag)
      pennant(
        tile.x * T + 20,
        tile.y * T - 9,
        flag,
        d.status === "running" ? t : 0,
      );
    g.globalAlpha = 1;
  }

  // Claude's desk: one monitor (its own work, or a dot per helper it is watching), a stack of reports.
  const ct = CLAUDE_DESK;
  const cl = scene.claude;
  const a = seated.get("claude");
  const cx = ct.x * T + 24;
  const deskY = ct.y * T + 2;
  const t = clock("claude");
  let act: DeskAct = "read";
  if (cl.spot !== "desk") act = "edit";
  else if (cl.idle) act = "watch";
  else if (/^(Edit|Write|NotebookEdit)$/.test(cl.tool ?? "")) act = "edit";
  chair(cx, ct.y * T, false);
  if (a) person(a, cx, deskY, act, t);
  desk(ct, ct.w, false); // the report stack stands where a mug would
  if (a) {
    if (act === "watch") {
      r(cx - 4, deskY + 7, 8, 2, "#3a3e46");
      r(cx - 6, deskY + 5, 3, 2, a.pal.S);
      r(cx + 3, deskY + 5, 3, 2, a.pal.S);
    } else hands(a, cx, deskY, act, t);
  }
  const lit = cl.spot === "desk" && (!cl.idle || scene.running > 0);
  monitor(
    ct.x * T + 3,
    ct.y * T - 9,
    lit ? "running" : "off",
    act,
    t,
    scene.running,
  );
  const reports = scene.desks.filter((d) => d.status === "done").length;
  for (let i = 0; i < Math.min(reports, 6); i++) {
    r(ct.x * T + 33, deskY + 5 - i, 9, 5, i % 2 ? "#e3dccd" : "#d4ccbb");
  }
}
