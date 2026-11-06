import { existsSync, readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { runRetention } from "./retention.js";

let loaded: ReturnType<typeof loadConfig>;
try {
  loaded = loadConfig(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const { config, port, databaseUrl } = loaded;
const { db, close } = await openDb(databaseUrl);
const api = createApp({ db, now: () => new Date(), config });

const dist =
  process.env.WEB_DIST ||
  fileURLToPath(new URL("../../web/dist", import.meta.url));
const root = new Hono();
root.route("/", api);
// Anything that is not the API: a built file, else index.html (SPA fallback).
const API = /^\/(api|auth|healthz)(\/|$)/;
if (existsSync(`${dist}/index.html`)) {
  const index = readFileSync(`${dist}/index.html`, "utf8");
  root.get("*", serveStatic({ root: dist }));
  root.get("*", (c) => (API.test(c.req.path) ? c.notFound() : c.html(index)));
} else {
  root.get("*", (c) =>
    API.test(c.req.path) ? c.notFound() : c.text("web app not built", 404),
  );
}

const retain = () =>
  runRetention(db, new Date()).catch((e) => console.error("retention:", e));
await retain();
const timer = setInterval(retain, 60 * 60 * 1000);

const server = serve({ fetch: root.fetch, port }, (i) =>
  console.log(`murmur listening on :${i.port}`),
);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(() => close().finally(() => process.exit(0)));
  // Open SSE streams would hold close() forever.
  (server as HttpServer).closeAllConnections();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
