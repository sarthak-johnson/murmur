import { createApp, type Deps } from "../src/app.js";
import { openDb } from "../src/db/client.js";

export const BASE = "http://localhost";

export interface TestOptions {
  now?: () => Date;
  config?: Partial<Deps["config"]>;
  github?: Deps["github"];
  clientIp?: Deps["clientIp"];
}

export async function testApp(opts: TestOptions = {}) {
  const { db, close } = await openDb("memory://");
  const deps: Deps = {
    db,
    now: opts.now ?? (() => new Date()),
    config: {
      baseUrl: BASE,
      devLogin: true,
      cookieSecure: false,
      ...opts.config,
    },
  };
  if (opts.github) deps.github = opts.github;
  if (opts.clientIp) deps.clientIp = opts.clientIp;
  const app = createApp(deps);
  /** Logs in through /auth/dev and returns the Cookie header value. */
  const loginAs = async (login: string): Promise<string> => {
    const res = await app.request(
      `/auth/dev?login=${encodeURIComponent(login)}`,
    );
    const set = res.headers.get("set-cookie");
    if (res.status !== 302 || !set) throw new Error(`dev login ${res.status}`);
    return set.split(";")[0] as string;
  };
  return { app, db, loginAs, close };
}

/** Headers for a cookie-authenticated mutating request from the web page. */
export const sameOrigin = (cookie: string) => ({
  Cookie: cookie,
  Origin: BASE,
  "Content-Type": "application/json",
});
