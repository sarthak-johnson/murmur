import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["real-session.test.ts"],
    // A real Claude Code run takes minutes.
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
