// ponytail: in-memory, one server instance; move to Postgres or a shared store before running more than one.

interface Entry {
  key: string;
  start: number;
  n: number;
}

/**
 * Fixed-window counter per key: `limit` hits per `windowMs`, starting at a key's first hit.
 * Entries also sit in a queue in window-start order, so expired ones are swept from the
 * front in amortised O(1). (Not by iterating the Map: V8 walks deleted slots from the
 * front until it rehashes, which makes front sweeps O(n).) At most `cap` keys are held;
 * when every held key is live, new keys are blocked (fail closed) until windows expire.
 */
export function fixedWindow(limit: number, windowMs: number, cap = 100_000) {
  const byKey = new Map<string, Entry>();
  let queue: Entry[] = [];
  let head = 0;
  const sweep = (t: number) => {
    while (head < queue.length) {
      const e = queue[head] as Entry;
      if (t - e.start < windowMs) break;
      byKey.delete(e.key);
      head++;
    }
    if (head > 1024 && head * 2 > queue.length) {
      queue = queue.slice(head);
      head = 0;
    }
  };
  return {
    get size() {
      return byKey.size;
    },
    blocked(key: string, now: Date) {
      sweep(now.getTime());
      const e = byKey.get(key);
      return e ? e.n >= limit : byKey.size >= cap;
    },
    hit(key: string, now: Date) {
      const t = now.getTime();
      sweep(t);
      const e = byKey.get(key);
      if (e) e.n++;
      else if (byKey.size < cap) {
        const fresh = { key, start: t, n: 1 };
        byKey.set(key, fresh);
        queue.push(fresh);
      }
    },
    /** Gives back a hit taken in this window (count first, refund on success, so concurrent requests cannot overshoot). */
    refund(key: string, now: Date) {
      sweep(now.getTime());
      const e = byKey.get(key);
      if (e && e.n > 0) e.n--;
    },
  };
}
