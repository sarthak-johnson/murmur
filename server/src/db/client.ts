import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import pg from "pg";

// biome-ignore lint/suspicious/noExplicitAny: driver-agnostic query result type
export type Db = PgDatabase<any>;

const defaultMigrations = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export interface OpenedDb {
  db: Db;
  close(): Promise<void>;
}

/** pg when url is set; else PGlite at ./.data/pglite; "memory://" is in-memory PGlite. */
export async function openDb(url: string | undefined): Promise<OpenedDb> {
  const migrationsFolder = process.env.MIGRATIONS_DIR || defaultMigrations;
  if (url && url !== "memory://") {
    const pool = new pg.Pool({ connectionString: url });
    pool.on("error", (err) => console.error("pg pool error:", err));
    const db = drizzleNode(pool);
    await migrateNode(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  let dataDir = "memory://";
  if (!url) {
    dataDir = "./.data/pglite";
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);
  const db = drizzleLite(client);
  await migrateLite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
