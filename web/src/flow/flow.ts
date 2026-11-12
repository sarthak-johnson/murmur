/*
 * The flow board's readings and geometry: bands per phase, a layered build order inside
 * each band, the facts every card shows, and where cards, folds and links sit. Pure, so
 * the board lays out the same in tests as in a browser.
 */
import type { PartView, PhaseView, RequestView, TaskView } from "@murmur/core";
import {
  type Mark,
  type Place,
  partPhase,
  phaseName,
  placeOf,
  rounds,
  taskTitle,
} from "../session";
import { coreState, isOver, MARK, type State, WORD, workState } from "../state";
import { clock, duration } from "../story";

/** "same files" says two parts touched the same files, not that one reads the other. */
const orders = (label: string) => label !== "same files";

/** Started first comes first; parts not started go last. */
const byStart = (a: PartView, b: PartView) => {
  const x = a.span?.start;
  const y = b.span?.start;
  return x && y ? x.localeCompare(y) : x ? -1 : y ? 1 : 0;
};

/**
 * The parts in columns: a part sits one column right of everything it reads (a link to
 * another part in `parts`, except "same files"). Loops are broken by walking from each
 * part, in declaration order, to the parts that read it and dropping the link that comes
 * back: the part declared first stays first, and the same input always lays out the
 * same. Each column is ordered by start time, parts not started last.
 */
export function columns(parts: PartView[]): PartView[][] {
  const ids = new Set(parts.map((p) => p.id));
  const reads = (p: PartView) =>
    p.links.filter((l) => ids.has(l.to) && orders(l.label)).map((l) => l.to);
  const readers = new Map<string, string[]>();
  for (const p of parts)
    for (const dep of reads(p))
      readers.set(dep, [...(readers.get(dep) ?? []), p.id]);
  const dropped = new Set<string>();
  const state = new Map<string, "walking" | "done">();
  const walk = (id: string) => {
    state.set(id, "walking");
    for (const r of readers.get(id) ?? []) {
      if (state.get(r) === "walking") dropped.add(`${r}>${id}`);
      else if (!state.has(r)) walk(r);
    }
    state.set(id, "done");
  };
  for (const p of parts) if (!state.has(p.id)) walk(p.id);

  const byId = new Map(parts.map((p) => [p.id, p]));
  const col = new Map<string, number>();
  const place = (p: PartView): number => {
    const known = col.get(p.id);
    if (known !== undefined) return known;
    let c = 0;
    for (const dep of reads(p)) {
      const d = byId.get(dep);
      if (d && !dropped.has(`${p.id}>${dep}`)) c = Math.max(c, place(d) + 1);
    }
    col.set(p.id, c);
    return c;
  };
  const out: PartView[][] = [];
  for (const p of parts) {
    const c = place(p);
    for (let i = out.length; i <= c; i++) out.push([]);
    out[c]?.push(p);
  }
  // Array sort is stable: a tie keeps declaration order.
  return out.map((c) => [...c].sort(byStart));
}

export interface Band {
  id: string;
  title: string;
  phase?: PhaseView;
  parts: PartView[];
}

/**
 * One band per phase that has parts, in plan order, named as the Tasks list names it; a
 * part sits in its own phase, else its plan task's (`partPhase`); parts with no phase last.
 */
/**
 * The phase a part's card sits under: the one holding most of its plan tasks, as the board
 * and the Tasks list place them ("Conversation page" carries task 4 of Pages and tasks 6
 * and 7 of Finish Phase 3: it sits under Finish Phase 3), else core's phase for it.
 */
function cardPhase(req: RequestView, p: PartView): string | undefined {
  const count = req.phases.map(
    (ph) => ph.tasks.filter((t) => t.part === p.id).length,
  );
  const most = Math.max(0, ...count);
  const own = partPhase(req, p)?.id;
  const ix = req.phases.findIndex((ph) => ph.id === own);
  if (!most || count[ix] === most) return own;
  return req.phases[count.indexOf(most)]?.id;
}

