import { Hono } from "hono";
import type { Db } from "./db/client.js";

export interface Deps {
  db: Db;
  now: () => Date;
  config: {
    baseUrl: string;
    githubClientId?: string;
    githubClientSecret?: string;
    devLogin: boolean;
    cookieSecure: boolean;
  };
}

export function createApp(_deps: Deps): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.text("ok"));
  return app;
}
