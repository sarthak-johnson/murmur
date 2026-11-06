import type { PartView, RequestView } from "@murmur/core";
import type { JSX, KeyboardEvent } from "react";
import {
  CHIP_GAP,
  CHIP_H,
  chipCount,
  layoutMap,
  linkFrame,
  MAX_CHIPS,
  mapSize,
  type NodeBox,
  RING_CHIP_BOTTOM,
  RING_SIZE,
} from "./layout";

const DIM = 0.35;
const CHIP_W = 148;
const MORE_W = 64;
const EMPTY = "The map appears when Claude describes the parts of this work.";

// ponytail: text width is estimated per character class (no layout engine in
// tests); measure with canvas measureText if truncation looks off in real fonts.
const charW = (c: string) =>
  /[A-Z MWmw@%]/.test(c) && c !== " "
    ? 0.68
    : /[ il.,:;'|!()[\]]/.test(c)
      ? 0.3
      : 0.52;
export const textWidth = (text: string, font: number) =>
  [...text].reduce((w, c) => w + charW(c) * font, 0);

/**
 * Fits `text` in `px`. A path (slashes, no spaces) drops leading folders
 * ("…/style/shared"); text ends at a word or a dash when one ends in the back half.
 */
function truncate(text: string, px: number, font: number): string {
  if (textWidth(text, font) <= px) return text;
  if (text.includes("/") && !text.includes(" ")) {
    let tail = text;
    while (tail.includes("/") && textWidth(`…/${tail}`, font) > px)
      tail = tail.slice(tail.indexOf("/") + 1);
    return cutAtWord(`…/${tail}`, px, font);
  }
  return cutAtWord(text, px, font);
}

function cutAtWord(text: string, px: number, font: number): string {
  if (textWidth(text, font) <= px) return text;
  let out = text;
  while (out && textWidth(`${out}…`, font) > px) out = out.slice(0, -1);
  const whole = /[\s-]/.test(text.charAt(out.length));
  const word = Math.max(out.lastIndexOf(" "), out.lastIndexOf("-"));
  if (!whole && word > out.length / 2) out = out.slice(0, word);
  return `${out.trimEnd().replace(/[,;:-]$/, "")}…`;
}

function stateOf(p: PartView): "now" | "done" | "todo" | "stuck" {
  return p.failures >= 3 ? "stuck" : p.status;
}

const WORDS = {
  now: "in progress",
  done: "done",
  todo: "not started",
  stuck: "stuck",
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const rectOf = (b: NodeBox): Rect => ({
  x: b.x - b.w / 2,
  y: b.y - b.h / 2,
  w: b.w,
  h: b.h,
});

type Side = "below" | "right" | "left" | "above";

const PITCH = CHIP_H + CHIP_GAP;
const stackH = (n: number) => n * PITCH - CHIP_GAP;

interface ChipSpot {
  side: Side;
  /** Top-left of the chip next to the node; later chips stack away from it. */
  x: number;
  y: number;
}

/** Rect covered by `n` chips placed at `spot`. */
function stackRect(spot: ChipSpot, n: number): Rect {
  const h = stackH(n);
  const y = spot.side === "above" ? spot.y + CHIP_H - h : spot.y;
  return { x: spot.x, y, w: CHIP_W, h };
}

/**
 * Where a part's chips go: below, right, left or above, the first side where a
 * stack of `fit` chips is inside the canvas and clear of `others`, else the
 * first side inside, else below. Passing a fixed `fit` keeps the side and the
 * first chip still as agents come and go.
 */
function chipSpot(
  box: NodeBox,
  fit: number,
  others: Rect[],
  width: number,
  bottom: number,
): ChipSpot {
  const r = rectOf(box);
  const below = {
    side: "below" as const,
    x: box.x - CHIP_W / 2,
    y: r.y + r.h + 8,
  };
  const spots: ChipSpot[] = [
    below,
    { side: "right", x: r.x + r.w + 8, y: r.y },
    { side: "left", x: r.x - 8 - CHIP_W, y: r.y },
    { side: "above", x: box.x - CHIP_W / 2, y: r.y - 18 - CHIP_H },
  ];
  const inside = spots.filter((s) => {
    const k = stackRect(s, fit);
    return k.x >= 0 && k.y >= 0 && k.x + k.w <= width && k.y + k.h <= bottom;
  });
  const clear = inside.find(
    (s) => !others.some((o) => hits(stackRect(s, fit), o)),
  );
  return clear ?? inside[0] ?? below;
}

/** Ray from the box centre toward (tx, ty), cut at the box edge. */
function edge(b: NodeBox, tx: number, ty: number): [number, number] {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const t = Math.min(
    dx ? b.w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy ? b.h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return [b.x + dx * t, b.y + dy * t];
}

export function MapView(props: {
  request: RequestView;
  highlight?: { partId?: string; phaseId?: string };
  onOpenPart(partId: string): void;
}): JSX.Element {
  const { request, highlight, onOpenPart } = props;
  const { kind, parts } = request;
  const { width, height } = mapSize(kind, parts);
  const { center, nodes } = layoutMap(kind, parts, width, height);
  const boxOf = new Map(nodes.map((n) => [n.id, n]));
  // layoutMap returns one box per part, in declaration order.
  const placed = nodes.map((box, i) => ({ box, part: parts[i] as PartView }));
  const rects = [...nodes, ...(center.w ? [center] : [])].map(rectOf);

  const active = Boolean(highlight?.partId || highlight?.phaseId);
  const full = (p: PartView) =>
    !active ||
    (highlight?.partId
      ? p.id === highlight.partId
      : p.phase === highlight?.phaseId);
  const phaseNo = (id?: string) => {
    const i = request.phases.findIndex((ph) => ph.id === id);
    return i < 0 ? null : i + 1;
  };
  const open = (id: string) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpenPart(id);
  };

  // Chip stacks go where they fit; link labels then avoid nodes, phase tags,
  // chips and each other. `tagged` is each box plus the phase tag above it.
  const tagged = rects.map((r) => ({ ...r, y: r.y - 16, h: r.h + 16 }));
  const frame = linkFrame(kind, width);
  const ringIds = new Set(
    kind === "feature" ? nodes.slice(0, RING_SIZE).map((n) => n.id) : [],
  );
  // Ring parts and the goal never see overflow parts, so the overflow grid
  // growing below cannot move their chips or labels. rects[nodes.length] is the goal.
  const inRing = (j: number) =>
    kind !== "feature" || j < RING_SIZE || j === nodes.length;
  // Earlier stacks, at their full reserved size, so stacks never cover each other.
  const stacks: (Rect & { ring: boolean })[] = [];
  const chipSpots = placed.map(({ part, box }, i) => {
    const n = chipCount(part);
    if (!n) return null;
    const ring = ringIds.has(box.id);
    // Ring stacks pick their side for the full stack, above the overflow
    // tag band, so neither more agents nor overflow parts can move them.
    const fit = ring ? MAX_CHIPS : n;
    const spot = chipSpot(
      box,
      fit,
      [
        ...tagged.filter((_, j) => j !== i && (!ring || inRing(j))),
        ...stacks.filter((s) => !ring || s.ring),
      ],
      width,
      ring ? RING_CHIP_BOTTOM : Number.POSITIVE_INFINITY,
    );
    stacks.push({ ...stackRect(spot, fit), ring });
    return { ...spot, ring, rect: stackRect(spot, n) };
  });
  const taken: (Rect & { ring: boolean })[] = [
    ...tagged.map((r, j) => ({ ...r, ring: inRing(j) })),
    ...chipSpots.flatMap((c) =>
      c ? [{ ...c.rect, ring: kind !== "feature" || c.ring }] : [],
    ),
  ];
  const links = parts.flatMap((p) =>
    p.links.flatMap((l) => {
      const a = boxOf.get(p.id);
      const b = boxOf.get(l.to);
      if (!a || !b || a === b) return [];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len) return [];
      // Bow the curve away from a fixed point, like the mockup, unless that
      // would cross the fixed frame. Neither depends on the growing height.
      let nx = -(b.y - a.y) / len;
      let ny = (b.x - a.x) / len;
      if (nx * (mx - frame.x) + ny * (my - frame.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const bow = len * 0.18;
      // Links that touch an overflow part may bow below the base.
      const ring =
        kind !== "feature" || (ringIds.has(a.id) && ringIds.has(b.id));
      const bottom =
        ring && kind === "feature" ? frame.height : Number.POSITIVE_INFINITY;
      const off = (x: number, y: number) =>
        x < 12 || y < 12 || x > frame.width - 12 || y > bottom - 12;
      if (off(mx + nx * bow, my + ny * bow)) {
        nx = -nx;
        ny = -ny;
      }
      const cx = mx + nx * bow;
      const cy = my + ny * bow;
      const [sx, sy] = edge(a, b.x, b.y);
      const [ex, ey] = edge(b, a.x, a.y);
      const at = (t: number) => [
        (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t * t * ex,
        (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t * t * ey,
      ];
      const lw = textWidth(l.label, 10.5) + 8;
      // On the curve first, then just outside or inside it.
      const spots = [0, 16, -16].flatMap((shift) =>
        [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((t) => {
          const [px = 0, py = 0] = at(t);
          const x = px + nx * shift;
          const y = py + ny * shift;
          return { x, y, rect: { x: x - lw / 2, y: y - 8, w: lw, h: 14 } };
        }),
      );
      // Least overlap wins; ties keep the earlier (preferred) spot.
      const cost = (r: Rect) =>
        (r.x < 0 || r.y < 0 || r.x + r.w > width ? 1e9 : 0) +
        taken.reduce(
          (sum, o) => (ring && !o.ring ? sum : sum + overlap(r, o)),
          0,
        );
      const spot = spots.reduce((best, c) =>
        cost(c.rect) < cost(best.rect) ? c : best,
      );
      taken.push({ ...spot.rect, ring });
      return [
        {
          key: `${p.id}>${l.to}>${l.label}`,
          d: `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`,
          label: l.label,
          lx: spot.x,
          ly: spot.y,
        },
      ];
    }),
  );

  return (
    <div className="map">
      {kind !== "feature" && <p className="map-caption">{request.goal}</p>}
      {/* biome-ignore lint/a11y/useSemanticElements: the map is an SVG, not a form */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="group"
        aria-label="Map of the parts of this work"
      >
        <defs>
          <marker
            id="map-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="arrow-head" />
          </marker>
        </defs>
        {center.w > 0 &&
          nodes
            .slice(0, RING_SIZE)
            .map((n) => (
              <line
                key={n.id}
                className="spoke"
                x1={center.x}
                y1={center.y}
                x2={n.x}
                y2={n.y}
              />
            ))}
        {links.map((l) => (
          <path
            key={l.key}
            className="link"
            d={l.d}
            markerEnd="url(#map-arrow)"
          />
        ))}
        {center.w > 0 && <Goal box={center} goal={request.goal} dim={active} />}
        {placed.map(({ part: p, box }) => {
          const r = rectOf(box);
          const state = stateOf(p);
          const phase = phaseNo(p.phase);
          const label = truncate(
            p.title,
            r.w - 20 - (state === "now" || state === "done" ? 14 : 0),
            12,
          );
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG node cannot be a <button>
            <g
              key={p.id}
              className={`map-node ${state}`}
              role="button"
              tabIndex={0}
              aria-label={`${p.title}, ${WORDS[state]}`}
              onClick={() => onOpenPart(p.id)}
              onKeyDown={open(p.id)}
            >
              {label !== p.title && <title>{p.title}</title>}
              <rect
                className="ring"
                x={r.x - 4}
                y={r.y - 4}
                width={r.w + 8}
                height={r.h + 8}
                rx={11}
              />
              <rect
                className="backing"
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={8}
              />
              <g className="dim" style={{ opacity: full(p) ? 1 : DIM }}>
                {phase && (
                  <text className="phase-tag" x={r.x} y={r.y - 6}>
                    phase {phase}
                  </text>
                )}
                <rect
                  className="box"
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={8}
                />
                <text className="label" x={box.x} y={box.y + 4}>
                  {state === "now" && <tspan className="dot">● </tspan>}
                  {label}
                  {state === "done" && <tspan className="tick"> ✓</tspan>}
                </text>
              </g>
            </g>
          );
        })}
        {placed.map(({ part: p, box }, i) => (
          <Chips
            key={p.id}
            part={p}
            request={request}
            box={box}
            spot={chipSpots[i] ?? null}
            opacity={full(p) ? 1 : DIM}
          />
        ))}
        {links.map((l) => (
          <text key={l.key} className="link-label" x={l.lx} y={l.ly + 3}>
            {l.label}
          </text>
        ))}
        {parts.length === 0 && (
          <text
            className="map-empty"
            x={width / 2}
            y={center.w ? center.y + center.h / 2 + 32 : height / 2}
          >
            {EMPTY}
          </text>
        )}
      </svg>
    </div>
  );
}

function Goal(props: { box: NodeBox; goal: string; dim: boolean }) {
  const { box, goal, dim } = props;
  const r = rectOf(box);
  const label = truncate(goal, r.w - 20, 14);
  return (
    <g className="map-goal">
      {label !== goal && <title>{goal}</title>}
      <rect
        className="backing"
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={10}
      />
      <g className="dim" style={{ opacity: dim ? DIM : 1 }}>
        <rect
          className="goal-box"
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={10}
        />
        <text className="goal-label" x={box.x} y={box.y + 5}>
          {label}
        </text>
      </g>
    </g>
  );
}

function Chips(props: {
  part: PartView;
  request: RequestView;
  box: NodeBox;
  spot: ChipSpot | null;
  opacity: number;
}) {
  const { part, request, box, spot, opacity } = props;
  if (!spot) return null;
  const chips = part.agents.slice(0, 2).map((id) => {
    const k = request.agents.findIndex((a) => a.id === id);
    const agent = request.agents[k];
    const text = agent
      ? `Agent ${k + 1}${agent.description ? `: ${agent.description}` : ""}`
      : `Agent: ${id}`;
    return {
      key: id,
      w: CHIP_W,
      text,
      label: truncate(text, CHIP_W - 16, 10.5),
    };
  });
  if (part.agents.length > 2) {
    const text = `+${part.agents.length - 2} more`;
    chips.push({ key: "more", w: MORE_W, text, label: text });
  }
  const r = rectOf(box);
  const mid = spot.y + CHIP_H / 2;
  const connector =
    spot.side === "below"
      ? [box.x, r.y + r.h, box.x, spot.y]
      : spot.side === "above"
        ? [box.x, r.y - 16, box.x, spot.y + CHIP_H]
        : spot.side === "right"
          ? [r.x + r.w, mid, spot.x, mid]
          : [r.x, mid, spot.x + CHIP_W, mid];
  return (
    <g className="map-chips">
      <g className="dim" style={{ opacity }}>
        <line
          className="chip-line"
          x1={connector[0]}
          y1={connector[1]}
          x2={connector[2]}
          y2={connector[3]}
        />
      </g>
      {chips.map((c, i) => {
        // Narrow chips (`+N more`) sit on the stack's near edge to the node.
        const x =
          spot.side === "left"
            ? spot.x + CHIP_W - c.w
            : spot.side === "right"
              ? spot.x
              : spot.x + (CHIP_W - c.w) / 2;
        // Above the node the stack grows upward, away from it.
        const y = spot.y + (spot.side === "above" ? -i : i) * PITCH;
        return (
          <g key={c.key} className="chip">
            {c.label !== c.text && <title>{c.text}</title>}
            <rect
              className="backing"
              x={x}
              y={y}
              width={c.w}
              height={CHIP_H}
              rx={6}
            />
            <g className="dim" style={{ opacity }}>
              <rect
                className="chip-box"
                x={x}
                y={y}
                width={c.w}
                height={CHIP_H}
                rx={6}
              />
              <text className="chip-label" x={x + c.w / 2} y={y + 14}>
                {c.label}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
