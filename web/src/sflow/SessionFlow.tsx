/*
 * The session flow: its storylines as swimlanes, time running down. A column per thread
 * with a sticky header, a card per request in its thread's column, a row each in time
 * order; a thread's lane line joins its requests, `follows` links cross between them, a
 * long pause is a dashed rule across the board. Selecting a card lights its thread and
 * its chain and dims the rest; Enter (or a second click) opens the request. Under 900 px
 * it is one list in time order.
 */
import type { MurmurEvent, RequestView, SessionView } from "@murmur/core";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useStacked } from "../flow/FlowBoard";
import { gap, live, took } from "../live/Journey";
import { dayLabel, StateMark } from "../live/Rail";
import { follow, navigate, requestPath } from "../router";
import { type Mark, requestMark, requestShort } from "../session";
import { clock } from "../story";
import {
  chainOf,
  drawnFollows,
  GUTTER,
  layoutSessionFlow,
  ONE_WIDTH,
  placed,
  type SFCard,
  threadsOf,
} from "./sflow";

const many = (n: number, one: string, more = `${one}s`) =>
  `${n} ${n === 1 ? one : more}`;

/** Puts the selection in the URL (`?r=`) without a new history entry. */
function writeR(id: string | undefined) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("r", id);
  else url.searchParams.delete("r");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

const THREAD_MARK: Record<string, Mark> = { "left-open": "open" };

const UI = 'Geist, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
let pen: CanvasRenderingContext2D | null | undefined;
/** How wide `text` is in `font`; 0 where nothing can measure it (tests). */
function widthOf(text: string, font: string): number {
  if (pen === undefined)
    pen = /jsdom/.test(navigator.userAgent)
      ? null
      : document.createElement("canvas").getContext("2d");
  if (!pen) return 0;
  pen.font = font;
  return pen.measureText(text).width;
}

/**
 * The text cut after its last whole word that fits `px` in `font`, with "…": a one-line
 * clamp cuts mid-word when the ellipsis lands on one. Whole when it fits or cannot be
 * measured.
 */
export function fitWords(text: string, px: number, font: string): string {
  if (widthOf(text, font) <= px) return text;
  const words = text.split(" ");
  let lo = 1;
  let hi = words.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cut = `${words
      .slice(0, mid)
      .join(" ")
      .replace(/[\s,;:.!?-]+$/, "")}…`;
    if (widthOf(cut, font) <= px) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // A first word too long for the line is left to the clip.
  return best
    ? `${words
        .slice(0, best)
        .join(" ")
        .replace(/[\s,;:.!?-]+$/, "")}…`
    : text;
}

/** Fonts land after the first paint: measure again once they have. */
function useFonts() {
  const [, set] = useState(0);
  useEffect(() => {
    let on = true;
    document.fonts?.ready.then(() => on && set(1));
    return () => {
      on = false;
    };
  }, []);
}

export function SessionFlow(props: {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
}) {
  const { sessionId, view, events } = props;
  const stacked = useStacked();
  const threads = useMemo(() => threadsOf(view), [view]);
  const shown = useMemo(() => placed(view, threads), [view, threads]);
  const now = new Date().toISOString();
  const marks = new Map(
    view.requests.map((r) => [r.id, requestMark(view, r, events)]),
  );
  const markOf = (r: RequestView) => marks.get(r.id)?.mark ?? "done";
  // One loop on the page: the newest running request.
  const pulsing = view.requests.findLast((r) => markOf(r) === "running")?.id;
  const facts = (r: RequestView) => {
    const m = marks.get(r.id);
    const end = live(m?.mark) ? now : (m?.end ?? now);
    return [
      took(r.startedAt, end),
      many(r.tally.helpers, "helper"),
      many(r.tally.files, "file"),
    ].join(" · ");
  };
  // A storyline Murmur guessed is no chip: it is named after its first request.
  const named = new Map(
    shown.threads.filter((t) => !t.inferred).map((t) => [t.id, t.title]),
  );
  const picksUp = new Map(
    drawnFollows(view, threads).map((f) => [f.to, f.from]),
  );
  const num = new Map(view.requests.map((r, i) => [r.id, i + 1]));
  const inferred = threads.every((t) => t.inferred);
  const note = inferred && (
    <p className="sf-note">
      Claude has not named this session's storylines yet, so its requests run in
      one line.
    </p>
  );

  if (stacked)
    return (
      <section className="sf stacked" aria-label="Session flow">
        {note}
        <PhoneList
          sessionId={sessionId}
          view={view}
          markOf={markOf}
          pulsing={pulsing}
          facts={facts}
          threadOf={(r) => named.get(shown.of.get(r.id) ?? "")}
          picksUp={(r) => num.get(picksUp.get(r.id) ?? "")}
        />
      </section>
    );
  return (
    <section className="sf" aria-label="Session flow">
      {note}
      <Board
        sessionId={sessionId}
        view={view}
        markOf={markOf}
        pulsing={pulsing}
        facts={facts}
      />
    </section>
  );
}

