import type { Deps } from "./app.js";

/** Pure env parsing; index.ts is the only caller outside tests. */
export function loadConfig(env: NodeJS.ProcessEnv): {
  config: Deps["config"];
  port: number;
  host: string | undefined;
  databaseUrl: string | undefined;
  dataDir: string | undefined;
  /** Production only: one line saying who may sign in. */
  startupNote: string | undefined;
} {
  const production = env.NODE_ENV === "production";
  const missing = [
    ...(env.DATABASE_URL || env.MURMUR_DATA_DIR
      ? []
      : ["DATABASE_URL or MURMUR_DATA_DIR"]),
    ...["BASE_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"].filter(
      (k) => !env[k],
    ),
  ];
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
  const allowed = (env.MURMUR_ALLOWED_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length) config.allowedLogins = allowed;
  // Dev login lets anyone sign in as anyone, so it never listens beyond this
  // machine unless HOST says so. Nor does production behind a local proxy
  // (Tailscale Funnel), which is the only way in.
  const local = config.devLogin || (production && config.trustProxy);
  const host = env.HOST || (local ? "127.0.0.1" : undefined);
  const n = allowed.length;
  const startupNote = !production
    ? undefined
    : n
      ? `Murmur is invite-only: ${n} GitHub login${n === 1 ? "" : "s"} may sign in.`
      : "Murmur is open: anyone with a GitHub account can sign in. Set MURMUR_ALLOWED_LOGINS to make it invite-only.";
  return {
    config,
    port,
    host,
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.MURMUR_DATA_DIR || undefined,
    startupNote,
  };
}
