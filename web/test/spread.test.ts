import { describe, expect, it } from "vitest";
import { spread, timeAxis } from "../src/office/util";

describe("spread", () => {
  it("leaves marks far enough apart where they are", () => {
    expect(spread([0, 50, 100], 100, 6)).toEqual([0, 50, 100]);
  });

  it("spreads a crowd about its middle, keeping its order", () => {
    const out = spread([48, 50, 52], 100, 6);
    expect(out).toEqual([44, 50, 56]);
  });

  it("keeps a crowd at an edge inside the strip", () => {
    const out = spread([0, 1, 2, 3], 100, 6);
    expect(out[0]).toBe(0);
    expect(out).toEqual([0, 6, 12, 18]);
    const end = spread([97, 98, 99, 100], 100, 6);
    expect(end.at(-1)).toBe(100);
  });

  it("merges crowds that spreading pushes into each other", () => {
    const out = spread([10, 11, 12, 18, 19], 200, 6);
    for (let i = 1; i < out.length; i++)
      expect((out[i] ?? 0) - (out[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        6 - 1e-9,
      );
  });

  it("shares a strip too short for the gap evenly", () => {
    const out = spread([5, 5, 5, 5], 8, 6);
    expect(out).toEqual([2, 4, 6, 8]);
  });
});

describe("timeAxis", () => {
  const H = 3_600_000;
  it("counts a long quiet stretch as the gap, and maps back to real time", () => {
    // Work from 0 to 1 h, a night's quiet, then work from 10 h to 11 h.
    const ms = [0, 0.5 * H, H, 10 * H, 10.5 * H, 11 * H];
    const ax = timeAxis(ms, 0, 11 * H, H);
    expect(ax.total).toBe(3 * H);
    expect(ax.at(H)).toBe(H);
    expect(ax.at(10 * H)).toBe(2 * H);
    expect(ax.at(11 * H)).toBe(3 * H);
    // Places in the pause spread evenly over its real time.
    expect(ax.time(1.5 * H)).toBe(5.5 * H);
    for (const t of [0, 0.3 * H, 4 * H, 10.2 * H, 11 * H])
      expect(ax.time(ax.at(t))).toBeCloseTo(t, 3);
    // Monotone.
    let last = -1;
    for (let t = 0; t <= 11 * H; t += H / 7) {
      const x = ax.at(t);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });
  it("is plain time when nothing is quiet for long", () => {
    const ax = timeAxis([10, 20, 30], 0, 40, 100);
    expect(ax.total).toBe(40);
    expect(ax.at(25)).toBe(25);
    expect(ax.time(25)).toBe(25);
  });
});
