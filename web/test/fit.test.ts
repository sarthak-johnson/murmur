import { describe, expect, it } from "vitest";
import { fitScale, legibleFloor, RAIL_W, roomFit } from "../src/office/fit";
import { H, W } from "../src/office/map";

describe("fitScale", () => {
  it("takes the largest whole number that fits on a 1x screen", () => {
    expect(fitScale(W * 3 + 16, H * 3 + 16, 1)).toEqual({
      scale: 3,
      pans: false,
    });
    expect(fitScale(W * 3 + 15, H * 4, 1)).toEqual({ scale: 2, pans: false });
    expect(fitScale(W + 16, H * 9, 1)).toEqual({ scale: 1, pans: false });
  });

  it("takes halves on a 2x screen, so a laptop's stage holds the whole room", () => {
    // 1288 x 700 with the rail open: 1040 x 508 for the room.
    expect(fitScale(1040, 508, 2)).toEqual({ scale: 1.5, pans: false });
    // 2560 x 1440 with nothing beside it.
    expect(fitScale(2312, 1248, 2).scale).toBe(3.5);
    // Exactly 1.5 fits: floating error must not take it down to 1.
    expect(fitScale(W * 1.5 + 16, H * 1.5 + 16, 2).scale).toBe(1.5);
  });

  it("is always a whole number of device px per room pixel", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (let w = 400; w < 3000; w += 97) {
        const { scale } = fitScale(w, w * 0.6, dpr);
        const px = scale * dpr;
        expect(Math.abs(px - Math.round(px))).toBeLessThan(1e-6);
      }
    }
  });

  it("never fits a room bigger than its box unless it pans", () => {
    for (let w = 300; w < 3000; w += 53) {
      for (const dpr of [1, 2]) {
        const r = fitScale(w, 500, dpr);
        if (!r.pans) {
          expect(W * r.scale).toBeLessThanOrEqual(w - 16);
          expect(H * r.scale).toBeLessThanOrEqual(500 - 16);
        }
      }
    }
  });

  it("stops at the legible floor and pans below it", () => {
    expect(legibleFloor(1)).toBe(1);
    expect(legibleFloor(2)).toBe(1.5);
    expect(legibleFloor(3)).toBeCloseTo(5 / 3);
    expect(fitScale(600, 400, 2)).toEqual({ scale: 1.5, pans: true });
    expect(fitScale(500, 300, 1)).toEqual({ scale: 1, pans: true });
  });
});

describe("roomFit", () => {
  const base = { vw: 1288, dpr: 2, wide: false } as const;

  it("keeps the room beside the panel when it fits there", () => {
    const f = roomFit({
      ...base,
      vw: 1920,
      w: 1920,
      h: 880,
      rail: "open",
      panel: true,
    });
    expect(f).toMatchObject({ over: false, railFolded: false, pans: false });
    expect(W * f.scale).toBeLessThanOrEqual(1920 - RAIL_W - f.pw - 16);
  });

  it("folds an open rail before the panel would shrink the room below the floor", () => {
    // 1600 x 1000 on a 2x screen: 1600 - 248 - 480 leaves 872, under 1.5x; 1600 - 40 - 480 is 1080.
    const f = roomFit({
      ...base,
      vw: 1600,
      w: 1600,
      h: 800,
      rail: "open",
      panel: true,
    });
    expect(f).toMatchObject({ railFolded: true, over: false, scale: 1.5 });
  });

  it("lays the panel over the room when even a folded rail is not enough", () => {
    const f = roomFit({ ...base, w: 1288, h: 508, rail: "open", panel: true });
    expect(f).toMatchObject({
      over: true,
      railFolded: false,
      scale: 1.5,
      pans: false,
    });
  });

  it("does not fold a rail the viewer opened again", () => {
    const f = roomFit({
      ...base,
      vw: 1600,
      w: 1600,
      h: 800,
      rail: "insist",
      panel: true,
    });
    expect(f.railFolded).toBe(false);
  });

  it("never folds the rail with the panel closed", () => {
    const f = roomFit({ ...base, w: 1288, h: 508, rail: "open", panel: false });
    expect(f).toMatchObject({
      railFolded: false,
      over: false,
      pw: 0,
      scale: 1.5,
    });
  });
});

describe("roomFit on a 1x screen", () => {
  it("folds the rail for 2x rather than leave a 1x room in a big box", () => {
    const f = roomFit({
      vw: 1920,
      dpr: 1,
      wide: false,
      w: 1920,
      h: 880,
      rail: "open",
      panel: true,
    });
    expect(f).toMatchObject({ railFolded: true, scale: 2, over: false });
  });

  it("takes 1x beside the panel before laying the panel over the room", () => {
    const f = roomFit({
      vw: 1280,
      dpr: 1,
      wide: false,
      w: 1280,
      h: 600,
      rail: "open",
      panel: true,
    });
    expect(f).toMatchObject({
      railFolded: true,
      scale: 1,
      over: false,
      pans: false,
    });
  });
});
