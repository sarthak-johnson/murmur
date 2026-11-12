import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const server = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  // ponytail: one bundle (~500 kB, ~150 kB gzipped) for a page served from your own
  // server; split routes with lazy imports if it grows past this.
  build: { chunkSizeWarningLimit: 700 },
  server: { proxy: { "/api": server, "/auth": server, "/healthz": server } },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
});
