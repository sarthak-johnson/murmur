import type { MurmurEvent } from "./events.js";

export const MAX_STRING = 262144;
const R = "[redacted]";

// Order matters: sk-ant- before the generic sk-. Every pattern stays linear on
// hostile input: a lookbehind stops a match starting inside a longer run.
const TOKEN_PATTERNS = [
  // A key with no END (a `head` of the file) redacts to the end of the string.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*)/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?:sk|rk)_live_[A-Za-z0-9]{16,}/g,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /glpat-[A-Za-z0-9_-]{20}/g,
  // Opaque means it has a digit, so prose like "a Bearer token" stays.
  /(?<![A-Za-z])Bearer[ \t]+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi,
];

// Keep the header name (Authorization, Proxy-, X-...), drop the whole credential.
// Quoted value: up to its quote. Scheme word (Basic, token, Digest, AWS4-...):
// everything up to a closing quote or the end of the line, so Digest and SigV4
// parameters go too. Otherwise the first token. Each match reads one line once.
const AUTH_HEADER =
  /((?<!\w)authorization["']?[ \t]*[:=][ \t]*)(["']?)([^\n]*)/gi;
const SCHEME = /^[A-Za-z][\w-]*[ \t]+/;
const CLOSING_QUOTE = /["'](?=[\s);]|$)/;
function authValue(_: string, head: string, q: string, rest: string): string {
  if (q) {
    const end = rest.indexOf(q);
    return `${head}${q}${R}${end < 0 ? "" : rest.slice(end)}`;
  }
  if (SCHEME.test(rest)) {
    const close = CLOSING_QUOTE.exec(rest);
    return `${head}${R}${close ? rest.slice(close.index) : ""}`;
  }
  const token = (/^[^\s"']*/.exec(rest) as RegExpExecArray)[0];
  return `${head}${R}${rest.slice(token.length)}`;
}

// Keep the user, drop the password: scheme://user:pass@ and curl -u user:pass.
const USER_PASS = [
  /((?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/g,
  /((?<!\S)(?:-u|--user)(?:[ \t]+|=)["']?[^\s:"']+:)[^\s"']+/g,
];

// `name = value`, `name: value` and JSON `"name": "value"`, any case. The name is
// matched whole, then checked for secret words in code (linear time). A quoted
// value is cut at its quote, a bare one at whitespace.
const KEY_WORD = /key|secret|token|password|passwd|pwd|credential|auth|dsn/i;
const KEY_VALUE =
  /(?<![\w.-])([\w.-]+)(["']?[ \t]*[:=][ \t]*)(?:(["'])[^"'\n]*|[^"'\s]+)/g;

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
  out = out.replace(AUTH_HEADER, authValue);
  for (const p of USER_PASS) out = out.replace(p, `$1${R}`);
  out = out.replace(KEY_VALUE, (m, name: string, sep: string, q?: string) =>
    KEY_WORD.test(name) ? `${name}${sep}${q ?? ""}${R}` : m,
  );
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

function walk(v: unknown, env = false, max = MAX_STRING): unknown {
  if (typeof v === "string") {
    // Cut first so scrubbing never scans multi-MB strings; N counts the original.
    const limit = max + CUT - MAX_STRING;
    let cut = v.length > limit ? v.slice(0, limit) : v;
    // A token cut in half no longer matches its pattern, and redaction before it can pull
    // it into the part shown: drop the word the cut split (up to 1 KB of it).
    if (cut.length < v.length) {
      let i = cut.length;
      while (i > 0 && i > cut.length - 1024 && !/\s/.test(cut[i - 1] as string))
        i--;
      cut = cut.slice(0, i);
    }
    const s = scrubString(env ? cut.replace(ANY_ASSIGN, `$1${R}`) : cut);
    // N = original chars never read (tail beyond the cut) + scrubbed chars sliced off.
    // Never negative; the marker shows whenever anything was dropped.
    const over = Math.max(0, s.length - max);
    const n = v.length - cut.length + over;
    return n > 0 ? `${s.slice(0, max)}…[truncated ${n} chars]` : s;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, env, max));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const e = env || isEnvFile(o);
    return Object.fromEntries(
      Object.entries(o).map(([k, x]) => [k, walk(x, e, max)]),
    );
  }
  return v;
}

/** How much of a tool result is sent when the view never shows it (file reads, screenshots). */
export const OUTPUT_MAX = 2000;
// The view reads these results: diffs from Edit and Write, the helper's id from Agent.
const SHOWN_RESULTS = new Set(["Edit", "Write", "Agent"]);

export function scrubEvent(e: MurmurEvent): MurmurEvent {
  const p = e.payload;
  if (e.hook !== "PostToolUse" && e.hook !== "PostToolUseFailure")
    return { ...e, payload: walk(p) as Record<string, unknown> };
  // Walked apart from the rest, so a cut marker is never scrubbed a second time. A live
  // failure carries its output in `error`, which no view shows.
  const { tool_response, error, ...rest } = p;
  const payload = walk(rest) as Record<string, unknown>;
  if ("tool_response" in p)
    payload.tool_response = walk(
      tool_response,
      false,
      SHOWN_RESULTS.has(String(p.tool_name)) ? MAX_STRING : OUTPUT_MAX,
    );
  if ("error" in p) payload.error = walk(error, false, OUTPUT_MAX);
  return { ...e, payload };
}
