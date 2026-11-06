import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // PGlite boots (WASM + migrations) are slow when files run in parallel.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
