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
