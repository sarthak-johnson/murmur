import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A test must never run the real `claude` on PATH: the recap tests pass their own env.
    env: { MURMUR_RECAP: "0" },
  },
});
