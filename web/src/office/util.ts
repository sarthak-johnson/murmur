// Small text helpers the overlay shares with the side panel, and canvas and list helpers.

/** "Phase 4: Portfolio reads" -> "P4 Portfolio", "Phases 6-7 News" -> "P6-7 News"; else unchanged. */
export const phaseShort = (title: string): string => {
  const m = title.match(/^Phases?\s+(\d+(?:\s*[-–]\s*\d+)?)\s*:?\s*(.*)$/i);
  // "Batch 2: Library" reads "B2 Library", like a phase.
  const numbered = /^([A-Za-z]+)\s+(\d+[a-z]?)\s*:?\s*(.*)$/.exec(title);
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

/** "40 s", "35 m", "2 h 5 m". */
export function dur(ms: number): string {
  const m = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${m % 60} m`;
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
