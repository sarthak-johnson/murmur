import { lt, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { deviceCodes, webSessions } from "./db/schema.js";

/**
 * Deletes sessions idle past their owner's retention_days, plus expired logins. Returns
 * sessions deleted. Sessions go first and their events and decisions with them in one
 * statement, so an ingest landing meanwhile can never leave a session without its events.
 */
export async function runRetention(db: Db, now: Date): Promise<number> {
  const at = now.toISOString();
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`with gone as (
        delete from sessions s using users u
        where u.id = s.user_id
          and s.last_event_at < ${at}::timestamptz - u.retention_days * interval '1 day'
        returning s.user_id, s.session_id
      ), e as (
        delete from events where (user_id, session_id) in (select * from gone)
      ), d as (
        delete from assumption_decisions where (user_id, session_id) in (select * from gone)
      )
      select 1 from gone`);
    await tx.delete(webSessions).where(lt(webSessions.expiresAt, now));
    await tx.delete(deviceCodes).where(lt(deviceCodes.expiresAt, now));
    return (res as unknown as { rows: unknown[] }).rows.length;
  });
}
