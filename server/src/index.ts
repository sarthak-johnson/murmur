import type { Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { purgeUnlisted } from "./auth.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { runRetention } from "./retention.js";
import { backfillSummaries, stopSummaries } from "./summary.js";
import { webRoutes } from "./web.js";

let loaded: ReturnType<typeof loadConfig>;
try {
  loaded = loadConfig(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const { config, port, host, databaseUrl, dataDir, startupNote } = loaded;
if (startupNote) console.log(startupNote);
const { db, close } = await openDb(databaseUrl, dataDir);
const signedOut = await purgeUnlisted(db, config, new Date());
if (signedOut)
  console.log(
    `Signed out ${signedOut} user${signedOut === 1 ? "" : "s"} no longer on MURMUR_ALLOWED_LOGINS.`,
  );
const api = createApp({ db, now: () => new Date(), config });

const dist =
  process.env.WEB_DIST ||
  fileURLToPath(new URL("../../web/dist", import.meta.url));
const root = new Hono();
root.route("/", api);
webRoutes(root, dist);

const retain = () =>
  runRetention(db, new Date()).catch((e) => console.error("retention:", e));
await retain();
const timer = setInterval(retain, 60 * 60 * 1000);
// The lobby reads stored summaries; any missing or stale are read in the background.
void backfillSummaries(db).catch((e) => console.error("summaries:", e));

const server = serve(
  { fetch: root.fetch, port, ...(host ? { hostname: host } : {}) },
  (i) =>
    console.log(`murmur listening on ${host ?? "all interfaces"}:${i.port}`),
);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  // Summary reads under way finish before the pool closes; ones still waiting are read
  // again at the next start (backfillSummaries).
  server.close(() =>
    stopSummaries()
      .catch((e) => console.error("summaries:", e))
      .then(close)
      .finally(() => process.exit(0)),
  );
  // Open SSE streams would hold close() forever.
  (server as HttpServer).closeAllConnections();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
