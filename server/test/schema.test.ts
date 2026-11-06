import { sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { testApp } from "./helpers.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

test("migrations create every table and the events index on PGlite", async () => {
  const { db, app, close } = await testApp();
  closers.push(close);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const names = tables.rows.map((r: Record<string, unknown>) => r.table_name);
  for (const t of [
    "users",
    "web_sessions",
    "device_codes",
    "ingest_tokens",
    "sessions",
    "events",
    "assumption_decisions",
  ]) {
    expect(names).toContain(t);
  }
  const idx = await db.execute(
    sql`select indexname from pg_indexes where tablename = 'events'`,
  );
  expect(idx.rows.map((r: Record<string, unknown>) => r.indexname)).toContain(
    "events_user_session_ts_idx",
  );
  const res = await app.request("/healthz");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
});
