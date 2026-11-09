import type { PartView, RequestView } from "@murmur/core";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StateMark } from "../live/Rail";
import { follow, partPath } from "../router";
import { clock } from "../story";
import {
  bandLine,
  bandMark,
  bands,
  bandWord,
  cardFacts,
  layoutFlow,
  neighbour,
  partMark,
  stateWord,
  tagOf,
  taskName,
} from "./flow";

const MINUS = "−";
const NARROW = "(max-width: 899px)";

/** Under 900 px bands stack and only the selection's links are drawn. */
function useStacked() {
  const [stacked, setStacked] = useState(
    () => window.matchMedia?.(NARROW).matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW);
    if (!mq) return;
    const on = () => setStacked(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return stacked;
}

/**
 * The frame's inner width, followed as the window resizes, and whether more of the board
 * lies past its right edge. Measured once the frame exists (`ready`).
 */
function useFrame(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again once the frame mounts
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const pad =
        (Number.parseFloat(cs.paddingLeft) || 0) +
        (Number.parseFloat(cs.paddingRight) || 0);
      setWidth(Math.max(0, el.clientWidth - pad));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  return { width, ref, more, check };
}

/** Puts the selection in the URL (`?part=`) without a new history entry. */
function writePart(id: string | undefined) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("part", id);
  else url.searchParams.delete("part");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

/**
 * The request's parts as a build order: a band per phase, left to right; inside one, each
 * part one column right of what it reads. Selecting a part lights its links and opens its
 * detail below; `?part=` selects one on load.
 */
export function FlowBoard(props: { sessionId: string; request: RequestView }) {
  const { sessionId, request: req } = props;
  const stacked = useStacked();
  const frame = useFrame(req.parts.length > 0);
  const width = frame.width;
  const [picked, setPicked] = useState(
    () => new URLSearchParams(location.search).get("part") ?? undefined,
  );
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const els = useRef(new Map<string, HTMLButtonElement>());
  const sel = req.parts.find((p) => p.id === picked);

  // A folded part that is selected opens its band.
  const selBand = sel && bands(req).find((b) => b.parts.includes(sel))?.id;
  const open = useMemo(
    () => (selBand ? new Set([...opened, selBand]) : opened),
    [opened, selBand],
  );
  const layout = useMemo(
    () => layoutFlow(req, { width, stacked, open }),
    [req, width, stacked, open],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fade follows the board's width
  useLayoutEffect(frame.check, [frame.check, layout.width, width]);

  const choose = (id: string | undefined) => {
    setPicked(id);
    writePart(id);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && sel) {
      e.preventDefault();
      choose(undefined);
      return;
    }
    if (!e.key.startsWith("Arrow")) return;
    const from = (e.target as HTMLElement).dataset.id;
    const to = from && neighbour(layout.cards, from, e.key, stacked);
    if (!from) return;
    e.preventDefault();
    if (!to) return;
    choose(to);
    els.current.get(to)?.focus();
  };

  if (!req.parts.length)
    return (
      <section className="flow" aria-label="Flow">
        <p className="tab-empty">
          The flow appears when Claude describes the parts of this work.
        </p>
      </section>
    );

  const now = new Date().toISOString();
  const touching = sel
    ? layout.links.filter((l) => l.from === sel.id || l.to === sel.id)
    : [];
  const rel = new Map(
    touching.map((l) => [
      l.from === sel?.id ? l.to : l.from,
      l.labels.join(", "),
    ]),
  );
  const lit = (id: string) => !sel || id === sel.id || rel.has(id);
  const shownSel = layout.cards.some((c) => c.part.id === sel?.id);
  const tabStop = shownSel ? sel?.id : layout.cards[0]?.part.id;
  const pulse = layout.cards.find((c) => partMark(req, c.part) === "running")
    ?.part.id;
  const on = (l: { from: string; to: string }) =>
    !!sel && (l.from === sel.id || l.to === sel.id);
  // Lit links draw last, over the quiet ones; stacked, only they are drawn.
  const links = [
    ...layout.links.filter((l) => !on(l) && !stacked),
    ...layout.links.filter(on),
  ];

  return (
    <section
      className={stacked ? "flow stacked" : "flow"}
      aria-label="Flow"
      onKeyDown={onKey}
    >
      <div className={frame.more ? "fb-wrap more" : "fb-wrap"}>
        <div className="fb-frame" ref={frame.ref} onScroll={frame.check}>
          <div
            className={sel ? "fb-canvas picked" : "fb-canvas"}
            style={{ width: layout.width, height: layout.height }}
          >
            {layout.bands.map((b, i) => {
              const prev = layout.bands[i - 1];
              const mark = bandMark(req, b.band);
              return (
                <div key={b.band.id}>
                  {prev && !stacked && (
                    <span
                      className="fb-div"
                      aria-hidden="true"
                      style={{
                        left: (prev.x + prev.w + b.x) / 2,
                        height: layout.height,
                      }}
                    />
                  )}
                  <div
                    className="fb-head"
                    style={{ left: b.x, top: b.y, width: b.w }}
                  >
                    <h3 className="fb-name" title={b.band.title}>
                      {b.band.title}
                    </h3>
                    <div className="fb-line num">
                      <span className={`fb-word ${mark}`}>
                        <StateMark mark={mark} />
                        {bandWord(req, b.band)}
                      </span>
                      <span className="fb-count">
                        {bandLine(b.band, mark === "running")}
                      </span>
                    </div>
                  </div>
                  {b.fold && (
                    <button
                      type="button"
                      className="fb-fold"
                      style={{
                        left: b.fold.x,
                        top: b.fold.y,
                        width: b.fold.w,
                        height: b.fold.h,
                      }}
                      onClick={() =>
                        setOpened((o) => new Set([...o, b.band.id]))
                      }
                    >
                      + {b.folded} done
                    </button>
                  )}
                </div>
              );
            })}
            <svg
              className="fb-links"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {links.map((l) => (
                <path
                  key={l.key}
                  data-key={l.key}
                  className={`fl${l.dash ? " dash" : ""}${
                    on(l) ? " on" : sel ? " dim" : ""
                  }`}
                  d={l.d}
                />
              ))}
            </svg>
            {layout.cards.map((c) => {
              const p = c.part;
              const mark = partMark(req, p);
              const word = stateWord(req, p);
              const tag = tagOf(req, p);
              const picked = p.id === sel?.id;
              const label = rel.get(p.id);
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    if (el) els.current.set(p.id, el);
                    else els.current.delete(p.id);
                  }}
                  type="button"
                  data-id={p.id}
                  className={`fc ${mark}${picked ? " sel" : ""}${
                    lit(p.id) ? "" : " dim"
                  }${p.id === pulse ? " fc-pulse" : ""}`}
                  style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
                  aria-pressed={picked}
                  aria-label={`${p.title}, ${word}`}
                  tabIndex={p.id === tabStop ? 0 : -1}
                  onClick={() => choose(picked ? undefined : p.id)}
                >
                  {label && <span className="fc-rel">{label}</span>}
                  <span className="fc-ttl" title={p.title}>
                    {tag && <span className="fc-tag num">{tag}</span>}
                    {p.title}
                  </span>
                  <span className="fc-st">
                    <StateMark mark={mark} />
                    {word}
                  </span>
                  {p.aim?.aim && <span className="fc-aim">{p.aim.aim}</span>}
                  <span className="fc-fxw">
                    <span className="fc-fx num">
                      {cardFacts(p, now).map((f) => (
                        <span key={f}>{f}</span>
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {sel && (
        <Detail key={sel.id} sessionId={sessionId} request={req} part={sel} />
      )}
      <div className="fb-legend">
        <span>
          <i />
          uses, sits in, feeds
        </span>
        <span>
          <i className="dash" />
          checks
        </span>
        <span>
          <i className="on" />
          links of the selected part
        </span>
        <span className="fb-hint">
          Click a part to select it. Arrow keys move the selection.
        </span>
      </div>
    </section>
  );
}

function Detail(props: {
  sessionId: string;
  request: RequestView;
  part: PartView;
}) {
  const { sessionId, request: req, part: p } = props;
  const tag = tagOf(req, p);
  const name = taskName(tag);
  const path = partPath(sessionId, req.id, p.id);
  const mark = partMark(req, p);
  const titleOf = (id: string) => req.parts.find((o) => o.id === id)?.title;
  const uses = [
    ...new Set(
      p.links.flatMap((l) => (l.to === p.id ? [] : (titleOf(l.to) ?? []))),
    ),
  ];
  const usedBy = req.parts
    .filter((o) => o.id !== p.id && o.links.some((l) => l.to === p.id))
    .map((o) => o.title);
  const added = p.files.reduce((s, f) => s + f.added, 0);
  const removed = p.files.reduce((s, f) => s + f.removed, 0);
  // "Frame matches…" reads "Done when frame matches…"; an acronym keeps its capitals.
  const done = p.aim?.doneWhen
    .trim()
    .replace(/\.$/, "")
    .replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
  return (
    <section className="fd" aria-label="Selected part">
      <div className="fd-main">
        <h3 className="fd-ttl">
          {tag ? `${p.title} · ${name}` : p.title}
          <span className={`fd-word ${mark}`}>
            <StateMark mark={mark} />
            {stateWord(req, p, true)}
          </span>
        </h3>
        {p.aim?.aim && (
          <p>
            {p.aim.aim}
            {done && ` Done when ${done}.`}
          </p>
        )}
        <div className="fd-facts num">
          {p.span && (
            <span>
              <b>{clock(p.span.start)}</b> to{" "}
              <b>{p.span.end ? clock(p.span.end) : "now"}</b>
            </span>
          )}
          <span>
            <b>{p.agents.length}</b>{" "}
            {p.agents.length === 1 ? "helper" : "helpers"}
          </span>
          <span>
            <b>{p.files.length}</b> {p.files.length === 1 ? "file" : "files"}{" "}
            <span className="fd-add">+{added}</span>{" "}
            <span className="fd-del">
              {MINUS}
              {removed}
            </span>
          </span>
          {uses.length > 0 && (
            <span>
              Uses <b>{uses.join(", ")}</b>
            </span>
          )}
          {usedBy.length > 0 && (
            <span>
              Used by <b>{usedBy.join(", ")}</b>
            </span>
          )}
        </div>
      </div>
      <a className="fd-open" href={path} onClick={follow(path)}>
        Open {tag ? name : "the task"} →
      </a>
    </section>
  );
}
