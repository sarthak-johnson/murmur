import { lt, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { deviceCodes, webSessions } from "./db/schema.js";

/** Deletes sessions idle past their owner's retention_days, plus expired logins. Returns sessions deleted. */
export async function runRetention(db: Db, now: Date): Promise<number> {
  const at = now.toISOString();
  return db.transaction(async (tx) => {
    const expired = sql`(select s.user_id, s.session_id from sessions s
      join users u on u.id = s.user_id
      where s.last_event_at < ${at}::timestamptz - u.retention_days * interval '1 day')`;
    await tx.execute(
      sql`delete from events where (user_id, session_id) in ${expired}`,
    );
    await tx.execute(
      sql`delete from assumption_decisions where (user_id, session_id) in ${expired}`,
    );
    const res = await tx.execute(
      sql`delete from sessions where (user_id, session_id) in ${expired} returning 1`,
    );
    await tx.delete(webSessions).where(lt(webSessions.expiresAt, now));
    await tx.delete(deviceCodes).where(lt(deviceCodes.expiresAt, now));
    return (res as unknown as { rows: unknown[] }).rows.length;
  });
}
