import { chmodSync, cpSync, mkdtempSync, statSync } from "node:fs";
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

test("a data dir is created 0700 and keeps its data across opens", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "murmur-data-")), "a", "db");
  const first = await openDb(undefined, dir);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  await first.db.execute(
    sql`insert into users (github_id, login) values (7, 'ada')`,
  );
  await first.close();
  const second = await openDb(undefined, dir);
  const r = await second.db.execute(sql`select login from users`);
  expect(r.rows).toEqual([{ login: "ada" }]);
  await second.close();
});

test("an existing data dir is made owner-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "murmur-data-"));
  chmodSync(dir, 0o755);
  const { close } = await openDb(undefined, dir);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  await close();
});
