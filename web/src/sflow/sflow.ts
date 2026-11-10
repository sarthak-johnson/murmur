/*
 * The session flow's layout: one column per storyline (thread), one row per request in
 * time order, so time runs down and each request sits in its thread's column. Links for
 * `follows` route in the gaps between columns and rows, never across a card. Pure: the
 * board draws what this returns.
 */
import type { RequestView, SessionView, Thread } from "@murmur/core";
import { gap } from "../live/Journey";
import { dayLabel } from "../live/Rail";
import { requestShort } from "../session";
import { clock } from "../story";

/** The time gutter on the left. */
export const GUTTER = 88;
/** The corridor between two columns, where links run down. */
export const GAP = 40;
/** Room right of the last column for a link that runs down beside it. */
const PAD_R = 28;
const PAD_T = 12;
const PAD_B = 16;
/** The channel between two rows, where links run across. */
const ROW_GAP = 16;
/** A long pause's band between two rows. */
const PAUSE_H = 44;
/** A card's height: number and short, one line of outcome, the facts. */
export const CARD_H = 100;
/** A card with no outcome to say. */
export const CARD_H_BARE = 76;
const MIN_COL = 252;
const MAX_COL = 560;

const byStart = (view: SessionView) =>
  new Map(view.requests.map((r, i) => [r.id, i]));

/** A thread made by Murmur from requests: their span and the last one's state. */
function grouped(
  view: SessionView,
  id: string,
  title: string,
  ids: string[],
): Thread {
  const rs = view.requests.filter((r) => ids.includes(r.id));
  const last = rs.at(-1);
  return {
    id,
    title,
    requests: rs.map((r) => r.id),
    state: last?.state ?? "done",
    startedAt: rs[0]?.startedAt ?? view.startedAt,
    lastAt: last?.startedAt ?? view.lastEventAt,
    inferred: true,
  };
}

/**
 * The session's storylines: core's `threads`; a view built before it had them gets one
 * per journey chapter (as core infers them), else one for the whole session.
 */
export function threadsOf(view: SessionView): Thread[] {
  if (view.threads?.length) return view.threads;
  const chapters = view.journey?.chapters ?? [];
  if (!chapters.length)
    return [
      grouped(
        view,
        "all",
        view.title,
        view.requests.map((r) => r.id),
      ),
    ];
  const byId = new Map(view.requests.map((r) => [r.id, r]));
  return chapters.map((c, i) => {
    const first = byId.get(c.requestIds[0] ?? "");
    const title = c.title || (first ? requestShort(first) : `Chapter ${i + 1}`);
    return grouped(view, `chapter-${i + 1}`, title, c.requestIds);
  });
}

/**
 * Each request's thread, by id. A thread naming a request the view lacks skips it; a
 * request no thread names joins a last "Other requests" one.
 */
export function placed(view: SessionView, threads: Thread[]) {
  const at = byStart(view);
  const of = new Map<string, string>();
  const shown: Thread[] = [];
  for (const t of threads) {
    const ids = t.requests.filter((id) => at.has(id) && !of.has(id));
    if (!ids.length) continue;
    for (const id of ids) of.set(id, t.id);
    shown.push({ ...t, requests: ids });
  }
  const rest = view.requests.filter((r) => !of.has(r.id)).map((r) => r.id);
  if (rest.length) {
    const other = grouped(view, "other", "Other requests", rest);
    for (const id of rest) of.set(id, other.id);
    shown.push(other);
  }
  // In order of their first request; each thread's requests in time order.
  const first = (t: Thread) =>
    Math.min(...t.requests.map((id) => at.get(id) ?? 0));
  shown.sort((a, b) => first(a) - first(b));
  for (const t of shown)
    t.requests.sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  return { threads: shown, of };
}

/**
 * The `follows` links worth drawing: those that cross threads or skip requests in their
 * own thread. Picking up from the one just before it in its thread is the lane line.
 */
export function drawnFollows(
  view: SessionView,
  threads: Thread[],
): { from: string; to: string }[] {
  const { threads: shown, of } = placed(view, threads);
  const lists = new Map(shown.map((t) => [t.id, t.requests]));
  const at = byStart(view);
  return view.requests.flatMap((r) => {
    const f = r.follows;
    if (!f || !at.has(f) || (at.get(f) ?? 0) >= (at.get(r.id) ?? 0)) return [];
    const mine = lists.get(of.get(r.id) ?? "") ?? [];
    const before = mine[mine.indexOf(r.id) - 1];
    return of.get(f) !== of.get(r.id) || before !== f
      ? [{ from: f, to: r.id }]
      : [];
  });
}

/** A request's `follows` chain: what it picks up from, back to the start, and all that picks up from it. */
export function chainOf(view: SessionView, id: string): Set<string> {
  const byId = new Map(view.requests.map((r) => [r.id, r]));
  const out = new Set([id]);
  let up = byId.get(id)?.follows;
  while (up && byId.has(up) && !out.has(up)) {
    out.add(up);
    up = byId.get(up)?.follows;
  }
  const down = new Set([id]);
  for (const r of view.requests)
    if (r.follows && down.has(r.follows)) down.add(r.id);
  for (const d of down) out.add(d);
  return out;
}

type Pt = [number, number];

/** A polyline with its corners rounded. */
function rounded(pts: Pt[], r = 8): string {
  const [first, ...rest] = pts;
  if (!first) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i] as Pt;
    const a = (i === 0 ? first : rest[i - 1]) as Pt;
    const b = rest[i + 1];
    if (!b) {
      d += ` L${p[0]} ${p[1]}`;
      break;
    }
    const lin = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const lout = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(r, lin / 2, lout / 2);
    const s: Pt = [
      p[0] - ((p[0] - a[0]) / lin) * k,
      p[1] - ((p[1] - a[1]) / lin) * k,
    ];
    const e: Pt = [
      p[0] + ((b[0] - p[0]) / lout) * k,
      p[1] + ((b[1] - p[1]) / lout) * k,
    ];
    d += ` L${s[0]} ${s[1]} Q${p[0]} ${p[1]} ${e[0]} ${e[1]}`;
  }
  return d;
}

