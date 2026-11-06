import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { openDb } from "../src/db/client.js";

test("close resolves and a second in-memory db still opens", async () => {
  const first = await openDb("memory://");
  await first.close();
  const second = await openDb("memory://");
  const r = await second.db.execute(sql`select count(*)::int as n from users`);
  expect(r.rows[0]?.n).toBe(0);
  await second.close();
});

test("MIGRATIONS_DIR overrides the migrations folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "murmur-mig-"));
  cpSync(new URL("../drizzle", import.meta.url), dir, { recursive: true });
  const prev = process.env.MIGRATIONS_DIR;
  process.env.MIGRATIONS_DIR = dir;
  try {
    const { db, close } = await openDb("memory://");
    const r = await db.execute(sql`select count(*)::int as n from users`);
    expect(r.rows[0]?.n).toBe(0);
    await close();
  } finally {
    if (prev === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = prev;
  }
});
