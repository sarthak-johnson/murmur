import { describe, expect, it } from "vitest";
import {
  backing,
  dockWidth,
  FIT_PAD,
  fitScale,
  isCrisp,
  layout,
  MAX_BACKING,
  PAN_FLOOR,
  PANEL_MIN_H,
  RAIL_SHUT,
  RAIL_W,
} from "../src/office/fit";
import { H, W } from "../src/office/map";

const DPRS = [1, 1.25, 1.5, 2, 3];

describe("fitScale", () => {
  it("fills its box: the room is never bigger than it, and never much smaller", () => {
    for (const dpr of DPRS)
      for (let w = 340; w < 3000; w += 37)
        for (const h of [300, 520, 700, 900, 1260]) {
          const { scale, pans } = fitScale(w, h, dpr);
          const fit = Math.min((w - FIT_PAD) / W, (h - FIT_PAD) / H);
          if (pans) {
            expect(fit).toBeLessThan(PAN_FLOOR);
            expect(scale).toBe(PAN_FLOOR);
            continue;
          }
          expect(W * scale).toBeLessThanOrEqual(w - FIT_PAD + 1e-6);
          expect(H * scale).toBeLessThanOrEqual(h - FIT_PAD + 1e-6);
          // A snap gives up at most 8%; an in-between scale is the fit.
          expect(scale).toBeGreaterThanOrEqual(
            Math.min(fit * 0.92, fit - 1 / (64 * dpr)) - 1e-9,
          );
        }
  });

  it("is continuous between crisp steps, and grows with its box", () => {
    // 1920 x 1080 on a 1x screen, the rail folded: 1880 x 900.
    const { scale } = fitScale(1880, 900, 1);
    expect(scale).toBeGreaterThan(2.7);
    expect(scale).toBeLessThan(3);
    for (const dpr of DPRS) {
      let last = 0;
      for (let w = 400; w < 3000; w += 3) {
        const s = fitScale(w, 1e9, dpr).scale;
        expect(s).toBeGreaterThanOrEqual(last);
        // No jump bigger than the box grew, but for a snap's 8%.
        if (last) expect(s - last).toBeLessThan(last * 0.09 + 3 / W);
        last = s;
      }
    }
  });

  it("snaps to a crisp step within 8% of the fit", () => {
    // Fit 2.1 on a 1x screen: 2 is 5% under.
    expect(fitScale(W * 2.1 + FIT_PAD, H * 3, 1).scale).toBe(2);
    // Fit 1.9: 1 is far under, so it stays in between.
    const s = fitScale(W * 1.9 + FIT_PAD, H * 3, 1).scale;
    expect(s).toBeGreaterThan(1.8);
    expect(isCrisp(s, 1)).toBe(false);
    // On a 2x screen a half is a crisp step: fit 1.55 takes 1.5.
    expect(fitScale(W * 1.55 + FIT_PAD, H * 3, 2).scale).toBe(1.5);
    // Exactly 1.5 must not fall to 1 for floating error.
    expect(fitScale(W * 1.5 + FIT_PAD, H * 1.5 + FIT_PAD, 2).scale).toBe(1.5);
  });

  it("pans only under the floor", () => {
    expect(fitScale(300, 400, 2)).toEqual({ scale: PAN_FLOOR, pans: true });
    // A phone's width holds the whole room.
    expect(fitScale(390, 1e9, 3).pans).toBe(false);
    expect(fitScale(Number.NaN, 400, 1).pans).toBe(true);
  });
});

describe("backing", () => {
  it("draws at the whole device px at or over the scale, capped for memory", () => {
    expect(backing(2, 1)).toBe(2);
    expect(backing(2.7, 1)).toBe(3);
    expect(backing(1.5, 2)).toBe(3);
    expect(backing(0.6, 3)).toBe(2);
    expect(backing(0.5, 1)).toBe(1);
    expect(backing(3.4, 2)).toBe(MAX_BACKING);
    expect(isCrisp(1.5, 2)).toBe(true);
    expect(isCrisp(2.75, 1)).toBe(false);
  });
});

