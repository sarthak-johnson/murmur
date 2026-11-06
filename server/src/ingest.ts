import {
  isOwnCommand,
  type MurmurEvent,
  MurmurEventSchema,
} from "@murmur/core";
import { sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Deps } from "./app.js";
import { type AppEnv, requireIngest } from "./auth.js";
import { events, sessions } from "./db/schema.js";
import { UUID } from "./sessions.js";
import { bus } from "./stream.js";

const MAX_BYTES = 5_000_000;
const MAX_EVENTS = 500;
const TITLE_CHARS = 80;

/** Up to 80 code points unchanged; longer prompts cut at the last word boundary within 79, plus an ellipsis. */
export function makeTitle(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= TITLE_CHARS) return text;
  const head = chars.slice(0, TITLE_CHARS - 1);
  // Cut at a word boundary only if the next char is not mid-word already.
  const rest = chars[TITLE_CHARS - 1] as string;
  let cut = head.join("");
  if (!/\s/.test(rest)) {
    const at = cut.search(/\s\S*$/);
    if (at > 0) cut = cut.slice(0, at);
  }
  return `${cut.trimEnd()}…`;
}

const tooLarge = (c: Context) => c.json({ error: "too_large" }, 413);

/**
 * Postgres text and jsonb reject NUL and lone UTF-16 surrogates (the plugin's scrubber can cut
 * between a pair), so clean every string and key rather than fail the batch: NUL is dropped and
 * a lone surrogate becomes U+FFFD.
 */
const clean = (s: string) => s.replaceAll("\0", "").toWellFormed();
const reviveClean = (_key: string, v: unknown): unknown =>
  typeof v === "string"
    ? clean(v)
    : v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), x]))
      : v;

function sessionRow(
  userId: string,
  machineId: string,
  sessionId: string,
  list: MurmurEvent[],
) {
  const sorted = list.toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const first = sorted[0] as MurmurEvent;
  const last = sorted.at(-1) as MurmurEvent;
  const prompt = sorted.find(
    (e) =>
      e.hook === "UserPromptSubmit" &&
      typeof e.payload.prompt === "string" &&
      !isOwnCommand(e.payload.prompt),
  )?.payload.prompt as string | undefined;
  const title = prompt?.trim() ? makeTitle(prompt.trim()) : null;
  return {
    userId,
    sessionId,
    machineId,
    cwd: first.cwd,
    title,
    startedAt: new Date(first.ts),
    lastEventAt: new Date(last.ts),
    ended: list.some((e) => e.hook === "SessionEnd"),
  };
}

/**
 * The plugin keeps any batch answered with a non-2xx and retries it, so 2xx means stored.
 * Replays are safe: events are keyed by (user, id) and only newly stored ones are published.
 */
export function ingestRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { db } = deps;
  app.post(
    "/api/ingest",
    requireIngest(deps),
    bodyLimit({ maxSize: MAX_BYTES, onError: tooLarge }),
    async (c) => {
      const { userId, machineId } = c.get("ingest");
      // bodyLimit trusts Content-Length when present; this checks what was actually read.
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return tooLarge(c);
      let list: unknown;
      try {
        list = JSON.parse(new TextDecoder().decode(buf), reviveClean)?.events;
      } catch {}
      if (!Array.isArray(list)) return c.json({ error: "bad_request" }, 400);
      if (list.length > MAX_EVENTS) return c.json({ error: "too_many" }, 413);

      const bySession = new Map<string, MurmurEvent[]>();
      for (const [index, raw] of list.entries()) {
        const r = MurmurEventSchema.safeParse(raw);
        if (
          !r.success ||
          !UUID.test(r.data.id) ||
          Number.isNaN(Date.parse(r.data.ts))
        )
          return c.json({ error: "invalid", index }, 400);
        // The token decides the machine; ids and times are stored the way Postgres returns them.
        const e: MurmurEvent = {
          ...r.data,
          id: r.data.id.toLowerCase(),
          machineId,
          ts: new Date(r.data.ts).toISOString(),
        };
        const group = bySession.get(e.sessionId);
        if (group) group.push(e);
        else bySession.set(e.sessionId, [e]);
      }
      if (!bySession.size) return c.json({ accepted: 0 });

      const batch = [...bySession.values()].flat();
      const { stored, cwds } = await db.transaction(async (tx) => {
        const stored = await tx
          .insert(events)
          .values(
            batch.map((e) => ({
              userId,
              id: e.id,
              sessionId: e.sessionId,
              ts: new Date(e.ts),
              hook: e.hook,
              payload: e.payload,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: events.id });
        const cwds = await tx
          .insert(sessions)
          .values(
            [...bySession].map(([sid, list]) =>
              sessionRow(userId, machineId, sid, list),
            ),
          )
          .onConflictDoUpdate({
            target: [sessions.userId, sessions.sessionId],
            set: {
              cwd: sql`case when excluded.started_at < ${sessions.startedAt} then excluded.cwd else ${sessions.cwd} end`,
              startedAt: sql`least(${sessions.startedAt}, excluded.started_at)`,
              lastEventAt: sql`greatest(${sessions.lastEventAt}, excluded.last_event_at)`,
              title: sql`coalesce(${sessions.title}, excluded.title)`,
              ended: sql`${sessions.ended} or excluded.ended`,
            },
          })
          .returning({ sessionId: sessions.sessionId, cwd: sessions.cwd });
        return { stored, cwds };
      });

      // Published with the session's cwd, the same shape GET /events returns.
      const fresh = new Set(stored.map((r) => r.id));
      const cwdOf = new Map(cwds.map((r) => [r.sessionId, r.cwd]));
      for (const [sid, list] of bySession) {
        const cwd = cwdOf.get(sid) as string;
        const out = list
          .filter((e) => fresh.delete(e.id))
          .map((e) => ({ ...e, cwd }));
        if (out.length) bus.publish(userId, sid, out);
      }
      return c.json({ accepted: stored.length });
    },
  );
}