export function bands(req: RequestView, running = !req.finished): Band[] {
  const of = new Map(req.parts.map((p) => [p.id, cardPhase(req, p)]));
  const out: Band[] = req.phases.flatMap((phase) => {
    const parts = req.parts.filter((p) => of.get(p.id) === phase.id);
    return parts.length
      ? [{ id: phase.id, title: phaseName(phase, running), phase, parts }]
      : [];
  });
  // An inferred request's helperless parts are folders its files fell in, not work.
  const other = req.parts.filter(
    (p) => !of.get(p.id) && !(req.planInferred && !p.agents.length),
  );
  if (other.length)
    out.push({ id: "(other)", title: "Other work", parts: other });
  return out;
}

const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;

/** Helpers, files and time: facts every part has, whether or not Claude described it. */
export function cardFacts(p: PartView, now: string): [string, string, string] {
  const time = p.span
    ? duration(p.span.start, p.span.end ?? now)
    : "not started";
  return [n(p.agents.length, "helper"), n(p.files.length, "file"), time];
}

/**
 * The one line a wide card has room for, so no card has an empty middle: the aim, else
 * what done means, else the latest step, else what it leads to ("hands off to Conversation
 * page"). Unset when the part has said none of these.
 */
export function cardLine(req: RequestView, p: PartView): string | undefined {
  const aim = p.aim?.aim.trim();
  if (aim) return aim;
  const done = p.aim?.doneWhen.trim();
  if (done)
    return `Done when ${done.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`;
  const step = p.steps.at(-1)?.text.trim();
  if (step) return step;
  for (const l of p.links) {
    const to = req.parts.find((o) => o.id === l.to && o !== p);
    if (to)
      return `${l.label[0]?.toUpperCase()}${l.label.slice(1)} ${to.title}`;
  }
  return undefined;
}

/** The part's plan tasks as places (session.ts `placeOf`): each one's number and title. */
export function partPlaces(req: RequestView, p: PartView): Place[] {
  return req.phases
    .flatMap((ph) => ph.tasks)
    .filter((t) => t.part === p.id)
    .flatMap((t) => placeOf(req, { task: t.id }) ?? []);
}

/**
 * A card's title: its one plan task's, as the board and the Tasks list name it; a part
 * that carries several tasks (or none) keeps its own name.
 */
export function cardTitle(req: RequestView, p: PartView): string {
  const [one, ...more] = partPlaces(req, p);
  return one && !more.length ? one.title : taskTitle(p);
}

/**
 * Which tasks the part is, numbered as the board and the Tasks list number them: "Task 4",
 * "Tasks 2-3", "Tasks 1, 4". With no plan, the part's place in the map; else its own tag.
 */
export function tagOf(req: RequestView, p: PartView): string | undefined {
  const ns = partPlaces(req, p).map((x) => x.n);
  if (!ns.length) {
    const own = req.phases.length ? undefined : placeOf(req, { part: p.id });
    return own ? `Task ${own.n}` : p.tag;
  }
  const [first] = ns;
  if (ns.length === 1) return `Task ${first}`;
  const run = ns.every((x, i) => x === (first ?? 0) + i);
  return `Tasks ${run ? `${first}-${ns.at(-1)}` : ns.join(", ")}`;
}

/** The tag, or "task" with none: what the part's Open link names. */
export const taskName = (tag: string | undefined): string => tag ?? "task";

/**
 * A part's mark: failed when a plan task of it failed, waiting while one waits on you
 * (only in a request still going), open once the request is over.
 */
/** The request's state: the one handed down (state.ts), else core's; finished is over. */
const reqOf = (req: RequestView, state?: State): State =>
  state ?? (req.finished ? "done" : coreState(req));

/** A part's state (state.ts), under its request's. */
export function partState(req: RequestView, p: PartView, state?: State): State {
  const s = reqOf(req, state);
  const has = (status: TaskView["status"]) =>
    req.phases.some((ph) =>
      ph.tasks.some((t) => t.part === p.id && t.status === status),
    );
  if (has("failed")) return "failed";
  if (has("blocked") && !isOver(s)) return "waiting";
  return workState(p.status, s);
}

export const partMark = (req: RequestView, p: PartView, state?: State): Mark =>
  MARK[partState(req, p, state)];

/** The card's state word: "Done, 2 rounds", "Running", "Left open", "Not started". */
export function stateWord(
  req: RequestView,
  p: PartView,
  long = false,
  state?: State,
): string {
  const s = partState(req, p, state);
  if (s === "done") {
    const r = p.rounds ?? 0;
    if (!r) return WORD.done;
    return long ? `Done after ${rounds(r)}` : `Done, ${n(r, "round")}`;
  }
  return WORD[s];
}

