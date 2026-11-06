import type { Deps } from "./app.js";

/** Pure env parsing; index.ts is the only caller outside tests. */
export function loadConfig(env: NodeJS.ProcessEnv): {
  config: Deps["config"];
  port: number;
  host: string | undefined;
  databaseUrl: string | undefined;
} {
  const production = env.NODE_ENV === "production";
  const required = [
    "DATABASE_URL",
    "BASE_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ];
  const missing = required.filter((k) => !env[k]);
  if (production && missing.length)
    throw new Error(
      `Murmur cannot start in production without ${missing.join(", ")}.`,
    );
  const port = Number(env.PORT) || 8787;
  const baseUrl = env.BASE_URL || `http://localhost:${port}`;
  const config: Deps["config"] = {
    baseUrl,
    devLogin: env.MURMUR_DEV_LOGIN === "1" && !production,
    cookieSecure: baseUrl.startsWith("https://"),
    trustProxy: env.TRUST_PROXY === "1",
  };
  if (env.GITHUB_CLIENT_ID) config.githubClientId = env.GITHUB_CLIENT_ID;
  if (env.GITHUB_CLIENT_SECRET)
    config.githubClientSecret = env.GITHUB_CLIENT_SECRET;
  // Dev login lets anyone sign in as anyone, so it never listens beyond this
  // machine unless HOST says so.
  const host = env.HOST || (config.devLogin ? "127.0.0.1" : undefined);
  return { config, port, host, databaseUrl: env.DATABASE_URL || undefined };
}