interface CardProps {
  sessionId: string;
  view: SessionView;
  markOf(r: RequestView): Mark;
  pulsing: string | undefined;
  facts(r: RequestView): string;
}

function Board(props: CardProps) {
  const { sessionId, view, markOf, pulsing, facts } = props;
  useFonts();
  const frame = useFrame(true);
  const { width, left } = frame;
  const threads = useMemo(() => threadsOf(view), [view]);
  const L = useMemo(
    () => layoutSessionFlow(view, threads, { width }),
    [view, threads, width],
  );
  const [picked, setPicked] = useState(
    () => new URLSearchParams(location.search).get("r") ?? undefined,
  );
  const els = useRef(new Map<string, HTMLButtonElement>());
  const sel = L.cards.find((c) => c.req.id === picked);
  const chain = useMemo(
    () => (sel ? chainOf(view, sel.req.id) : new Set<string>()),
    [view, sel],
  );
  // Murmur's guessed column is no storyline: a selection there lights its chain alone.
  const lane = sel && !L.cols[sel.col]?.thread.inferred ? sel.thread : "";
  const lit = (c: SFCard) => !sel || c.thread === lane || chain.has(c.req.id);
  const linkOn = (l: { from: string; to: string }) =>
    !!sel && chain.has(l.from) && chain.has(l.to);

  // A request named in the URL may sit far down or off to the side: bring it into view
  // once the frame has its width.
  const revealed = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs as the frame is measured
  useEffect(() => {
    const el = picked && !revealed.current && els.current.get(picked);
    if (!el || !width) return;
    revealed.current = true;
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [width]);

  const choose = (id: string | undefined) => {
    setPicked(id);
    writeR(id);
  };
  const open = (id: string) =>
    navigate(requestPath(sessionId, id), els.current.get(id));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && sel) {
      e.preventDefault();
      choose(undefined);
      return;
    }
    const from = (e.target as HTMLElement).dataset.id;
    if (!from) return;
    if (e.key === "Enter") {
      e.preventDefault();
      open(from);
      return;
    }
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const to = step(L.cards, from, e.key);
    if (!to) return;
    choose(to);
    const el = els.current.get(to);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const tabStop = sel?.req.id ?? L.cards[0]?.req.id;
  // One column of Murmur's guessed storylines needs no header: the note says it.
  const one = L.cols.length === 1;
  const heads = !one || !L.cols[0]?.thread.inferred;
  const less = left > 1;
  const more = left + width < L.width - 1;

  return (
    <section
      aria-label={heads ? "Storylines" : "Requests in time order"}
      className={`sf-board${one ? " one" : ""}${heads ? "" : " bare"}${less ? " less" : ""}${more ? " more" : ""}`}
      // One column reads as a timeline at a reading width, not a wide empty board.
      style={one ? { maxWidth: ONE_WIDTH + 2 } : undefined}
      onKeyDown={onKey}
    >
      {heads && (
        <div className="sf-heads">
          <div
            className="sf-heads-in"
            style={{ width: L.width, transform: `translateX(${-left}px)` }}
          >
            {L.cols.map((c) => {
              const t = c.thread;
              const mark = THREAD_MARK[t.state] ?? (t.state as Mark);
              const span = gap(t.startedAt, t.lastAt);
              const dim = sel && sel.thread !== t.id;
              return (
                <div
                  key={t.id}
                  className={`sf-head${dim ? " dim" : ""}${lane === t.id ? " on" : ""}`}
                  style={{ left: c.x, width: c.w }}
                >
                  <h3 className="sf-head-t" title={t.title}>
                    {fitWords(t.title, c.w - 10, `600 15px ${UI}`)}
                  </h3>
                  <span className="sf-head-m num">
                    <StateMark mark={mark} />
                    {many(t.requests.length, "request")}
                    {t.requests.length > 1 && span !== "under a minute"
                      ? ` · ${span}`
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <span className="sf-corner" style={{ width: GUTTER }} />
        </div>
      )}
      <div className="sf-frame" ref={frame.ref} onScroll={frame.onScroll}>
        <div
          className={sel ? "sf-canvas picked" : "sf-canvas"}
          style={{ width: L.width, height: L.height }}
        >
          <div className="sf-gutter" style={{ width: GUTTER }}>
            {L.times.map((t) => (
              <span key={t.id} className="sf-time num" style={{ top: t.y }}>
                {t.day && <b className="sf-tday">{t.day}</b>}
                {t.time}
              </span>
            ))}
            {L.pauses.map((p) => (
              <i key={p.after} className="sf-gap" style={{ top: p.y }} />
            ))}
          </div>
          {L.pauses.map((p) => (
            <div
              key={p.after}
              className="sf-pause"
              style={{ top: p.y, left: GUTTER, width: L.width - GUTTER }}
            >
              <span className="sf-pause-t">{p.text}</span>
            </div>
          ))}
          <svg
            className="sf-lines"
            width={L.width}
            height={L.height}
            aria-hidden="true"
          >
            {L.lanes.map((l) => (
              <path
                key={l.key}
                className={`sf-lane${sel ? (lane === l.thread ? " on" : " dim") : ""}`}
                d={l.d}
              />
            ))}
            {L.links.map((l) => {
              const cls = `sf-link${linkOn(l) ? " on" : sel ? " dim" : ""}`;
              return (
                <g key={l.key} className={cls} data-key={l.key}>
                  <path d={l.d} />
                  <path d={l.head} />
                </g>
              );
            })}
          </svg>
          {L.cards.map((c) => {
            const r = c.req;
            const mark = markOf(r);
            const isSel = r.id === sel?.req.id;
            const path = requestPath(sessionId, r.id);
            return (
              <button
                key={r.id}
                ref={(el) => {
                  if (el) els.current.set(r.id, el);
                  else els.current.delete(r.id);
                }}
                type="button"
                data-id={r.id}
                data-n={c.n}
                data-morph={path}
                className={`sf-card ${mark}${isSel ? " sel" : ""}${lit(c) ? "" : " dim"}`}
                style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
                aria-pressed={isSel}
                tabIndex={r.id === tabStop ? 0 : -1}
                onClick={(e) => {
                  if (isSel) return open(r.id);
                  // Safari does not focus a clicked button: the keys work after a click.
                  e.currentTarget.focus({ preventScroll: true });
                  choose(r.id);
                }}
              >
                <CardBody
                  r={r}
                  n={c.n}
                  mark={mark}
                  pulse={r.id === pulsing}
                  facts={facts(r)}
                  open={isSel}
                  width={c.w}
                />
              </button>
            );
          })}
        </div>
      </div>
      <p className="sf-hint">
        {heads
          ? "Click a request to light its storyline and what it picks up from; click it again or press Enter to open it."
          : "Click a request to light what it picks up from; click it again or press Enter to open it."}
      </p>
    </section>
  );
}

function CardBody(props: {
  r: RequestView;
  n: number;
  mark: Mark;
  pulse: boolean;
  facts: string;
  open?: boolean;
  /** The card's width on the board, where lines are cut to fit; unset in the phone list, where they wrap. */
  width?: number;
  children?: React.ReactNode;
}) {
  const { r, n, mark, pulse, facts, open, width, children } = props;
  const short = requestShort(r);
  // Inside: padding and border (30), the mark (14) and the gaps beside the number (16).
  const inner = (width ?? 0) - 30;
  const room =
    inner -
    30 -
    widthOf(String(n), `500 13px ${MONO}`) -
    (open ? widthOf("Open →", `500 13px ${UI}`) + 8 : 0);
  const line = (text: string, px: number, font: string) =>
    width ? fitWords(text, px - 2, font) : text;
  return (
    <>
      <span className="sf-c1">
        <StateMark mark={mark} pulse={pulse} />
        <b className="sf-n num">{n}</b>
        <span className="sf-short" title={short}>
          {line(short, room, `600 15px ${UI}`)}
        </span>
        {open && <span className="sf-open">Open →</span>}
      </span>
      {children}
      {r.outcome && (
        <span className="sf-out" title={r.outcome}>
          {line(r.outcome, inner, `400 15px ${UI}`)}
        </span>
      )}
      <span className="sf-fx num">{facts}</span>
    </>
  );
}

/** The card an arrow key moves to: up and down in time, left and right to the nearest in time in the next column. */
function step(cards: SFCard[], from: string, key: string): string | undefined {
  const i = cards.findIndex((c) => c.req.id === from);
  const at = cards[i];
  if (!at) return undefined;
  if (key === "ArrowDown") return cards[i + 1]?.req.id;
  if (key === "ArrowUp") return cards[i - 1]?.req.id;
  const col =
    at.col + (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0);
  if (col === at.col) return undefined;
  let best: SFCard | undefined;
  for (const c of cards)
    if (
      c.col === col &&
      (!best || Math.abs(c.n - at.n) < Math.abs(best.n - at.n))
    )
      best = c;
  return best?.req.id;
}

function PhoneList(
  props: CardProps & {
    threadOf(r: RequestView): string | undefined;
    picksUp(r: RequestView): number | undefined;
  },
) {
  const { sessionId, view, markOf, pulsing, facts, threadOf, picksUp } = props;
  const wanted = new URLSearchParams(location.search).get("r");
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!wanted) return;
    ref.current
      ?.querySelector(`[data-id="${CSS.escape(wanted)}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [wanted]);
  const pauses = (view.journey?.pauses ?? []).filter((p) => !p.inside);
  let lastDay = "";
  return (
    <ol className="sf-list" ref={ref}>
      {view.requests.flatMap((r, i) => {
        const day = dayLabel(r.startedAt);
        const newDay = day !== lastDay;
        lastDay = day;
        const pause = pauses.find((p) => p.after === r.id);
        const path = requestPath(sessionId, r.id);
        const from = picksUp(r);
        const thread = threadOf(r);
        const mark = markOf(r);
        return [
          ...(newDay
            ? [
                <li key={`d-${day}`} className="sf-day num">
                  {day}
                </li>,
              ]
            : []),
          <li key={r.id} className="sf-li" data-n={i + 1} data-id={r.id}>
            <a
              className={`sf-card sf-lcard ${mark}`}
              href={path}
              onClick={follow(path)}
              data-morph=""
              aria-current={wanted === r.id ? "true" : undefined}
            >
              <CardBody
                r={r}
                n={i + 1}
                mark={mark}
                pulse={r.id === pulsing}
                facts={`${clock(r.startedAt)} · ${facts(r)}`}
              >
                {(thread || from) && (
                  <span className="sf-tags">
                    {thread && <span className="sf-chip">{thread}</span>}
                    {from && (
                      <span className="sf-from num">picks up from {from}</span>
                    )}
                  </span>
                )}
              </CardBody>
            </a>
          </li>,
          ...(pause && i < view.requests.length - 1
            ? [
                <li key={`p-${r.id}`} className="sf-pause">
                  {gap(pause.from, pause.to)} away
                </li>,
              ]
            : []),
        ];
      })}
    </ol>
  );
}