describe("layout", () => {
  const at = (
    vw: number,
    vh: number,
    dpr: number,
    o: Partial<Parameters<typeof layout>[0]> = {},
  ) =>
    layout({
      w: vw,
      h: vh - 180,
      vw,
      dpr,
      rail: vw >= 1200 ? "open" : "none",
      panel: false,
      wide: false,
      ...o,
    });
  const stageOf = (l: ReturnType<typeof layout>, vw: number) =>
    vw - (l.rail === "open" ? RAIL_W : l.rail === "shut" ? RAIL_SHUT : 0);
  const VIEWS: [number, number, number][] = [
    [2560, 1440, 1],
    [1920, 1080, 1],
    [1920, 1080, 2],
    [1600, 1000, 2],
    [1440, 900, 2],
    [1288, 700, 2],
    [1280, 800, 1],
    [1366, 768, 1],
    [1280, 720, 1.5],
    [1024, 768, 2],
    [768, 1024, 2],
  ];

  it("keeps the whole room in its box, beside or under the panel, at every size", () => {
    for (const [vw, vh, dpr] of VIEWS)
      for (const panel of [false, true])
        for (const wide of [false, true])
          for (const rail of ["open", "shut"] as const) {
            const h = vh - 180;
            const l = at(vw, vh, dpr, {
              panel,
              wide,
              rail: vw >= 1200 ? rail : "none",
            });
            const name = `${vw}x${vh}@${dpr} panel=${panel} wide=${wide} rail=${rail}`;
            expect(l.pans, name).toBe(false);
            const boxW = stageOf(l, vw) - l.pw;
            const boxH = l.below ? l.rh : h;
            expect(W * l.scale, name).toBeLessThanOrEqual(
              boxW - FIT_PAD + 1e-6,
            );
            expect(H * l.scale, name).toBeLessThanOrEqual(
              boxH - FIT_PAD + 1e-6,
            );
            // It fills the box one way or the other.
            const fill = Math.max(
              (W * l.scale + FIT_PAD) / boxW,
              (H * l.scale + FIT_PAD) / boxH,
            );
            expect(fill, name).toBeGreaterThan(0.9);
            if (l.below === "panel")
              expect(h - l.rh, name).toBeGreaterThanOrEqual(PANEL_MIN_H);
          }
  });

  it("uses a big screen: no 600 px margins at 2560 or 1920 on a 2x screen", () => {
    const a = at(2560, 1440, 1);
    expect(W * a.scale).toBeGreaterThan(2312 - 2 * 60);
    const b = at(1920, 1080, 2, { panel: true });
    expect(W * b.scale).toBeGreaterThan(1920 - RAIL_SHUT - b.pw - 2 * 40);
  });

  it("folds the rail for the panel, and keeps it open when the viewer insists", () => {
    const f = at(1600, 1000, 2, { panel: true });
    expect(f).toMatchObject({ rail: "shut", railFolded: true, below: null });
    expect(f.pw).toBe(dockWidth(1600));
    const g = at(1600, 1000, 2, { panel: true, rail: "insist" });
    expect(g).toMatchObject({ rail: "open", railFolded: false });
    // A rail the viewer shut is not "folded": nothing to restore.
    expect(at(1600, 1000, 2, { panel: true, rail: "shut" }).railFolded).toBe(
      false,
    );
    expect(at(1600, 1000, 2)).toMatchObject({ rail: "open", pw: 0 });
  });

  it("docks at clamp(360px, 30vw, 560px)", () => {
    expect(dockWidth(1000)).toBe(360);
    expect(dockWidth(1600)).toBe(480);
    expect(dockWidth(2560)).toBe(560);
  });

  it("gives a wide panel most of the stage, the room whole on the left", () => {
    for (const [vw, vh, dpr] of VIEWS.filter(([w]) => w >= 1200)) {
      const l = at(vw, vh, dpr, { panel: true, wide: true });
      expect(l.below).toBe(null);
      expect(l.pw).toBeGreaterThan((stageOf(l, vw) * 2) / 3 - 1);
      expect(l.pans).toBe(false);
    }
  });

  it("puts the panel under the room on a tall stage", () => {
    const l = at(768, 1024, 2, { panel: true });
    expect(l).toMatchObject({ below: "panel", pw: 0, rail: "none" });
    // The room takes the stage's width.
    expect(W * l.scale).toBeGreaterThan(768 - FIT_PAD - 40);
    // A landscape tablet keeps it beside.
    expect(at(1024, 768, 2, { panel: true }).below).toBe(null);
  });

  it("shows the requests under a room with no rail, not empty bands", () => {
    expect(at(768, 1024, 2).below).toBe("list");
    expect(at(1024, 768, 2).below).toBe(null);
    expect(at(1920, 1080, 1).below).toBe(null);
  });
});
