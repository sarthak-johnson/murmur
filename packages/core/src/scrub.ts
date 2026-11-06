import type { MurmurEvent } from "./events.js";

export const MAX_STRING = 262144;
const R = "[redacted]";

// Order matters: sk-ant- before the generic sk-.
const TOKEN_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?:sk|rk)_live_[A-Za-z0-9]{16,}/g,
  /eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

const SECRET_ASSIGN =
  /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|CREDENTIAL|DSN|DATABASE_URL)[A-Z0-9_]*\s*=)[^\n]*/gm;
const ANY_ASSIGN = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)[^\n]*/gm;

export function scrubString(s: string): string {
  let out = s;
  for (const p of TOKEN_PATTERNS) out = out.replace(p, R);
  return out.replace(SECRET_ASSIGN, `$1${R}`);
}

function truncate(s: string): string {
  return s.length > MAX_STRING
    ? `${s.slice(0, MAX_STRING)}…[truncated ${s.length - MAX_STRING} chars]`
    : s;
}

const isEnvFile = (o: Record<string, unknown>) =>
  [o.file_path, o.filePath].some(
    (p) =>
      typeof p === "string" &&
      /^\.env(\..*)?$/.test(p.split(/[\\/]/).pop() ?? ""),
  );

function walk(v: unknown, env = false): unknown {
  if (typeof v === "string") {
    const s = scrubString(env ? v.replace(ANY_ASSIGN, `$1${R}`) : v);
    return truncate(s);
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, env));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const e = env || isEnvFile(o);
    return Object.fromEntries(
      Object.entries(o).map(([k, x]) => [k, walk(x, e)]),
    );
  }
  return v;
}

export function scrubEvent(e: MurmurEvent): MurmurEvent {
  return { ...e, payload: walk(e.payload) as Record<string, unknown> };
}
