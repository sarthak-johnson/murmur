import { isIPv6 } from "node:net";

/**
 * The rate-limit bucket for a client address: IPv4 as is, IPv6 by its /64 (one home or
 * host usually gets a whole /64, so per-address keys would be free to rotate).
 */
export function ipBucket(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4) return v4;
  const addr = ip.split("%")[0] ?? "";
  if (!isIPv6(addr)) return ip;
  const [head = "", tail] = addr.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill =
    tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
  const groups = [...h, ...fill, ...t].map((g) => g.replace(/^0+(?=.)/, ""));
  return `${groups.slice(0, 4).join(":")}::/64`;
}

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
