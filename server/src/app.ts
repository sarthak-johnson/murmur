import { type Context, Hono } from "hono";
import { except } from "hono/combine";
import { accountRoutes } from "./account.js";
import {
  type AppEnv,
  authRoutes,
  requireSameOrigin,
  requireUser,
} from "./auth.js";
import type { Db } from "./db/client.js";
import { deviceRoutes } from "./device.js";
import { ingestRoutes } from "./ingest.js";
import { sessionRoutes } from "./sessions.js";
import { streamRoutes } from "./stream.js";

export interface GithubProvider {
  createAuthorizationURL(state: string): URL;
  validate(code: string): Promise<{
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  }>;
}

export interface Deps {
  db: Db;
  now: () => Date;
  config: {
    baseUrl: string;
    githubClientId?: string;
    githubClientSecret?: string;
    devLogin: boolean;
    cookieSecure: boolean;
    /** Behind one trusted reverse proxy: take the client IP from the last X-Forwarded-For entry (the one the proxy appended). */
    trustProxy?: boolean;
    /** SSE keep-alive comment interval. Defaults to 20 s. */
    ssePingMs?: number;
  };
  /** Defaults to arctic's GitHub provider when the client id and secret are set. */
  github?: GithubProvider;
  /** Client IP for rate limits. Defaults to the socket address (or X-Forwarded-For with trustProxy). */
  clientIp?: (c: Context) => string | undefined;
}

/** /api routes that do not use the cookie: the CLI's device login, and bearer ingest. */
const NOT_COOKIE = ["/api/device/start", "/api/device/poll", "/api/ingest"];

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/healthz", (c) => c.text("ok"));
  // Default deny: every other /api route is cookie-only, and its mutations are same-origin JSON.
  app.use(
    "/api/*",
    except(NOT_COOKIE, requireSameOrigin(deps), requireUser(deps)),
  );
  authRoutes(app, deps);
  deviceRoutes(app, deps);
  ingestRoutes(app, deps);
  sessionRoutes(app, deps);
  streamRoutes(app, deps);
  accountRoutes(app, deps);
  return app;
}
