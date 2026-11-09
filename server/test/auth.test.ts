import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test } from "vitest";
import { purgeUnlisted } from "../src/auth.js";
import { events, ingestTokens, users, webSessions } from "../src/db/schema.js";
import {
  BASE,
  ev,
  ingest,
  linkMachine,
  sameOrigin,
  testApp,
} from "./helpers.js";

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

test("without GitHub configured there is no callback, and sign-in links lead home", async () => {
  t = await testApp();
  expect((await t.app.request("/auth/github")).status).toBe(302);
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

test("/auth/options says which sign-in methods this server offers", async () => {
  t = await testApp();
  expect(await (await t.app.request("/auth/options")).json()).toEqual({
    github: false,
    dev: true,
  });
  await t.close();
  t = await testApp({
    config: { devLogin: false, githubClientId: "id", githubClientSecret: "s" },
  });
  expect(await (await t.app.request("/auth/options")).json()).toEqual({
    github: true,
    dev: false,
  });
});

test("/auth/github without GitHub configured goes back to the sign-in page", async () => {
  t = await testApp();
  const res = await t.app.request("/auth/github");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
});

describe("dev login is for this machine only", () => {
  test.each([
    ["http://localhost/auth/dev?login=ada", {}],
    ["http://localhost:8787/auth/dev?login=ada", {}],
    ["http://127.0.0.1:8787/auth/dev?login=ada", {}],
    ["http://[::1]:8787/auth/dev?login=ada", {}],
  ])("%s signs in", async (url, headers) => {
    t = await testApp();
    expect((await t.app.request(url, { headers })).status).toBe(302);
  });

  test.each([
    ["https://my-mac.tail1234.ts.net/auth/dev?login=ada", {}],
    ["http://192.168.1.5:8787/auth/dev?login=ada", {}],
    [
      "http://localhost:8787/auth/dev?login=ada",
      { "X-Forwarded-For": "1.2.3.4" },
    ],
    ["http://localhost:8787/auth/dev?login=ada", { "X-Forwarded-Host": "x" }],
    [
      "http://localhost:8787/auth/dev?login=ada",
      { "X-Forwarded-Proto": "https" },
    ],
    ["http://localhost:8787/auth/dev?login=ada", { Forwarded: "for=1.2.3.4" }],
    ["http://localhost:8787/auth/dev?login=ada", { "X-Real-IP": "1.2.3.4" }],
    [
      "http://localhost:8787/auth/dev?login=ada",
      { "Tailscale-Funnel-Request": "?1" },
    ],
    [
      "http://localhost:8787/auth/dev?login=ada",
      { "Tailscale-User-Login": "a@b" },
    ],
  ])("%s with %o is refused", async (url, headers) => {
    t = await testApp();
    const res = await t.app.request(url, { headers });
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await t.db.select().from(users)).toHaveLength(0);
    const options = await t.app.request(
      url.replace(/\/auth\/dev.*/, "/auth/options"),
      { headers },
    );
    expect(await options.json()).toEqual({ github: false, dev: false });
  });
});

describe("allow-list", () => {
  const fakeGithub = (login: string, id = 7) => ({
    createAuthorizationURL: (state: string) =>
      new URL(`https://github.example/authorize?state=${state}`),
    validate: async () => ({ id, login, name: null, avatarUrl: null }),
  });
  const callback = (app: Awaited<ReturnType<typeof testApp>>["app"]) =>
    app.request("/auth/github/callback?code=c&state=s", {
      headers: { Cookie: "murmur_oauth_state=s" },
    });
  const list = (logins: string[], ids: number[] = []) => ({
    allowList: { logins, ids },
  });

  test("a GitHub login not on the list gets the invite-only page, no user and no session", async () => {
    t = await testApp({ config: list(["ada"]), github: fakeGithub("mallory") });
    const res = await callback(t.app);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain(
      "This Murmur is invite-only. Ask its owner to add your GitHub name.",
    );
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith("murmur_session=")),
    ).toBe(false);
    expect(await t.db.select().from(users)).toHaveLength(0);
    expect(await t.db.select().from(webSessions)).toHaveLength(0);
  });

  test("the list is case-insensitive", async () => {
    t = await testApp({ config: list(["ada"]), github: fakeGithub("AdA") });
    const res = await callback(t.app);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(await t.db.select().from(webSessions)).toHaveLength(1);
  });

  test("a login:id entry follows the GitHub id, not the name", async () => {
    t = await testApp({
      config: list([], [7]),
      github: fakeGithub("ada-renamed", 7),
    });
    expect((await callback(t.app)).status).toBe(302);
    await t.close();
    t = await testApp({ config: list([], [7]), github: fakeGithub("ada", 8) });
    expect((await callback(t.app)).status).toBe(403);
  });

  test("without a list anyone may sign in with GitHub", async () => {
    t = await testApp({ github: fakeGithub("mallory") });
    expect((await callback(t.app)).status).toBe(302);
    expect(await t.db.select().from(users)).toHaveLength(1);
  });

  test("dev login follows the list too", async () => {
    t = await testApp({ config: list(["ada"]) });
    const no = await t.app.request("/auth/dev?login=%3Cb%3Emallory");
    expect(no.status).toBe(403);
    expect(await no.text()).toContain("&lt;b&gt;mallory");
    expect(await t.db.select().from(users)).toHaveLength(0);
    expect((await t.app.request("/auth/dev?login=ADA")).status).toBe(302);
  });

  test("at startup, users taken off the list lose every session, login and token, and keep their data", async () => {
    t = await testApp();
    const ada = await linkMachine(t, "Ada");
    const bob = await linkMachine(t, "bob");
    expect((await ingest(t, ada.token, [ev("s1")])).status).toBe(200);
    // ada has a device login approved but not yet picked up by her CLI.
    const start = await t.app.request("/api/device/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineName: "ada-air" }),
    });
    const { deviceCode, userCode } = (await start.json()) as {
      deviceCode: string;
      userCode: string;
    };
    await t.app.request("/api/device/approve", {
      method: "POST",
      headers: sameOrigin(ada.cookie),
      body: JSON.stringify({ userCode }),
    });

    const config = { baseUrl: BASE, devLogin: false, cookieSecure: false };
    expect(await purgeUnlisted(t.db, config, new Date())).toBe(0);
    expect(
      await purgeUnlisted(t.db, { ...config, ...list(["bob"]) }, new Date()),
    ).toBe(1);

    const me = (cookie: string) =>
      t?.app.request("/api/me", { headers: { Cookie: cookie } });
    expect((await me(ada.cookie))?.status).toBe(401);
    expect((await me(bob.cookie))?.status).toBe(200);
    const approve = await t.app.request("/api/device/approve", {
      method: "POST",
      headers: sameOrigin(ada.cookie),
      body: JSON.stringify({ userCode: "BBBB-BBBB" }),
    });
    expect(approve.status).toBe(401);
    const poll = await t.app.request("/api/device/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    expect(poll.status).toBe(410);
    expect((await ingest(t, ada.token, [ev("s1")])).status).toBe(401);
    expect((await ingest(t, bob.token, [ev("s2")])).status).toBe(200);

    expect(await t.db.select().from(users)).toHaveLength(2);
    expect(
      await t.db.select().from(events).where(eq(events.userId, ada.userId)),
    ).toHaveLength(1);
    const tokens = await t.db.select().from(ingestTokens);
    expect(
      tokens.find((r) => r.userId === ada.userId)?.revokedAt,
    ).not.toBeNull();
    expect(tokens.find((r) => r.userId === bob.userId)?.revokedAt).toBeNull();
  });
});
