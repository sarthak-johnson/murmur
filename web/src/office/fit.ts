// How big the room is drawn: the largest crisp scale that fits the box it has.

import { H, W } from "./map";

/** Room kept clear around the room, in CSS px. */
export const FIT_PAD = 16;

/**
 * The smallest scale words in the room stay legible at. A 1x screen has only whole
 * numbers to choose from, and 1x is still sharp; a 2x screen can draw 1.5 (3 device px a
 * room pixel), so it keeps that much size.
 */
export function legibleFloor(dpr: number): number {
  const d = dpr > 0 ? dpr : 1;
  return d < 1.5 ? Math.ceil(d - 1e-6) / d : Math.ceil(1.5 * d - 1e-6) / d;
}

/**
 * The room's scale for a box of w x h CSS px on a screen of `dpr` device px per CSS px.
 * Crisp means a whole number of device px per room pixel, so the scale is a multiple of
 * 1/dpr: whole numbers on a 1x screen, halves on a 2x one. The largest that fits both ways
 * wins; when even the legible floor does not fit, the room is drawn at the floor and pans.
 */
export function fitScale(
  w: number,
  h: number,
  dpr: number,
): { scale: number; pans: boolean } {
  const d = dpr > 0 ? dpr : 1;
  const fit = Math.min((w - FIT_PAD) / W, (h - FIT_PAD) / H);
  // A hair over, for floating error: 1.5 * 2 must count as 3 device px, not 2.999.
  const scale = Math.floor(fit * d + 1e-6) / d;
  const floor = legibleFloor(d);
  return scale >= floor ? { scale, pans: false } : { scale: floor, pans: true };
}

/** The requests rail, open and folded. */
export const RAIL_W = 248;
export const RAIL_SHUT = 40;
/** The panel's docked width: a third of a wide screen, within reading limits. */
export const dockWidth = (vw: number) =>
  Math.round(Math.min(640, Math.max(480, vw * 0.3)));
/** Its wide width, for the boards: most of the stage, the room keeping a strip. */
export const wideWidth = (stage: number) =>
  Math.round(Math.min(stage - 160, Math.max(960, stage * 0.55)));

export interface RoomFit {
  scale: number;
  /** Even the legible floor does not fit: the room pans, the camera on what matters. */
  pans: boolean;
  /** The panel's width (0 when closed). */
  pw: number;
  /** The panel lies over the room instead of beside it. */
  over: boolean;
  /** The rail is folded for the panel, the viewer's own choice kept for later. */
  railFolded: boolean;
}

/**
 * The scale worth folding the rail for. On a 2x screen it is the legible floor; a 1x screen
 * has nothing between 1x and 2x, and 1x leaves a small room in a big box, so it is 2x there.
 */
export const comfortScale = (dpr: number) =>
  Math.max(legibleFloor(dpr), dpr < 1.5 ? 2 : 0);

/**
 * Where everything goes in the body under the bars (w x h CSS px): the rail, the panel and
 * the room between them. A docked panel that would shrink the room below a comfortable size
 * folds an open rail first; when no layout beside the panel fits even the legible floor, the
 * room keeps the size it has with the panel closed and the panel lies over it. `rail`
 * "insist" is an open rail the viewer asked for while it was folded: it is not folded again.
 */
export function roomFit(o: {
  w: number;
  h: number;
  vw: number;
  dpr: number;
  rail: "none" | "shut" | "open" | "insist";
  panel: boolean;
  wide: boolean;
}): RoomFit {
  const railW = (open: boolean) =>
    o.rail === "none" ? 0 : open ? RAIL_W : RAIL_SHUT;
  const pwFor = (stage: number) =>
    !o.panel
      ? 0
      : o.wide
        ? Math.max(dockWidth(o.vw), wideWidth(stage))
        : dockWidth(o.vw);
  const beside = (railOpen: boolean, railFolded: boolean) => {
    const stage = o.w - railW(railOpen);
    const pw = pwFor(stage);
    return { ...fitScale(stage - pw, o.h, o.dpr), pw, over: false, railFolded };
  };
  const a = beside(o.rail === "open" || o.rail === "insist", false);
  if (!o.panel) return a;
  const b = o.rail === "open" ? beside(false, true) : null;
  const comfort = comfortScale(o.dpr);
  const fits = (f: RoomFit | null, min: number): f is RoomFit =>
    !!f && !f.pans && f.scale >= min;
  if (fits(a, comfort)) return a;
  if (fits(b, comfort)) return b;
  if (fits(a, 0)) return a;
  if (fits(b, 0)) return b;
  const stage = o.w - railW(o.rail === "open" || o.rail === "insist");
  return {
    ...fitScale(stage, o.h, o.dpr),
    pw: a.pw,
    over: true,
    railFolded: false,
  };
}
