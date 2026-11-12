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
