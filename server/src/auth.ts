import { createHash, randomBytes } from "node:crypto";
import { GitHub } from "arctic";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Deps, GithubProvider } from "./app.js";
import { ingestTokens, users, webSessions } from "./db/schema.js";

export type User = typeof users.$inferSelect;
export interface AppEnv {
  Variables: {
    user: User;
    ingest: { userId: string; machineId: string };
  };
}

const SESSION_COOKIE = "murmur_session";
const STATE_COOKIE = "murmur_oauth_state";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export const sha256 = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

const unauthorized = (c: Context) => c.json({ error: "unauthorized" }, 401);

/** Reads a JSON object body; null when the body is missing or not an object. */
export async function readBody(
  c: Context,
): Promise<Record<string, unknown> | null> {
  const b: unknown = await c.req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b)
    ? (b as Record<string, unknown>)
    : null;
}

/** Cookie user. 401 when the cookie is missing, unknown or expired (expired rows are deleted). */
export const requireUser = ({ db, now }: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const raw = getCookie(c, SESSION_COOKIE);
    if (!raw) return unauthorized(c);
    const idHash = sha256(raw);
    const [row] = await db
      .select({ user: users, expiresAt: webSessions.expiresAt })
      .from(webSessions)
      .innerJoin(users, eq(users.id, webSessions.userId))
      .where(eq(webSessions.idHash, idHash));
    if (!row) return unauthorized(c);
    if (row.expiresAt <= now()) {
      await db.delete(webSessions).where(eq(webSessions.idHash, idHash));
      return unauthorized(c);
    }
    c.set("user", row.user);
    await next();
  });

/** Bearer ingest token. 401 when missing, unknown or revoked; records last use. */
export const requireIngest = ({ db, now }: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const m = /^Bearer (mur_[A-Za-z0-9_-]+)$/.exec(
      c.req.header("authorization") ?? "",
    );
    if (!m?.[1]) return unauthorized(c);
    const [row] = await db
      .update(ingestTokens)
      .set({ lastUsedAt: now() })
      .where(
        and(
          eq(ingestTokens.tokenHash, sha256(m[1])),
          isNull(ingestTokens.revokedAt),
        ),
      )
      .returning({
        userId: ingestTokens.userId,
        machineId: ingestTokens.machineId,
      });
    if (!row) return unauthorized(c);
    c.set("ingest", row);
    await next();
  });

/**
 * CSRF guard for cookie-authenticated mutating routes: needs a JSON body and an
 * Origin equal to baseUrl. GET and HEAD pass through.
 */
export const requireSameOrigin = ({ config }: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const type = c.req.header("content-type") ?? "";
      if (
        c.req.header("origin") !== config.baseUrl ||
        !/^application\/json\s*(;|$)/i.test(type)
      )
        return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

async function startSession(c: Context, deps: Deps, userId: string) {
  const raw = randomToken();
  await deps.db.insert(webSessions).values({
    idHash: sha256(raw),
    userId,
    expiresAt: new Date(deps.now().getTime() + SESSION_SECONDS * 1000),
  });
  setCookie(c, SESSION_COOKIE, raw, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: deps.config.cookieSecure,
    maxAge: SESSION_SECONDS,
  });
}

/** Stable fake id in [-2^31, -1], so it never collides with a real (positive) GitHub id. */
const devGithubId = (login: string) =>
  -(createHash("sha256").update(login).digest().readUInt32BE(0) & 0x7fffffff) -
  1;

function arcticGithub(
  clientId: string,
  clientSecret: string,
  baseUrl: string,
): GithubProvider {
  const gh = new GitHub(
    clientId,
    clientSecret,
    `${baseUrl}/auth/github/callback`,
  );
  return {
    createAuthorizationURL: (state) =>
      gh.createAuthorizationURL(state, ["read:user"]),
    async validate(code) {
      const tokens = await gh.validateAuthorizationCode(code);
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokens.accessToken()}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "murmur",
        },
      });
      if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`);
      const u = (await res.json()) as Record<string, unknown>;
      if (typeof u.id !== "number" || typeof u.login !== "string")
        throw new Error("GitHub /user returned an unexpected shape");
      return {
        id: u.id,
        login: u.login,
        name: typeof u.name === "string" ? u.name : null,
        avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url : null,
      };
    },
  };
}

export function authRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { db, config } = deps;
  const github =
    deps.github ??
    (config.githubClientId && config.githubClientSecret
      ? arcticGithub(
          config.githubClientId,
          config.githubClientSecret,
          config.baseUrl,
        )
      : undefined);
  const stateCookie = {
    path: "/auth/github",
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSecure,
  } as const;

  if (github) {
    app.get("/auth/github", (c) => {
      const state = randomToken();
      setCookie(c, STATE_COOKIE, state, { ...stateCookie, maxAge: 600 });
      return c.redirect(github.createAuthorizationURL(state).toString());
    });

    app.get("/auth/github/callback", async (c) => {
      const state = c.req.query("state");
      const code = c.req.query("code");
      const expected = getCookie(c, STATE_COOKIE);
      deleteCookie(c, STATE_COOKIE, stateCookie);
      if (!state || !code || !expected || state !== expected)
        return c.json({ error: "bad_request" }, 400);
      let profile: Awaited<ReturnType<GithubProvider["validate"]>>;
      try {
        profile = await github.validate(code);
      } catch {
        return c.json({ error: "github_failed" }, 400);
      }
      const fields = {
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      };
      const [user] = await db
        .insert(users)
        .values({ githubId: profile.id, ...fields })
        .onConflictDoUpdate({ target: users.githubId, set: fields })
        .returning({ id: users.id });
      if (!user) throw new Error("user upsert returned no row");
      await startSession(c, deps, user.id);
      return c.redirect("/");
    });
  } else {
    // No GitHub app configured: the sign-in page never offers it, and an old
    // link lands back there instead of on a bare 404.
    app.get("/auth/github", (c) => c.redirect("/"));
  }

  // Public, so the sign-in page shows only the methods this server has.
  app.get("/auth/options", (c) =>
    c.json({ github: Boolean(github), dev: config.devLogin }),
  );

  if (config.devLogin) {
    app.get("/auth/dev", async (c) => {
      const login = c.req.query("login")?.trim();
      if (!login) return c.json({ error: "bad_request" }, 400);
      const [user] = await db
        .insert(users)
        .values({ githubId: devGithubId(login), login })
        .onConflictDoUpdate({ target: users.githubId, set: { login } })
        .returning({ id: users.id });
      if (!user) throw new Error("user upsert returned no row");
      await startSession(c, deps, user.id);
      return c.redirect("/");
    });
  }

  app.post("/auth/logout", requireSameOrigin(deps), async (c) => {
    const raw = getCookie(c, SESSION_COOKIE);
    if (raw)
      await db.delete(webSessions).where(eq(webSessions.idHash, sha256(raw)));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const u = c.get("user");
    return c.json({
      id: u.id,
      login: u.login,
      name: u.name,
      avatarUrl: u.avatarUrl,
    });
  });
}
