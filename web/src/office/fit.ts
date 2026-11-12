// How big the room is drawn, and where the rail, the room and the panel go around it.
//
// The room always fills its box: the largest scale that fits both ways, centred. It stays
// sharp by "sharp bilinear": the canvas is drawn at a whole number of device px per room
// pixel (crisp), sized in CSS to the exact fit, and the browser scales that down smoothly.
// A crisp step close under the fit is taken instead, for perfect pixels.

import { H, W } from "./map";

/** Room kept clear around the room, in CSS px (half each side). */
export const FIT_PAD = 16;
/** Under this many CSS px per room pixel the room is too small to read: it pans instead. */
export const PAN_FLOOR = 0.5;
/** A crisp scale at most this much under the fit is taken instead of the fit. */
export const SNAP = 0.08;
/** The most device px per room pixel the canvas is drawn at: 3744 x 1920, about 29 MB. */
export const MAX_BACKING = 6;
const EPS = 1e-6;

export interface Fit {
  /** CSS px per room pixel. */
  scale: number;
  /** Even the floor does not fit: the room is drawn at the floor and pans. */
  pans: boolean;
}

/**
 * The room's scale for a box of w x h CSS px on a screen of `dpr` device px per CSS px: the
 * fit itself (in 1/64 device px per room pixel, so float noise never moves it), or a crisp
 * step close under it.
 */
export function fitScale(w: number, h: number, dpr: number): Fit {
  const d = dpr > 0 ? dpr : 1;
  const fit = Math.min((w - FIT_PAD) / W, (h - FIT_PAD) / H);
  if (!(fit >= PAN_FLOOR)) return { scale: PAN_FLOOR, pans: true };
  const crisp = Math.floor(fit * d + EPS) / d;
  if (crisp > 0 && crisp >= fit * (1 - SNAP))
    return { scale: crisp, pans: false };
  return { scale: Math.floor(fit * d * 64 + EPS) / (64 * d), pans: false };
}

/** Device px per room pixel the canvas is drawn at: the whole number at or over the scale. */
export const backing = (scale: number, dpr: number) =>
  Math.min(MAX_BACKING, Math.max(1, Math.ceil(scale * (dpr || 1) - EPS)));

/** Shown at a whole number of device px per room pixel: drawn 1:1, nothing to smooth. */
export const isCrisp = (scale: number, dpr: number) => {
  const px = scale * (dpr || 1);
  return Math.abs(px - Math.round(px)) < EPS;
};

/** The requests rail, open and folded to its strip. */
export const RAIL_W = 248;
export const RAIL_SHUT = 40;
/** The panel's docked width: 30% of the window, within reading limits. */
export const dockWidth = (vw: number) =>
  Math.round(Math.min(560, Math.max(360, vw * 0.3)));
/** Wide, the room keeps this share of the stage, smaller but whole. */
const WIDE_ROOM = 0.3;
/** A stage narrower than this has no width to give a wide panel. */
const WIDE_MIN = 1100;
/** Under the room, the panel is at least this tall. */
export const PANEL_MIN_H = 320;
/** The requests list under a room that has no rail beside it is worth showing at this height. */
const LIST_MIN_H = 160;

export interface Layout {
  /** The rail as shown: open, its strip, or none (a narrow window). */
  rail: "none" | "open" | "shut";
  /** The rail is a strip for the panel; the viewer's own choice comes back when it closes. */
  railFolded: boolean;
  /** The panel's width beside the room (0 when it is closed or under the room). */
  pw: number;
  /** What sits under the room, when the stage is taller than the room needs. */
  below: "panel" | "list" | null;
  /** The room's box height when something sits under it (else it takes the stage). */
  rh: number;
  scale: number;
  pans: boolean;
}

/**
 * Where everything goes in the body under the bars (w x h CSS px). An open panel folds the
 * rail to its strip (unless the viewer opened it again: "insist"), then takes its docked
 * width beside the room, or most of the stage when wide; on a tall stage a docked panel goes
 * under the room instead when the room is bigger that way. Without a rail beside it, a tall stage
 * shows the requests under the room rather than empty bands.
 */
export function layout(o: {
  w: number;
  h: number;
  vw: number;
  dpr: number;
  rail: "none" | "shut" | "open" | "insist";
  panel: boolean;
  wide: boolean;
}): Layout {
  const rail: Layout["rail"] =
    o.rail === "none"
      ? "none"
      : o.rail === "insist" || (o.rail === "open" && !o.panel)
        ? "open"
        : "shut";
  const railFolded = o.panel && o.rail === "open";
  const stage =
    o.w - (rail === "none" ? 0 : rail === "open" ? RAIL_W : RAIL_SHUT);
  const roomMin = PAN_FLOOR * W + FIT_PAD;
  const base = { rail, railFolded, pw: 0, below: null, rh: 0 } as const;
  // A room fitted to the stage's width, and the height it then takes.
  const under = (h: number) => {
    const f = fitScale(stage, h, o.dpr);
    return { ...f, rh: Math.ceil(H * f.scale + FIT_PAD) };
  };
  if (!o.panel) {
    const f = fitScale(stage, o.h, o.dpr);
    if (rail === "none" && !f.pans) {
      const u = under(o.h);
      if (o.h - u.rh >= LIST_MIN_H) return { ...base, ...u, below: "list" };
    }
    return { ...base, ...f };
  }
  const dock = dockWidth(o.vw);
  const pw = Math.max(
    0,
    Math.min(
      stage - roomMin,
      o.wide ? Math.max(dock, Math.round(stage * (1 - WIDE_ROOM))) : dock,
    ),
  );
  const side = fitScale(stage - pw, o.h, o.dpr);
  const low = under(o.h - PANEL_MIN_H);
  // Wide is for the wide views: they want the width, so on a stage that has it a wide
  // panel goes under the room only when it must.
  const wants = o.wide && stage >= WIDE_MIN;
  if (!low.pans && (side.pans || (!wants && low.scale > side.scale)))
    return { ...base, ...low, below: "panel" };
  return { ...base, ...side, pw };
}
