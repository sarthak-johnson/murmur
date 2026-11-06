import { expect, test } from "vitest";
import {
  MAX_STRING,
  OUTPUT_MAX,
  scrubEvent,
  scrubString,
} from "../src/index.js";
import { ev } from "./helpers.js";

test("redacts known key formats", () => {
  for (const k of [
    `sk-ant-api03-${"a".repeat(40)}`,
    `ghp_${"A".repeat(36)}`,
    "AKIAABCDEFGHIJKLMNOP",
    "xoxb-1234567890-abc",
    `sk_live_${"x".repeat(24)}`,
  ])
    expect(scrubString(`key=${k} end`)).toBe("key=[redacted] end");
});

test("redacts private key blocks and JWTs", () => {
  expect(
    scrubString(
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    ),
  ).toBe("[redacted]");
  expect(
    scrubString(
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    ),
  ).toBe("[redacted]");
});

test("redacts secret-looking assignments but keeps the name", () => {
  expect(scrubString("export STRIPE_SECRET_KEY=abc123\nPORT=3000")).toBe(
    "export STRIPE_SECRET_KEY=[redacted]\nPORT=3000",
  );
});

test("redacts every assignment value in .env files", () => {
  const e = ev({
    tool_input: { file_path: "/p/.env.local", content: "PORT=3000\nNAME=x" },
  });
  expect(scrubEvent(e).payload.tool_input).toEqual({
    file_path: "/p/.env.local",
    content: "PORT=[redacted]\nNAME=[redacted]",
  });
});

test("truncates long strings without mutating the input", () => {
  const e = ev({ big: "a".repeat(MAX_STRING + 10) });
  const s = scrubEvent(e).payload.big as string;
  expect(s.endsWith("…[truncated 10 chars]")).toBe(true);
  expect(e.payload.big).toHaveLength(MAX_STRING + 10);
});

test("scrubs nested strings in arrays and objects", () => {
  const e = ev({ a: [{ b: `ghp_${"A".repeat(36)}` }] });
  expect(scrubEvent(e).payload).toEqual({ a: [{ b: "[redacted]" }] });
});

test("redacts sk-proj and sk-svcacct keys but not words ending in sk-", () => {
  expect(scrubString(`x sk-proj-${"aB3_-".repeat(8)} y`)).toBe(
    "x [redacted] y",
  );
  expect(scrubString(`sk-svcacct-${"a".repeat(30)}`)).toBe("[redacted]");
  expect(scrubString(`disk-${"a".repeat(30)}`)).toBe(`disk-${"a".repeat(30)}`);
});

test("redacts assignments inside diff lines", () => {
  expect(scrubString("+STRIPE_SECRET_KEY=abc")).toBe(
    "+STRIPE_SECRET_KEY=[redacted]",
  );
  expect(scrubString("+API_KEY=abc\n-PORT=3000")).toBe(
    "+API_KEY=[redacted]\n-PORT=3000",
  );
});

test("redacts a .env structuredPatch", () => {
  const e = ev({
    tool_input: { file_path: "/p/.env" },
    tool_response: {
      filePath: "/p/.env",
      structuredPatch: [{ lines: ["-PORT=3000", "+PORT=4000", " NAME=x"] }],
    },
  });
  const r = scrubEvent(e).payload.tool_response as {
    structuredPatch: { lines: string[] }[];
  };
  expect(r.structuredPatch[0]?.lines).toEqual([
    "-PORT=[redacted]",
    "+PORT=[redacted]",
    " NAME=[redacted]",
  ]);
});

test("scrubbing pathological inputs is fast", () => {
  for (const s of ["\n".repeat(MAX_STRING), "KEY".repeat(MAX_STRING / 3)]) {
    const t = performance.now();
    scrubEvent(ev({ s }));
    expect(performance.now() - t).toBeLessThan(200);
  }
});

test("oversized strings are cut before scrubbing; N counts the original", () => {
  const s = scrubEvent(ev({ big: "a".repeat(MAX_STRING * 3) })).payload
    .big as string;
  expect(s.endsWith(`…[truncated ${MAX_STRING * 2} chars]`)).toBe(true);
});

