import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, expect, test } from "vitest";
import { webRoutes } from "../src/web.js";

let dir: string;
const app = () => {
  const root = new Hono();
  root.get("/api/x", (c) => c.text("api"));
  webRoutes(root, dir);
  return root;
};
const write = (name: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
};
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("SPA fallback serves the current index.html, even after a rebuild", async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-web-"));
  write("index.html", "<p>old</p>");
  const a = app();
  expect(await (await a.request("/device?code=X")).text()).toBe("<p>old</p>");
  write("index.html", "<p>new</p>");
  expect(await (await a.request("/device?code=X")).text()).toBe("<p>new</p>");
});

test("a missing asset file is a 404, not the app's HTML", async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-web-"));
  write("index.html", "<p>app</p>");
  write("assets/app.js", "1");
  const a = app();
  expect((await a.request("/assets/app.js")).status).toBe(200);
  expect((await a.request("/assets/gone.js")).status).toBe(404);
  expect((await a.request("/favicon.ico")).status).toBe(404);
  expect((await a.request("/s/abc")).status).toBe(200);
  expect((await a.request("/api/missing")).status).toBe(404);
});

test("without a build, pages say so and the API still works", async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-web-"));
  const a = app();
  expect((await a.request("/api/x")).status).toBe(200);
  const res = await a.request("/");
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("web app not built");
});