/** Drops repeated points and the middle of three in a line. */
function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const a = out.at(-1);
    if (a && a[0] === p[0] && a[1] === p[1]) continue;
    const b = out.at(-2);
    if (
      a &&
      b &&
      ((b[0] === a[0] && a[0] === p[0]) || (b[1] === a[1] && a[1] === p[1]))
    )
      out.pop();
    out.push(p);
  }
  return out;
}

export interface SFCard {
  req: RequestView;
  /** Its number in the session, from 1. */
  n: number;
  thread: string;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SFLayout {
  cols: { thread: Thread; x: number; w: number }[];
  cards: SFCard[];
  /** A thread's line from one of its requests to the next. */
  lanes: { key: string; thread: string; d: string }[];
  links: {
    key: string;
    from: string;
    to: string;
    pts: Pt[];
    d: string;
    /** The arrowhead at the later card. */
    head: string;
  }[];
  pauses: { after: string; y: number; text: string }[];
  /** At each row: its time, and its day where the day changes. */
  times: { id: string; y: number; time: string; day?: string }[];
  width: number;
  height: number;
}

export function layoutSessionFlow(
  view: SessionView,
  threads: Thread[],
  opts: { width: number },
): SFLayout {
  const { threads: shown, of } = placed(view, threads);
  const n = Math.max(1, shown.length);
  const room = (opts.width || 1000) - GUTTER - PAD_R - (n - 1) * GAP;
  const w = Math.max(MIN_COL, Math.min(MAX_COL, Math.floor(room / n)));
  const cols = shown.map((thread, i) => ({
    thread,
    x: GUTTER + i * (w + GAP),
    w,
  }));
  const colOf = new Map(shown.map((t, i) => [t.id, i]));
  const pauses = (view.journey?.pauses ?? []).filter((p) => !p.inside);

  const cards: SFCard[] = [];
  const times: SFLayout["times"] = [];
  const out: SFLayout["pauses"] = [];
  let y = PAD_T;
  let lastDay = "";
  view.requests.forEach((req, i) => {
    const col = colOf.get(of.get(req.id) ?? "") ?? 0;
    const h = req.outcome ? CARD_H : CARD_H_BARE;
    cards.push({
      req,
      n: i + 1,
      thread: of.get(req.id) ?? "",
      col,
      x: cols[col]?.x ?? GUTTER,
      y,
      w,
      h,
    });
    const day = dayLabel(req.startedAt);
    times.push({
      id: req.id,
      y,
      time: clock(req.startedAt),
      ...(day !== lastDay ? { day } : {}),
    });
    lastDay = day;
    y += h + ROW_GAP;
    const p = pauses.find((q) => q.after === req.id);
    if (p && i < view.requests.length - 1) {
      out.push({
        after: req.id,
        y: y - ROW_GAP + (ROW_GAP + PAUSE_H) / 2,
        text: `${gap(p.from, p.to)} away`,
      });
      y += PAUSE_H;
    }
  });
  const byId = new Map(cards.map((c) => [c.req.id, c]));

  const lanes = shown.flatMap((t) =>
    t.requests.slice(1).flatMap((id, k) => {
      const a = byId.get(t.requests[k] ?? "");
      const b = byId.get(id);
      if (!a || !b) return [];
      const cx = a.x + a.w / 2;
      return [
        {
          key: `${a.req.id}>${b.req.id}`,
          thread: t.id,
          d: `M${cx} ${a.y + a.h} V${b.y}`,
        },
      ];
    }),
  );

  const links = drawnFollows(view, threads).flatMap(({ from, to }, k) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) return [];
    // Links sharing a corridor or channel sit a few pixels apart.
    const off = ((k % 3) - 1) * 5;
    const ya = a.y + a.h / 2 + off;
    const yb = b.y + b.h / 2 + off;
    const yc = b.y - ROW_GAP / 2 + Math.sign(off) * 3;
    let pts: Pt[];
    let into: number;
    let dir: 1 | -1;
    if (a.col === b.col) {
      const x = a.x + a.w + GAP / 2 + off;
      into = b.x + b.w;
      dir = -1;
      pts = [
        [a.x + a.w, ya],
        [x, ya],
        [x, yb],
        [into, yb],
      ];
    } else {
      const right = a.col < b.col;
      const x1 = right ? a.x + a.w + GAP / 2 + off : a.x - GAP / 2 + off;
      const x2 = right ? b.x - GAP / 2 + off : b.x + b.w + GAP / 2 + off;
      into = right ? b.x : b.x + b.w;
      dir = right ? 1 : -1;
      pts = [
        [right ? a.x + a.w : a.x, ya],
        [x1, ya],
        [x1, yc],
        [x2, yc],
        [x2, yb],
        [into, yb],
      ];
    }
    pts = tidy(pts);
    const head = `M${into - dir * 7} ${yb - 4.5} L${into} ${yb} L${into - dir * 7} ${yb + 4.5}`;
    return [{ key: `${from}>${to}`, from, to, pts, d: rounded(pts), head }];
  });

  return {
    cols,
    cards,
    lanes,
    links,
    pauses: out,
    times,
    width: GUTTER + n * w + (n - 1) * GAP + PAD_R,
    height: y - ROW_GAP + PAD_B,
  };
}
