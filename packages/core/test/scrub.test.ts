import { expect, test } from "vitest";
import { MAX_STRING, scrubEvent, scrubString } from "../src/index.js";
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
