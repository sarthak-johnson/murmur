// Small text helpers the overlay shares with the side panel, and canvas and list helpers.

/** "Phase 4: Portfolio reads" -> "P4 Portfolio", "Phases 6-7 News" -> "P6-7 News"; else unchanged. */
export const phaseShort = (title: string): string => {
  const m = title.match(/^Phases?\s+(\d+(?:\s*[-–]\s*\d+)?)\s*:?\s*(.*)$/i);
  // "Batch 2: Library" reads "B2 Library", like a phase.
  const numbered =
    /^(Batch|Round|Step|Stage|Wave|Part|Milestone|Sprint)\s+(\d+[a-z]?)\s*:?\s*(.*)$/i.exec(
      title,
    );
  if (!m && numbered) {
    const rest = (numbered[3]?.split(/[\s/,]+/)[0] ?? "").replace(/:$/, "");
    return `${(numbered[1] ?? "").charAt(0).toUpperCase()}${numbered[2]}${rest ? ` ${rest}` : ""}`;
  }
  if (!m) return title;
  const rest = (m[2]?.split(/[\s/,]+/)[0] ?? "").replace(/:$/, "");
  return `P${(m[1] ?? "").replace(/\s/g, "")}${rest ? ` ${rest}` : ""}`;
};

const ENTITY: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
/** Escape text for innerHTML. */
export const esc = (x: unknown): string =>
  String(x ?? "").replace(/[&<>"]/g, (c) => ENTITY[c] ?? c);

/** "14:05", 24-hour, local time. */
export const clockOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

/** "40 s", "7 m", "3 h 07 m": the app's own form (story.ts `duration`), minutes floored. */
export function dur(ms: number): string {
  if (ms < 60000) return `${Math.max(1, Math.floor(ms / 1000))} s`;
  const m = Math.floor(ms / 60000);
  return m < 60
    ? `${m} m`
    : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

/** Pick from a non-empty list by a whole number, wrapping round. */
export function pick<V>(list: readonly V[], i: number): V {
  const v = list[i % list.length];
  if (v === undefined)
    throw new Error("Murmur office: pick from an empty list");
  return v;
}

/** A canvas of w x h and its 2d context. */
export function canvas2d(
  w: number,
  h: number,
): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: context2d(c) };
}

/** A canvas's 2d context; every browser the page supports has one. */
export function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("Murmur office: no 2d canvas context");
  return g;
}

/**
 * Marks on a strip `width` px wide at `at` (sorted, px), moved apart to at least `gap` px:
 * each crowd is spread evenly about its own middle, kept inside the strip, so close marks
 * stay where they happened as near as they can.
 */
export function spread(at: number[], width: number, gap: number): number[] {
  if (at.length * gap > width) gap = width / Math.max(1, at.length);
  // Crowds: runs of marks closer than the gap, merged until no two crowds overlap.
  let crowds = at.map((x, i) => ({ from: i, n: 1, mid: x }));
  const lay = (c: { n: number; mid: number }) => {
    const span = (c.n - 1) * gap;
    const start = Math.min(Math.max(c.mid - span / 2, 0), width - span);
    return [start, start + span];
  };
  for (let merged = true; merged; ) {
    merged = false;
    const out: typeof crowds = [];
    for (const c of crowds) {
      const last = out.at(-1);
      if (last && (lay(last)[1] ?? 0) + gap > (lay(c)[0] ?? 0)) {
        const n = last.n + c.n;
        last.mid = (last.mid * last.n + c.mid * c.n) / n;
        last.n = n;
        merged = true;
      } else out.push({ ...c });
    }
    crowds = out;
  }
  return crowds.flatMap((c) => {
    const [start = 0] = lay(c);
    return Array.from({ length: c.n }, (_, k) => start + k * gap);
  });
}

/** The replay strip's axis: time as worked, a quiet stretch over `gap` counted as `gap`. */
export interface TimeAxis {
  /** The strip's length, in ms of worked time. */
  total: number;
  /** A moment's place on the strip, 0 to total. */
  at(t: number): number;
  /** The moment at a place on the strip. */
  time(x: number): number;
}

/**
 * The strip spends its width on what happened: between two events (sorted ms) a pause of
 * more than `gap` takes only `gap`, so a burst of requests after a night's quiet is not
 * crowded into a sliver. Within a pause, places map evenly onto its real time.
 */
export function timeAxis(
  ms: readonly number[],
  start: number,
  end: number,
  gap: number,
): TimeAxis {
  const pts = [start, ...ms.filter((t) => t > start && t < end), end];
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(
      (cum[i - 1] ?? 0) + Math.min(gap, (pts[i] ?? 0) - (pts[i - 1] ?? 0)),
    );
  const total = Math.max(1, cum.at(-1) ?? 0);
  /** The last index whose value in `xs` is at or under v. */
  const below = (xs: readonly number[], v: number) => {
    let lo = 0;
    let hi = xs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((xs[mid] ?? 0) <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const seg = (i: number) => {
    const real = (pts[i + 1] ?? 0) - (pts[i] ?? 0);
    return { real, len: Math.min(gap, real) };
  };
  return {
    total,
    at(t) {
      if (t <= start) return 0;
      if (t >= end) return total;
      const i = below(pts, t);
      const { real, len } = seg(i);
      return (cum[i] ?? 0) + (real ? ((t - (pts[i] ?? 0)) / real) * len : 0);
    },
    time(x) {
      if (x <= 0) return start;
      if (x >= total) return end;
      const i = below(cum, x);
      const { real, len } = seg(i);
      return (pts[i] ?? 0) + (len ? ((x - (cum[i] ?? 0)) / len) * real : 0);
    },
  };
}
