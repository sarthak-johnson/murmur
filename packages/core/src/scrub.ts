import type { MurmurEvent } from "./events.js";

export const MAX_STRING = 262144;
const R = "[redacted]";

// Order matters: sk-ant- before the generic sk-.
const TOKEN_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?:sk|rk)_live_[A-Za-z0-9]{16,}/g,
  /eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

// Anchored without \s so matches never cross newlines (linear time). The name is
// matched whole, then checked for secret words in code. A leading +/-/space keeps
// diff lines (structuredPatch) covered.
const SECRET_NAME =
  /KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|CREDENTIAL|DSN|DATABASE_URL/;
const SECRET_ASSIGN =
  /^([+\- ]?[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=)[^\n]*/gm;
const ANY_ASSIGN =
  /^([+\- ]?[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=)[^\n]*/gm;
const CUT = MAX_STRING + 4096;

export function scrubString(s: string): string {
  let out = s;
  for (const p of TOKEN_PATTERNS) out = out.replace(p, R);
  return out.replace(SECRET_ASSIGN, (m, head: string, name: string) =>
    SECRET_NAME.test(name) ? `${head}${R}` : m,
  );
}

const isEnvFile = (o: Record<string, unknown>) =>
  [o.file_path, o.filePath].some(
    (p) =>
      typeof p === "string" &&
      /^\.env(\..*)?$/.test(p.split(/[\\/]/).pop() ?? ""),
  );

function walk(v: unknown, env = false): unknown {
  if (typeof v === "string") {
    // Cut first so scrubbing never scans multi-MB strings; N counts the original.
    const cut = v.length > CUT ? v.slice(0, CUT) : v;
    const s = scrubString(env ? cut.replace(ANY_ASSIGN, `$1${R}`) : cut);
    return s.length > MAX_STRING
      ? `${s.slice(0, MAX_STRING)}…[truncated ${v.length - MAX_STRING} chars]`
      : s;
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
