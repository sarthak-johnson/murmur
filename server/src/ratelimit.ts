// ponytail: in-memory, one server instance; move to Postgres or a shared store before running more than one.

/**
 * Fixed-window counter per key: `limit` hits per `windowMs`, starting at a key's first hit.
 * Entries stay in window-start order (a restarted window is re-inserted at the back), so
 * expired ones are swept from the front in amortised O(1). At most `cap` keys are held;
 * when every held key is live, new keys are blocked (fail closed) until windows expire.
 */
export function fixedWindow(limit: number, windowMs: number, cap = 100_000) {
  const hits = new Map<string, { start: number; n: number }>();
  const sweep = (t: number) => {
    for (const [k, v] of hits) {
      if (t - v.start < windowMs) return;
      hits.delete(k);
    }
  };
  return {
    get size() {
      return hits.size;
    },
    blocked(key: string, now: Date) {
      sweep(now.getTime());
      const e = hits.get(key);
      return e ? e.n >= limit : hits.size >= cap;
    },
    hit(key: string, now: Date) {
      const t = now.getTime();
      sweep(t);
      const e = hits.get(key);
      if (e) e.n++;
      else if (hits.size < cap) hits.set(key, { start: t, n: 1 });
    },
    /** Gives back a hit taken in this window (count first, refund on success, so concurrent requests cannot overshoot). */
    refund(key: string, now: Date) {
      sweep(now.getTime());
      const e = hits.get(key);
      if (e && e.n > 0) e.n--;
    },
  };
}