function bandState(req: RequestView, b: Band, state?: State): State {
  const status =
    b.phase?.status ??
    (b.parts.every((p) => p.status === "done")
      ? "done"
      : b.parts.some((p) => p.status === "now")
        ? "now"
        : "todo");
  return workState(status, reqOf(req, state));
}

export const bandMark = (req: RequestView, b: Band, state?: State): Mark =>
  MARK[bandState(req, b, state)];

export const bandWord = (req: RequestView, b: Band, state?: State): string =>
  WORD[bandState(req, b, state)];

/**
 * ["6 of 6 done", "10:08 to 12:47"], ["0 of 2 done", "12:50 to now"]; no span before a
 * start. A phase counts its plan tasks, as the Tasks list does; other work its parts.
 */
export function bandLine(b: Band, running: boolean): [string, string?] {
  const items: { status: string }[] = b.phase?.tasks.length
    ? b.phase.tasks
    : b.parts;
  const done = items.filter((p) => p.status === "done").length;
  const from = b.parts.flatMap((p) => p.span?.start ?? []).sort()[0];
  const last = b.parts
    .flatMap((p) => p.span?.end ?? [])
    .sort()
    .at(-1);
  const to = running || !last ? "now" : clock(last);
  const count = `${done} of ${items.length} done`;
  return from ? [count, `${clock(from)} to ${to}`] : [count];
}

/** Past this many parts, each band folds its done parts into one row. */
export const FOLD_AT = 20;

// The grid every board is laid on. Cards are one width and every card in a row is as tall
// as the row's tallest, so rows line up across columns and the gaps between them are free
// channels for links, and no row is taller than its content needs. The page measures each
// card's content; until it has, a wide card without a line is estimated shorter.
const CARD_H = 136;
/** The card's line: its 6 px gap and two 18 px lines. */
const LINE_H = 42;
const MIN_W = 156;
const MAX_W = 340;
/** From this width a card shows its line (14 px padding and a 1 px border each side). */
const WIDE_W = 290;
const GX = 32;
const BAND_GX = 48;
const GY = 24;
const HEAD = 58;
const TOP = HEAD + GY;
const FOLD_H = 40;
/** Stacked, links run in a gutter left of the cards. */
const LEFT = 18;
const BAND_GAP = 28;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CardBox extends Box {
  part: PartView;
  band: number;
  col: number;
  row: number;
}
export interface BandBox extends Box {
  band: Band;
  /** Done parts folded away. */
  folded: number;
  fold?: Box;
}
export interface LinkPath {
  /** "dependency>reader". */
  key: string;
  from: string;
  to: string;
  labels: string[];
  dash: boolean;
  d: string;
}
export interface FlowLayout {
  width: number;
  /** Cards are wide enough to show their line. */
  wide: boolean;
  height: number;
  bands: BandBox[];
  cards: CardBox[];
  links: LinkPath[];
}

