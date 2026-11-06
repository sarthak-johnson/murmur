import { type MurmurEvent, reduce, type SessionView } from "@murmur/core";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";

export type SessionStatus = "loading" | "live" | "reconnecting" | "error";

const byCursor = (a: MurmurEvent, b: MurmurEvent) =>
  a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Loads a session's events, follows them live and reduces them to a view. */
export function useSession(sessionId: string): {
  view: SessionView | null;
  viewAt(ts: string): SessionView | null;
  status: SessionStatus;
} {
  const [events, setEvents] = useState<MurmurEvent[] | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    setEvents(null);
    setStatus("loading");
    let dead = false;
    let all: MurmurEvent[] = [];
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;

    const merge = (incoming: MurmurEvent[]) => {
      const seen = new Map(all.map((e) => [e.id, e]));
      for (const e of incoming) seen.set(e.id, e);
      all = [...seen.values()].sort(byCursor);
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

    async function sync() {
      try {
        await fetchRest();
      } catch (e) {
        if (dead) return;
        // 401 already signed the app out through api.call.
        if (e instanceof ApiError && (e.status === 404 || e.status === 401))
          setStatus("error");
        else retry();
        return;
      }
      if (dead) return;
      delay = 1000;
      const s = api.stream(sessionId);
      es = s;
      s.addEventListener("events", (m) => {
        merge(JSON.parse((m as MessageEvent<string>).data) as MurmurEvent[]);
      });
      s.onerror = () => {
        if (es === s) retry();
      };
      setStatus("live");
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
  const viewAt = useMemo(() => {
    const cache = new Map<string, SessionView>();
    return (ts: string) => {
      if (!events) return null;
      let v = cache.get(ts);
      if (!v) {
        v = reduce(events.filter((e) => e.ts <= ts));
        cache.set(ts, v);
      }
      return v;
    };
  }, [events]);

  return { view, viewAt, status };
}
