import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const server = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": server, "/auth": server, "/healthz": server } },
  test: { include: ["test/**/*.test.{ts,tsx}"], environment: "jsdom" },
});
