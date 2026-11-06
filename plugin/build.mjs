// Bundles the plugin's entry points into plugin/dist, which is committed so the
// installed plugin runs with no install step. CI checks it matches a fresh build.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/hook.ts", "src/mcp.ts", "src/cli.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  logLevel: "warning",
});
