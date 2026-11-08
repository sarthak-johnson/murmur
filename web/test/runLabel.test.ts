import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src/theme.css"), "utf8");

// jsdom has no layout, so the rule itself is the check: a label wider than the layout
// estimated is cut with an ellipsis rather than spilling over its neighbour.
it("a run label never spills: one line, cut with an ellipsis", () => {
  const rule = /\n\.run-label \{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const decl of [
    "overflow: hidden",
    "text-overflow: ellipsis",
    "white-space: nowrap",
  ])
    expect(rule).toContain(decl);
});
