import type { Deps } from "./app.js";

/** Pure env parsing; index.ts is the only caller outside tests. */
export function loadConfig(env: NodeJS.ProcessEnv): {
  config: Deps["config"];
  port: number;
  databaseUrl: string | undefined;
} {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT) || 8787;
  const baseUrl =
    env.BASE_URL || (production ? "" : `http://localhost:${port}`);
  if (!baseUrl) throw new Error("BASE_URL is required in production");
  const config: Deps["config"] = {
    baseUrl,
    devLogin: env.MURMUR_DEV_LOGIN === "1" && !production,
    cookieSecure: baseUrl.startsWith("https://"),
    trustProxy: env.TRUST_PROXY === "1",
  };
  if (env.GITHUB_CLIENT_ID) config.githubClientId = env.GITHUB_CLIENT_ID;
  if (env.GITHUB_CLIENT_SECRET)
    config.githubClientSecret = env.GITHUB_CLIENT_SECRET;
  return { config, port, databaseUrl: env.DATABASE_URL || undefined };
}