/** An orthogonal path through `pts` with its corners rounded. */
export function rounded(pts: [number, number][], r = 8): string {
  const clean = pts.filter(
    (p, i) => i === 0 || p[0] !== pts[i - 1]?.[0] || p[1] !== pts[i - 1]?.[1],
  );
  let d = `M${clean[0]?.[0]},${clean[0]?.[1]}`;
  for (let i = 1; i < clean.length; i++) {
    const [x, y] = clean[i] as [number, number];
    const next = clean[i + 1];
    if (!next) {
      d += ` L${x},${y}`;
      break;
    }
    const [px, py] = clean[i - 1] as [number, number];
    const k = Math.min(
      r,
      Math.hypot(x - px, y - py) / 2,
      Math.hypot(next[0] - x, next[1] - y) / 2,
    );
    const ax = x - Math.sign(x - px) * k;
    const ay = y - Math.sign(y - py) * k;
    const bx = x + Math.sign(next[0] - x) * k;
    const by = y + Math.sign(next[1] - y) * k;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  return d;
}

/** The card an arrow key moves to: along a column, else the nearest row in the next column. */
export function neighbour(
  cards: CardBox[],
  id: string,
  key: string,
  stacked: boolean,
): string | undefined {
  const i = cards.findIndex((c) => c.part.id === id);
  const c = cards[i];
  if (!c) return undefined;
  const back = key === "ArrowUp" || key === "ArrowLeft";
  if (stacked) return cards[back ? i - 1 : i + 1]?.part.id;
  if (key === "ArrowUp" || key === "ArrowDown") {
    const row = c.row + (back ? -1 : 1);
    return cards.find((o) => o.col === c.col && o.row === row)?.part.id;
  }
  const side = cards.filter((o) => (back ? o.col < c.col : o.col > c.col));
  if (!side.length) return undefined;
  const col = back
    ? Math.max(...side.map((o) => o.col))
    : Math.min(...side.map((o) => o.col));
  return side
    .filter((o) => o.col === col)
    .reduce((best, o) =>
      Math.abs(o.row - c.row) < Math.abs(best.row - c.row) ? o : best,
    ).part.id;
}

/**
 * Where everything sits for a board `width` wide. Wide: bands side by side, a column per
 * layer, cards as wide as fit between MIN_W and MAX_W (the frame scrolls past that).
 * Stacked: bands one under another, cards one under another in build order.
 */
export function layoutFlow(
  req: RequestView,
  opts: {
    width: number;
    stacked: boolean;
    open: ReadonlySet<string>;
    /** Each card's height as measured in the page, by part id; estimated until then. */
    heights?: ReadonlyMap<string, number>;
  },
): FlowLayout {
  const { width, stacked, open, heights } = opts;
  const fold = req.parts.length > FOLD_AT;
  const shown = bands(req).map((band) => {
    const keep =
      !fold || open.has(band.id)
        ? band.parts
        : band.parts.filter((p) => partMark(req, p) !== "done");
    return {
      band,
      cols: columns(keep),
      folded: band.parts.length - keep.length,
    };
  });
  const cols = shown.reduce((s, b) => s + Math.max(1, b.cols.length), 0);
  const gaps = shown.reduce(
    (s, b, i) => s + (Math.max(1, b.cols.length) - 1) * GX + (i ? BAND_GX : 0),
    0,
  );
  const cw = stacked
    ? Math.max(MIN_W, width - LEFT)
    : Math.min(MAX_W, Math.max(MIN_W, (width - gaps) / Math.max(1, cols)));
  const wide = cw >= WIDE_W;
  const cardH = (p: PartView) =>
    heights?.get(p.id) ??
    (wide && !cardLine(req, p) ? CARD_H - LINE_H : CARD_H);
  // Wide, row r is as tall as its tallest card; stacked, each card is its own row.
  const rowH: number[] = [];
  if (!stacked)
    for (const { cols: bc } of shown)
      for (const col of bc)
        for (const [r, p] of col.entries())
          rowH[r] = Math.max(rowH[r] ?? 0, cardH(p));
  const rowY = (r: number, hs = rowH) => {
    let y = TOP;
    for (let k = 0; k < r; k++) y += (hs[k] ?? CARD_H) + GY;
    return y;
  };

  const bandBoxes: BandBox[] = [];
  const cards: CardBox[] = [];
  let x = 0;
  let y = 0;
  let gcol = 0;
  shown.forEach(({ band, cols: bc, folded }, bi) => {
    if (stacked) {
      const list = bc.flat();
      const hs = list.map(cardH);
      for (const [i, part] of list.entries())
        cards.push({
          part,
          band: bi,
          col: 0,
          row: i,
          x: LEFT,
          y: y + rowY(i, hs),
          w: cw,
          h: hs[i] ?? CARD_H,
        });
      const fy = y + rowY(list.length, hs);
      const fold = folded ? { x: LEFT, y: fy, w: cw, h: FOLD_H } : undefined;
      const h = (fold ? fy + FOLD_H : fy - GY) - y;
      bandBoxes.push({
        band,
        folded,
        x: LEFT,
        y,
        w: cw,
        h,
        ...(fold ? { fold } : {}),
      });
      y += h + BAND_GAP;
      return;
    }
    if (bi) x += BAND_GX;
    const n = Math.max(1, bc.length);
    for (const [ci, col] of bc.entries())
      for (const [ri, part] of col.entries())
        cards.push({
          part,
          band: bi,
          col: gcol + ci,
          row: ri,
          x: x + ci * (cw + GX),
          y: rowY(ri),
          w: cw,
          h: rowH[ri] ?? CARD_H,
        });
    const rows = Math.max(0, ...bc.map((c) => c.length));
    const fold = folded
      ? { x, y: rowY(bc[0]?.length ?? 0), w: cw, h: FOLD_H }
      : undefined;
    const bw = n * cw + (n - 1) * GX;
    bandBoxes.push({
      band,
      folded,
      x,
      y: 0,
      w: bw,
      h: rowY(rows) - GY,
      ...(fold ? { fold } : {}),
    });
    x += bw;
    gcol += n;
  });

  // The last band's header runs to the board's edge, so a narrow board reads as one piece.
  const contentW = stacked ? LEFT + cw : x;
  const boardW = Math.max(contentW, width);
  const last = bandBoxes.at(-1);
  if (last && !stacked) last.w = boardW - last.x;
  const maxRows = Math.max(0, ...cards.map((c) => c.row + 1));
  const bottom = Math.max(
    0,
    ...bandBoxes.map((b) => (b.fold ? b.fold.y + b.fold.h : b.y + b.h)),
  );
  const height = stacked
    ? Math.max(0, y - BAND_GAP)
    : Math.max(bottom, rowY(maxRows) - GY);

  return {
    width: boardW,
    wide,
    height,
    bands: bandBoxes,
    cards,
    links: route(
      cards,
      stacked,
      Array.from({ length: maxRows + 1 }, (_, r) => rowY(r) - GY / 2),
    ),
  };
}

/** Links between shown parts, one per pair, routed through the gaps between cards. */
function route(
  cards: CardBox[],
  stacked: boolean,
  /** The gap channels between rows, at their middles; any of them runs clear across the board. */
  channels: number[],
): LinkPath[] {
  const at = new Map(cards.map((c) => [c.part.id, c]));
  const pairs = new Map<string, LinkPath & { a: CardBox; b: CardBox }>();
  for (const reader of cards)
    for (const l of reader.part.links) {
      const dep = at.get(l.to);
      if (!dep || dep === reader) continue;
      const key = `${dep.part.id}>${reader.part.id}`;
      const back = `${reader.part.id}>${dep.part.id}`;
      const seen = pairs.get(key) ?? pairs.get(back);
      if (seen) {
        if (!seen.labels.includes(l.label)) seen.labels.push(l.label);
        seen.dash &&= !orders(l.label) || l.label === "checks";
        continue;
      }
      pairs.set(key, {
        key,
        from: dep.part.id,
        to: reader.part.id,
        labels: [l.label],
        dash: !orders(l.label) || l.label === "checks",
        d: "",
        a: dep,
        b: reader,
      });
    }
  const mid = (c: Box) => c.y + c.h / 2;
  return [...pairs.values()].map(({ a, b, ...link }) => {
    let pts: [number, number][];
    if (stacked) {
      const gx = LEFT / 2;
      pts = [
        [a.x, mid(a)],
        [gx, mid(a)],
        [gx, mid(b)],
        [b.x, mid(b)],
      ];
    } else {
      const [l, r] = a.col <= b.col ? [a, b] : [b, a];
      const xa = l.x + l.w + GX / 2;
      if (l.col === r.col) {
        pts = [
          [l.x + l.w, mid(l)],
          [xa, mid(l)],
          [xa, mid(r)],
          [r.x + r.w, mid(r)],
        ];
      } else if (r.col - l.col === 1) {
        pts = [
          [l.x + l.w, mid(l)],
          [xa, mid(l)],
          [xa, mid(r)],
          [r.x, mid(r)],
        ];
      } else {
        // Across columns between them: along the row gap nearest the halfway height.
        const half = (mid(l) + mid(r)) / 2;
        const yc = channels.reduce((best, c) =>
          Math.abs(c - half) < Math.abs(best - half) ? c : best,
        );
        const xb = r.x - GX / 2;
        pts = [
          [l.x + l.w, mid(l)],
          [xa, mid(l)],
          [xa, yc],
          [xb, yc],
          [xb, mid(r)],
          [r.x, mid(r)],
        ];
      }
    }
    return { ...link, d: rounded(pts) };
  });
}
