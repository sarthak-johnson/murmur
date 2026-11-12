import { describe, expect, it } from "vitest";
import { spread } from "../src/office/util";

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
