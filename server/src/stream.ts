import type { MurmurEvent } from "@murmur/core";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Deps } from "./app.js";
import type { AppEnv } from "./auth.js";
import { notFound, ownSession } from "./sessions.js";

type Listener = (events: MurmurEvent[]) => void;
const listeners = new Map<string, Set<Listener>>();

// ponytail: in-process bus, one server instance; switch to Postgres LISTEN/NOTIFY before running more than one.
export const bus = {
  publish(userId: string, sessionId: string, events: MurmurEvent[]): void {
    for (const fn of listeners.get(`${userId}:${sessionId}`) ?? []) fn(events);
  },
  subscribe(userId: string, sessionId: string, fn: Listener): () => void {
    const key = `${userId}:${sessionId}`;
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size && listeners.get(key) === set) listeners.delete(key);
    };
  },
};

export function streamRoutes(app: Hono<AppEnv>, { db, config }: Deps) {
  const pingMs = config.ssePingMs ?? 20_000;

  // Newly stored events for one session, as `event: events` with a JSON array; `: ping` keeps proxies from closing it.
  app.get("/api/sessions/:id/stream", async (c) => {
    const userId = c.get("user").id;
    const id = c.req.param("id");
    if (!(await ownSession(db, userId, id))) return notFound(c);
    return streamSSE(
      c,
      (stream) =>
        new Promise<void>((done) => {
          const off = bus.subscribe(userId, id, (events) => {
            void stream.writeSSE({
              event: "events",
              data: JSON.stringify(events),
            });
          });
          const ping = setInterval(
            () => void stream.write(": ping\n\n"),
            pingMs,
          );
          stream.onAbort(() => {
            clearInterval(ping);
            off();
            done();
          });
        }),
    );
  });
}
