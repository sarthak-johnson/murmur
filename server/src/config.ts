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
  if (env.DATABASE_URL && env.MURMUR_DATA_DIR)
    throw new Error("Set DATABASE_URL or MURMUR_DATA_DIR, not both.");
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
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(
    /\/+$/,
    "",
  );
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
  // Unset or "*" means anyone may sign in.
  const n = allowed.includes("*") ? 0 : allowed.length;
  if (n) config.allowList = parseAllowList(allowed);
  // Dev login lets anyone sign in as anyone, so it never listens beyond this
  // machine unless HOST says so. Nor does production behind a local proxy
  // (Tailscale Funnel), which is the only way in.
  const local = config.devLogin || (production && config.trustProxy);
  const host = env.HOST || (local ? "127.0.0.1" : undefined);
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

/** "login" matches the GitHub login (any case); "login:id" matches only the numeric GitHub id. */
function parseAllowList(entries: string[]) {
  const list = { logins: [] as string[], ids: [] as number[] };
  for (const e of entries) {
    const m = /^([a-z0-9-]+)(?::(\d+))?$/.exec(e);
    if (!m?.[1])
      throw new Error(
        `MURMUR_ALLOWED_LOGINS: "${e}" is not a GitHub login or login:id.`,
      );
    if (m[2]) list.ids.push(Number(m[2]));
    else list.logins.push(m[1]);
  }
  return list;
}
