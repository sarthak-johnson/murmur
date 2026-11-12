import type { MurmurEvent, SessionView } from "@murmur/core";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import { viewOf } from "./plan";

/**
 * "resuming": a kept session shown as last heard while it catches up (Back or Forward to it):
 * open, as it was, not a dropped line.
 */
export type SessionStatus =
  | "loading"
  | "resuming"
  | "live"
  | "reconnecting"
  | "error";

/** Coming back to a session, its fetch starts this far before the last event it has: events
 * stored meanwhile can carry an older time (a helper's, sent late). Seen ones merge by id. */
const REWIND_MS = 60 * 60_000;

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
    kept.has(sessionId) ? "resuming" : "loading",
  );

  useEffect(() => {
    const was = kept.get(sessionId);
    setEvents(was ?? null);
    setStatus(was ? "resuming" : "loading");
    let dead = false;
    let all: MurmurEvent[] = was ?? [];
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    // Whether the next fetch goes back a margin: on coming back to a kept session, and after
    // the line dropped.
    let rewind = !!was;
    // Events are on the page (kept ones, or a first page in): an empty page changes nothing.
    let shown = !!was;

    const merge = (incoming: MurmurEvent[]) => {
      const seen = new Map(all.map((e) => [e.id, e]));
      // A margin's pages are mostly events it has: nothing new, nothing to redraw.
      if (shown && incoming.every((e) => seen.has(e.id))) return;
      shown = true;
      for (const e of incoming) seen.set(e.id, e);
      all = [...seen.values()].sort(byCursor);
      keep(sessionId, all);
      setEvents(all);
    };

    const fetchRest = async () => {
      // From the newest event it has, or a margin before it; then page by page from each
      // page's own last event, so a margin of more than a page misses nothing.
      const last = all.at(-1);
      let cur: { ts?: string; id?: string } | undefined =
        rewind && last
          ? { ts: new Date(Date.parse(last.ts) - REWIND_MS).toISOString() }
          : last;
      for (;;) {
        const page = await api.events(sessionId, cur?.ts, cur?.id);
        if (dead) return;
        rewind = false;
        merge(page.events);
        const end = page.events.at(-1);
        if (!page.hasMore || !end) return;
        cur = end;
      }
    };

    const retry = () => {
      es?.close();
      es = null;
      rewind = true;
      setStatus("reconnecting");
      timer = setTimeout(sync, delay);
      delay = Math.min(delay * 2, 15000);
    };

    const fail = (e: unknown) => {
      if (dead) return;
      // 401 already signed the app out through api.call.
      if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
        // Deleted or purged: nothing of it stays to be shown, now or on a later visit.
        kept.delete(sessionId);
        all = [];
        setEvents(null);
        setStatus("error");
      } else retry();
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
  const view = useMemo(() => (events ? viewOf(events) : null), [events]);

  return { view, status, events: events ?? [] };
}
