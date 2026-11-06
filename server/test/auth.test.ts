import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { users, webSessions } from "../src/db/schema.js";
import { sameOrigin, testApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof testApp>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

test("dev login sets a cookie and /api/me returns the user", async () => {
  t = await testApp();
  const res = await t.app.request("/auth/dev?login=ada");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  const set = res.headers.get("set-cookie") ?? "";
  expect(set).toMatch(/^murmur_session=[A-Za-z0-9_-]{43};/);
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Lax");
  expect(set).toContain("Max-Age=2592000");
  expect(set).not.toContain("Secure");

  const cookie = set.split(";")[0] as string;
  const raw = cookie.slice("murmur_session=".length);
  const rows = await t.db.select().from(webSessions);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.idHash).toBe(sha(raw));

  const me = await t.app.request("/api/me", { headers: { Cookie: cookie } });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    login: "ada",
    name: null,
    avatarUrl: null,
  });
});

test("dev login is 404 when devLogin is false", async () => {
  t = await testApp({ config: { devLogin: false } });
  const res = await t.app.request("/auth/dev?login=ada");
  expect(res.status).toBe(404);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("dev login gives a stable negative github id per login", async () => {
  t = await testApp();
  await t.loginAs("ada");
  await t.loginAs("ada");
  await t.loginAs("bob");
  const rows = await t.db.select().from(users);
  expect(rows).toHaveLength(2);
  for (const u of rows) expect(u.githubId).toBeLessThan(0);
});

test("secure cookie when cookieSecure", async () => {
  t = await testApp({ config: { cookieSecure: true } });
  const res = await t.app.request("/auth/dev?login=ada");
  expect(res.headers.get("set-cookie")).toContain("Secure");
});

test("/api/me without a valid cookie is 401", async () => {
  t = await testApp();
  const none = await t.app.request("/api/me");
  expect(none.status).toBe(401);
  expect(await none.json()).toEqual({ error: "unauthorized" });
  const bad = await t.app.request("/api/me", {
    headers: { Cookie: "murmur_session=nope" },
  });
  expect(bad.status).toBe(401);
});

test("expired session is 401 and is deleted", async () => {
  let now = new Date("2026-11-06T00:00:00Z");
  t = await testApp({ now: () => now });
  const cookie = await t.loginAs("ada");
  now = new Date("2026-12-07T00:00:00Z");
  const res = await t.app.request("/api/me", { headers: { Cookie: cookie } });
  expect(res.status).toBe(401);
  expect(await t.db.select().from(webSessions)).toHaveLength(0);
});

test("logout needs same origin and JSON, then ends the session", async () => {
  t = await testApp();
  const cookie = await t.loginAs("ada");
  const noOrigin = await t.app.request("/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  expect(noOrigin.status).toBe(403);
  expect(await noOrigin.json()).toEqual({ error: "forbidden" });
  const form = await t.app.request("/auth/logout", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://localhost",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  expect(form.status).toBe(403);

  const ok = await t.app.request("/auth/logout", {
    method: "POST",
    headers: sameOrigin(cookie),
    body: "{}",
  });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("set-cookie")).toMatch(/murmur_session=;.*Max-Age=0/);
  expect(await t.db.select().from(webSessions)).toHaveLength(0);
  const me = await t.app.request("/api/me", { headers: { Cookie: cookie } });
  expect(me.status).toBe(401);
});

test("github routes are 404 when GitHub is not configured", async () => {
  t = await testApp();
  expect((await t.app.request("/auth/github")).status).toBe(404);
  expect((await t.app.request("/auth/github/callback")).status).toBe(404);
});

test("github login checks state and upserts the user", async () => {
  let profile = {
    id: 42,
    login: "ada",
    name: "Ada L" as string | null,
    avatarUrl: "https://avatars/42" as string | null,
  };
  const codes: string[] = [];
  t = await testApp({
    github: {
      createAuthorizationURL: (state) =>
        new URL(`https://github.example/authorize?state=${state}`),
      validate: async (code) => {
        codes.push(code);
        return profile;
      },
    },
  });

  const start = await t.app.request("/auth/github");
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0];
  expect(stateCookie).toBe(`murmur_oauth_state=${state}`);

  const wrong = await t.app.request(
    "/auth/github/callback?code=c1&state=other",
    { headers: { Cookie: stateCookie as string } },
  );
  expect(wrong.status).toBe(400);
  const missing = await t.app.request(
    `/auth/github/callback?code=c1&state=${state}`,
  );
  expect(missing.status).toBe(400);
  expect(codes).toEqual([]);

  const ok = await t.app.request(
    `/auth/github/callback?code=c1&state=${state}`,
    { headers: { Cookie: stateCookie as string } },
  );
  expect(ok.status).toBe(302);
  expect(ok.headers.get("location")).toBe("/");
  expect(codes).toEqual(["c1"]);
  const cookie = ok.headers
    .getSetCookie()
    .find((c) => c.startsWith("murmur_session="))
    ?.split(";")[0] as string;
  const me = await t.app.request("/api/me", { headers: { Cookie: cookie } });
  expect(await me.json()).toMatchObject({
    login: "ada",
    name: "Ada L",
    avatarUrl: "https://avatars/42",
  });

  profile = { ...profile, login: "ada2", name: null };
  await t.app.request(`/auth/github/callback?code=c2&state=${state}`, {
    headers: { Cookie: stateCookie as string },
  });
  const rows = await t.db.select().from(users).where(eq(users.githubId, 42));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ login: "ada2", name: null });
});

test("github callback with a failing code is 400", async () => {
  t = await testApp({
    github: {
      createAuthorizationURL: (state) =>
        new URL(`https://github.example/authorize?state=${state}`),
      validate: async () => {
        throw new Error("bad_verification_code");
      },
    },
  });
  const res = await t.app.request("/auth/github/callback?code=x&state=s", {
    headers: { Cookie: "murmur_oauth_state=s" },
  });
  expect(res.status).toBe(400);
  expect(await t.db.select().from(users)).toHaveLength(0);
});

test("with client id and secret, /auth/github redirects to GitHub with read:user", async () => {
  t = await testApp({
    config: { githubClientId: "cid", githubClientSecret: "secret" },
  });
  const res = await t.app.request("/auth/github");
  expect(res.status).toBe(302);
  const url = new URL(res.headers.get("location") ?? "");
  expect(url.origin + url.pathname).toBe(
    "https://github.com/login/oauth/authorize",
  );
  expect(url.searchParams.get("client_id")).toBe("cid");
  expect(url.searchParams.get("scope")).toBe("read:user");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "http://localhost/auth/github/callback",
  );
  expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("every response forbids framing and content sniffing", async () => {
  t = await testApp();
  for (const url of ["/healthz", "/api/me", "/api/nope"]) {
    const res = await t.app.request(url);
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  }
});
