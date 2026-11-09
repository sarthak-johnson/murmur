import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(__dirname, "..");
const css = readFileSync(join(web, "src/theme.css"), "utf8");
const html = readFileSync(join(web, "index.html"), "utf8");

/** The declarations of the first rule whose selector list is exactly `sel`. */
function rule(sel: string): string {
  const at = css.search(
    new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`),
  );
  expect(at, `no rule for ${sel}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}
/** [weight, size px, line-height px] from a `font:` shorthand. */
function font(sel: string): [number, number, number] {
  const m = rule(sel).match(
    /font: (\d+) ([\d.]+)px \/ ([\d.]+)(px)? var\(--font-ui\)/,
  );
  expect(m, `${sel} is not set in Geist`).toBeTruthy();
  const [, w, size, lh, px] = m as RegExpMatchArray;
  const s = Number(size);
  return [Number(w), s, px ? Number(lh) : Number(lh) * s];
}

describe("no serif", () => {
  it("loads and names only Geist and Geist Mono", () => {
    expect(html).not.toMatch(/Newsreader/);
    expect(css).not.toMatch(/Newsreader|Georgia|Iowan|--font-read/);
    // Every family the sheet names is one of the two.
    for (const [, f] of css.matchAll(
      /font(?:-family)?:[^;]*var\((--[\w-]+)\)/g,
    ))
      expect(["--font-ui", "--font-code"]).toContain(f);
  });

  it("titles carry their weight at 600", () => {
    for (const sel of [".pd-title", ".ask", ".sect h2", ".hh", ".st-h h2"])
      expect(font(sel)[0], sel).toBe(600);
  });

  it("Claude's words are 400 at a comfortable size and line height", () => {
    for (const sel of [
      ".story .story-text",
      ".step-text",
      ".reading",
      ".rb-edge",
    ]) {
      const [w, size, lh] = font(sel);
      expect(w, sel).toBe(400);
      expect(size, sel).toBeGreaterThanOrEqual(15);
      expect(lh / size, sel).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("the page title stays the largest type on the page", () => {
    const sizes = [...css.matchAll(/font: (?:\d+ )?([\d.]+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(font(".pd-title")[1]).toBe(Math.max(...sizes));
  });
});
