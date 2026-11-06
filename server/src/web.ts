import { existsSync, readFileSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

// Anything under these prefixes belongs to the API, never to the web app.
const API = /^\/(api|auth|healthz)(\/|$)/;
// A path whose last segment has an extension is a file request: if no such
// file exists, it is a 404, never the app's HTML (which would fail silently).
const FILE = /\.[A-Za-z0-9]+$/;

/** Serves the built web app from `dist`, with a fallback to index.html for app routes. */
export function webRoutes(root: Hono, dist: string): void {
  const indexPath = `${dist}/index.html`;
  root.get("*", serveStatic({ root: dist }));
  root.get("*", (c) => {
    if (API.test(c.req.path) || FILE.test(c.req.path)) return c.notFound();
    // Read on each request so a rebuild never leaves pages pointing at assets
    // that no longer exist. The file is small and the OS caches it.
    if (!existsSync(indexPath)) return c.text("web app not built", 404);
    return c.html(readFileSync(indexPath, "utf8"));
  });
}
