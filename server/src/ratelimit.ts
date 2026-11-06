// ponytail: in-memory, one server instance; move to Postgres or a shared store before running more than one.

const SWEEP_AT = 10_000;

/** Fixed-window counter per key: `limit` hits per `windowMs`, starting at a key's first hit. */
export function fixedWindow(limit: number, windowMs: number) {
  const hits = new Map<string, { start: number; n: number }>();
  const live = (key: string, t: number) => {
    const e = hits.get(key);
    return e && t - e.start < windowMs ? e : undefined;
  };
  return {
    blocked: (key: string, now: Date) =>
      (live(key, now.getTime())?.n ?? 0) >= limit,
    hit(key: string, now: Date) {
      const t = now.getTime();
      const e = live(key, t);
      if (e) {
        e.n++;
        return;
      }
      if (hits.size >= SWEEP_AT)
        for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      hits.set(key, { start: t, n: 1 });
    },
    /** Gives back a hit taken in this window (count first, refund on success, so concurrent requests cannot overshoot). */
    refund(key: string, now: Date) {
      const e = live(key, now.getTime());
      if (e && e.n > 0) e.n--;
    },
  };
}
