import { type MurmurEvent, reduce, type SessionView } from "@murmur/core";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";

export type SessionStatus = "loading" | "live" | "reconnecting" | "error";

const byCursor = (a: MurmurEvent, b: MurmurEvent) =>
  a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The last few sessions' events, so going Back or Forward to one shows it at once (as last
 * heard, catching up from there) instead of loading it again from its first page.
 */
const kept = new Map<string, MurmurEvent[]>();
const KEEP = 4;
/** Forget every kept session (signing out, and tests). */
export const forgetSessions = () => kept.clear();
function keep(sessionId: string, events: MurmurEvent[]) {
  kept.delete(sessionId);
  kept.set(sessionId, events);
  for (const k of kept.keys()) if (kept.size > KEEP) kept.delete(k);
}

/** Loads a session's events, follows them live and reduces them to a view. */
export function useSession(sessionId: string): {
  view: SessionView | null;
  status: SessionStatus;
  events: MurmurEvent[];
} {
  const [events, setEvents] = useState<MurmurEvent[] | null>(
    () => kept.get(sessionId) ?? null,
  );
  const [status, setStatus] = useState<SessionStatus>(() =>
    kept.has(sessionId) ? "reconnecting" : "loading",
  );

  useEffect(() => {
    const was = kept.get(sessionId);
    setEvents(was ?? null);
    setStatus(was ? "reconnecting" : "loading");
    let dead = false;
    let all: MurmurEvent[] = was ?? [];
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;

    const merge = (incoming: MurmurEvent[]) => {
      const seen = new Map(all.map((e) => [e.id, e]));
      for (const e of incoming) seen.set(e.id, e);
      all = [...seen.values()].sort(byCursor);
      keep(sessionId, all);
      setEvents(all);
    };

    const fetchRest = async () => {
      for (;;) {
        const last = all.at(-1);
        const page = await api.events(sessionId, last?.ts, last?.id);
        if (dead) return;
        merge(page.events);
        if (!page.hasMore || page.events.length === 0) return;
      }
    };

    const retry = () => {
      es?.close();
      es = null;
      setStatus("reconnecting");
      timer = setTimeout(sync, delay);
      delay = Math.min(delay * 2, 15000);
    };

    const fail = (e: unknown) => {
      if (dead) return;
      // 401 already signed the app out through api.call.
      if (e instanceof ApiError && (e.status === 404 || e.status === 401))
        setStatus("error");
      else retry();
    };

    async function sync() {
      try {
        await fetchRest();
      } catch (e) {
        return fail(e);
      }
      if (dead) return;
      const s = api.stream(sessionId);
      es = s;
      s.addEventListener("events", (m) => {
        if (es !== s) return;
        merge(JSON.parse((m as MessageEvent<string>).data) as MurmurEvent[]);
      });
      // The server sends `ready` once it is subscribed; anything stored between
      // our last fetch and that point is picked up by one more fetch here.
      s.addEventListener("ready", async () => {
        if (es !== s) return;
        try {
          await fetchRest();
        } catch (e) {
          if (dead || es !== s) return;
          return fail(e);
        }
        if (dead || es !== s) return;
        delay = 1000;
        setStatus("live");
      });
      s.onerror = () => {
        if (es === s) retry();
      };
    }

    sync();
    return () => {
      dead = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [sessionId]);

  // ponytail: full recompute per batch; make reduce incremental if sessions pass ~20k events
  const view = useMemo(() => (events ? reduce(events) : null), [events]);

  return { view, status, events: events ?? [] };
}