test("marks truncation even when redaction shrinks the cut text below the limit", () => {
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(6000)}\n-----END RSA PRIVATE KEY-----`;
  const s = scrubEvent(ev({ big: `${pem}${"y".repeat(MAX_STRING)}TAIL` }))
    .payload.big as string;
  expect(s).toMatch(/…\[truncated \d+ chars\]$/);
  expect(s).not.toContain("TAIL");
});

test("truncation count is never negative when redaction lengthens the text", () => {
  const s = scrubEvent(ev({ big: `API_KEY=a\n${"y".repeat(MAX_STRING - 12)}` }))
    .payload.big as string;
  expect(s).toMatch(/…\[truncated [1-9]\d* chars\]$/);
});

test.each([
  [
    `curl -H "Authorization: Bearer abc123def456ghi" https://api.x.com`,
    `curl -H "Authorization: [redacted]" https://api.x.com`,
  ],
  ["Bearer abc123def456ghi", "[redacted]"],
  [
    "psql postgres://app:pw@db.host:5432/app",
    "psql postgres://app:[redacted]@db.host:5432/app",
  ],
  ["curl -u user:pw https://x.com", "curl -u user:[redacted] https://x.com"],
  [`api_key = "abc def"`, `api_key = "[redacted]"`],
  [`{"apiKey": "abc123"}`, `{"apiKey": "[redacted]"}`],
  ["password: hunter2", "password: [redacted]"],
  [
    "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
    "aws_secret_access_key = [redacted]",
  ],
  [`x AIza${"a1_-".repeat(8)}abc y`, "x [redacted] y"],
  [`x npm_${"a1B".repeat(12)} y`, "x [redacted] y"],
  [`x glpat-${"a1_-B".repeat(4)} y`, "x [redacted] y"],
  [
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAABG5vbmUAAAAEbm9uZQ",
    "[redacted]",
  ],
  ["Token=abc next", "Token=[redacted] next"],
  [
    "Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l",
    "Authorization: [redacted]",
  ],
  [
    `curl -H "Authorization: token ghxabcdefghijkl" https://api.x.com`,
    `curl -H "Authorization: [redacted]" https://api.x.com`,
  ],
  ["Authorization: Bearer abcdefghijklmnop", "Authorization: [redacted]"],
  [
    `{"Authorization": "Basic YWxhZGRpbjpvcGVu"}`,
    `{"Authorization": "[redacted]"}`,
  ],
  ["proxy-authorization: Digest abc", "proxy-authorization: [redacted]"],
  ["X-Authorization: Basic YWxhZGRpbjpvcGVu", "X-Authorization: [redacted]"],
  [
    `Authorization: Digest username="Mufasa", nonce="dcd98b", response="6629fa"`,
    `Authorization: [redacted]"`,
  ],
  [
    "Authorization: AWS4-HMAC-SHA256 Credential=AKID/x, Signature=fe5f80f77d5f",
    "Authorization: [redacted]",
  ],
  ["PORT=3000 name: Sam", "PORT=3000 name: Sam"],
])("redacts %j", (input, out) => {
  expect(scrubString(input)).toBe(out);
});

const N = MAX_STRING;
test.each([
  ["eyJ", "eyJ".repeat(N / 3)],
  ["eyJ run", `eyJ${"a".repeat(N)}`],
  ["eyJ dotted", `eyJ${"a".repeat(8)}.`.repeat(N / 12)],
  ["BEGIN headers", "-----BEGIN RSA PRIVATE KEY-----".repeat(N / 31)],
  ["BEGIN letters", `-----BEGIN ${"A ".repeat(N / 2)}`],
  ["identifier", "a".repeat(N)],
  ["key words", "key".repeat(N / 3)],
  ["key spaces", `key${" ".repeat(N)}`],
  ["key colons", "key:".repeat(N / 4)],
  ["quoted keys", `"token" `.repeat(N / 8)],
  ["quotes", `"'`.repeat(N / 2)],
  ["assigns", "a=".repeat(N / 2)],
  ["dots", "a.".repeat(N / 2)],
  ["schemes", "a://".repeat(N / 4)],
  ["scheme user", `a://${"b".repeat(N)}`],
  ["scheme user colon", `a://b:${"c".repeat(N)}`],
  ["dash u", "-u ".repeat(N / 3)],
  ["dash u user", `-u ${"a".repeat(N)}`],
  ["bearer", "Bearer ".repeat(N / 7)],
  ["bearer run", `Bearer ${"a".repeat(N)}`],
  ["authorization headers", "Authorization: Basic ".repeat(N / 21)],
  ["authorization spaces", `Authorization:${" ".repeat(N)}`],
  ["authorization quotes", `Authorization:"`.repeat(N / 15)],
  ["x-authorization", "x-authorization: a ".repeat(N / 19)],
  ["authorization no colon", "authorization".repeat(N / 13)],
  [
    "authorization scheme quotes",
    `Authorization: Digest ${`a="b", `.repeat(N / 8)}`,
  ],
  [
    "prefixes",
    "AIza npm_ glpat- ghp_ xoxb- sk_live_ AKIA sk-ant- ".repeat(N / 48),
  ],
  ["newlines", "\n".repeat(N)],
  ["KEY", "KEY".repeat(N / 3)],
  ["env lines", "A_KEY \n".repeat(N / 7)],
])("scrub stays fast on hostile %s input", (_, s) => {
  const t = performance.now();
  scrubString(s);
  expect(performance.now() - t).toBeLessThan(200);
});

test("cuts the results nothing shows to their start; keeps Edit, Write and Agent results whole", () => {
  const big = "x".repeat(50_000);
  const post = (tool_name: string, hook = "PostToolUse") => ({
    ...ev({
      tool_name,
      tool_input: { file_path: "/p/a.ts", content: big },
      tool_response: { file: { content: big }, stdout: big },
    }),
    hook,
  });
  for (const tool of ["Read", "Bash", "mcp__x__screenshot"]) {
    const r = scrubEvent(post(tool) as never).payload.tool_response as {
      file: { content: string };
      stdout: string;
    };
    expect(r.stdout).toBe(
      `${"x".repeat(OUTPUT_MAX)}…[truncated ${50_000 - OUTPUT_MAX} chars]`,
    );
    expect(r.file.content.length).toBeLessThan(OUTPUT_MAX + 40);
  }
  expect(
    (
      scrubEvent(post("Read", "PostToolUseFailure") as never).payload
        .tool_response as { stdout: string }
    ).stdout.length,
  ).toBeLessThan(OUTPUT_MAX + 40);
  for (const tool of ["Edit", "Write", "Agent"]) {
    const p = scrubEvent(post(tool) as never).payload;
    expect((p.tool_response as { stdout: string }).stdout).toBe(big);
  }
  // Inputs stay whole: a Write's content is the code change.
  expect(
    (
      scrubEvent(post("Read") as never).payload.tool_input as {
        content: string;
      }
    ).content,
  ).toBe(big);
});
