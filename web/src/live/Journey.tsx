/*
 * The session's own page: where it started and where it went. Two cards joined by a line
 * (the first prompt, where it is now), the totals, the chapters as a strip, then every
 * request as a station on one vertical line with the pauses and decisions between them.
 * Read from core's `journey`; a view built before core had one is a single chapter.
 */
import {
  type Chapter,
  cutWords,
  type MurmurEvent,
  type Pause,
  type RequestView,
  type SessionView,
} from "@murmur/core";
import { type CSSProperties, useEffect, useRef } from "react";
import { dayLabel } from "../format";
import { StateMark } from "../marks";
import { follow, requestPath } from "../router";
import { askOf, cleanPrompt, KIND, type Mark, requestShort } from "../session";
import {
  requestNow,
  type SessionNow,
  type State,
  sessionNow,
  sessionSpan,
} from "../state";
import { clock, duration, thousands } from "../story";

const DAY_MS = 86_400_000;
const many = (n: number, one: string, more = `${one}s`) =>
  `${n} ${n === 1 ? one : more}`;
/** "Mon 2 Nov 17:43". */
const when = (iso: string) => `${dayLabel(iso)} ${clock(iso)}`;
export const took = (from: string, to: string) => {
  const d = duration(from, to);
  return d === "under a minute" ? "<1 m" : d;
};
/** A gap in words: "3 days", "11 h 39 m". */
export function gap(from: string, to: string): string {
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= DAY_MS
    ? many(Math.floor(ms / DAY_MS), "day")
    : duration(from, to);
}
const sameDay = (a: string, b: string) =>
  new Date(a).toDateString() === new Date(b).toDateString();
export const live = (m: Mark | undefined) => m === "running" || m === "waiting";

/** How the last request stands, after its number: "running 40 m", "done in 2 h 03 m". */
const STANDS: Record<State, string> = {
  running: "running",
  waiting: "waiting on you for",
  paused: "paused after",
  done: "done in",
  open: "left open after",
  failed: "failed after",
  todo: "not started",
};

/** Every request as it stands now (state.ts), by id, with the session's moment. */
function useStands(
  view: SessionView,
  events: MurmurEvent[],
  at: SessionNow | undefined,
) {
  const ses = at ?? sessionNow(view);
  const stands = new Map(
    view.requests.map((r) => [r.id, requestNow(view, r, events, ses)]),
  );
  return { ses, stands };
}

/** Stations rise in turn on load, the first ten at most; one arriving live rises alone. */
const STAGGER = 10;
/** Sessions whose journey has risen in once: coming back to it never replays that. */
const risen = new Set<string>();

/**
 * The session's head, the same on each of its tabs: where and when, its name, and its
 * span, requests and chapters. The tabs sit under it.
 */
export function SessionHead(props: {
  view: SessionView;
  events: MurmurEvent[];
  /** The session at the moment shown (state.ts); else live, now. */
  ses?: SessionNow | undefined;
}) {
  const { view, events } = props;
  const reqs = view.requests;
  const start = reqs[0];
  const folder = view.cwd.split("/").filter(Boolean).pop();
  const firstDay = start ? dayLabel(start.startedAt) : "";
  const lastDay = dayLabel(view.lastEventAt);
  const { ses, stands } = useStands(view, events, props.ses);
  const states = [...stands.values()].map((s) => s.state);
  const running = states.filter((m) => m === "running").length;
  const waiting = states.filter((m) => m === "waiting").length;
  const paused = states.filter((m) => m === "paused").length;
  const chapters = view.journey?.chapters.length ?? 0;
  const span = sessionSpan(ses);
  const days = /^(\d+) (days?)$/.exec(span);
  return (
    <>
      <div className="over jr-over">
        <span className="label-chip">Session</span>
        <span className="num">
          {folder && `${folder} · `}
          {firstDay === lastDay ? firstDay : `${firstDay} to ${lastDay}`}
        </span>
      </div>
      <h1
        className="jr-title"
        title={start ? cleanPrompt(start.prompt) : undefined}
      >
        {view.title ? cleanPrompt(view.title) : "Untitled session"}
      </h1>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the facts */}
      <div className="asked" role="group" aria-label="Summary">
        <span>
          {days ? (
            <>
              <b className="num">{days[1]}</b> {days[2]}
            </>
          ) : (
            span
          )}
        </span>
        <span>
          <b className="num">{reqs.length}</b>{" "}
          {reqs.length === 1 ? "request" : "requests"}
        </span>
        {chapters > 1 && (
          <span>
            <b className="num">{chapters}</b> chapters
          </span>
        )}
        {running > 0 && (
          <span>
            <b className="num">{running}</b> running now
          </span>
        )}
        {paused > 0 && (
          <span>
            <b className="num">{paused}</b> paused
          </span>
        )}
        {waiting > 0 && (
          <span className="jr-need">
            <b className="num">{waiting}</b> waiting on you
          </span>
        )}
      </div>
    </>
  );
}

export function Journey(props: {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
  /** The session at the moment shown (state.ts); else live, now. */
  ses?: SessionNow | undefined;
}) {
  const { sessionId, view, events } = props;
  const reqs = view.requests;
  const { ses, stands: marks } = useStands(view, events, props.ses);
  // The stations drawn first, with their place in the rise; null once this session's
  // journey has risen before.
  const first = useRef<{ rise: boolean; at: Map<string, number> }>(null);
  first.current ??= {
    rise: !risen.has(sessionId),
    at: new Map(reqs.map((r, i) => [r.id, Math.min(i, STAGGER)])),
  };
  const { rise, at } = first.current;
  useEffect(() => {
    risen.add(sessionId);
  }, [sessionId]);
  const order = (r: RequestView) =>
    at.has(r.id) ? (rise ? (at.get(r.id) ?? 0) : null) : 0;
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const num = (r: RequestView) => reqs.indexOf(r) + 1;
  const path = (r: RequestView) => requestPath(sessionId, r.id);
  const j = view.journey;
  const start = reqs[0] as RequestView;
  const last = reqs.at(-1) as RequestView;
  const lastMark = marks.get(last.id);
  const chapters: Chapter[] = j?.chapters.length
    ? j.chapters
    : [
        {
          title: "",
          requestIds: reqs.map((r) => r.id),
          state: last.state ?? "done",
        },
      ];
  const pauses = j?.pauses ?? [];
  const decisions = j?.decisions ?? [];
  const busiest = Math.max(0, ...reqs.map((r) => r.tally.helpers));
  // One loop on screen: the newest running station.
  const pulsing = reqs.findLast((r) => marks.get(r.id)?.state === "running");
  // Where each request's clock stops, as every view times it (state.ts).
  const endOf = (r: RequestView) => marks.get(r.id)?.to ?? ses.end;
  const firstDay = dayLabel(start.startedAt);
  const span = sessionSpan(ses);
  const asked = lastMark?.state === "waiting";
  const askedN = asked
    ? last.waiting?.length || lastMark?.waiting?.questions.length || 0
    : 0;

  return (
    <div className="jr">
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the cards */}
      <div
        className={rise ? "jr-ends jr-in" : "jr-ends"}
        role="group"
        aria-label="From here to here"
      >
        <a
          className="jr-end from"
          href={path(start)}
          onClick={follow(path(start))}
        >
          <span className="jr-k">
            Where it started · {firstDay}, {clock(start.startedAt)}
          </span>
          <q className="jr-q">{cutWords(cleanPrompt(start.prompt), 220)}</q>
          {(start.outcome || !start.kindInferred) && (
            <span className="jr-end-meta">
              {[
                ...(start.kindInferred ? [] : [KIND[start.kind]]),
                ...(start.outcome ? [start.outcome] : []),
              ].join(" · ")}
            </span>
          )}
        </a>
        <div className="jr-join">
          <span className="jr-join-t num">
            {span} · {many(reqs.length, "request")}
          </span>
        </div>
        <a
          className={`jr-end to ${lastMark?.mark ?? "done"}`}
          href={path(last)}
          onClick={follow(path(last))}
        >
          <span className="jr-k">
            {live(lastMark?.mark)
              ? "Where it is now"
              : lastMark?.state === "paused"
                ? "Where it stopped"
                : "Where it ended"}{" "}
            · {dayLabel(endOf(last))}, {clock(endOf(last))}
          </span>
          <span className="jr-now">{last.outcome || askOf(last)}</span>
          <span className="jr-end-meta">
            Request {num(last)}, {STANDS[lastMark?.state ?? "done"]}{" "}
            {lastMark?.clock ?? took(last.startedAt, endOf(last))}.
            {askedN > 0 && (
              <>
                {" "}
                <span className="jr-need">
                  {`${askedN} ${askedN === 1 ? "thing waits" : "things wait"} on you`}
                </span>
              </>
            )}
          </span>
        </a>
      </div>

      {j && <Totals totals={j.totals} pauses={pauses} rise={rise} />}

      {chapters.length > 1 && (
        <nav className="jr-chapters" aria-label="Chapters">
          <ol className="jr-segs">
            {chapters.map((c, i) => {
              const rs = c.requestIds.flatMap((id) => byId.get(id) ?? []);
              const a = rs[0] ? num(rs[0]) : 0;
              const b = rs.at(-1) ? num(rs.at(-1) as RequestView) : 0;
              const on = c.state === "running" || c.state === "waiting";
              const tone = on
                ? "live"
                : c.state === "left-open"
                  ? "open"
                  : c.state;
              const id = `chapter-${i + 1}`;
              return (
                <li
                  className="jr-segi"
                  key={id}
                  style={
                    { "--w": Math.max(rs.length, 1), "--k": i } as CSSProperties
                  }
                >
                  <a
                    className={`jr-seg ${tone}`}
                    href={`#${id}`}
                    aria-current={on ? "step" : undefined}
                    onClick={(e) => {
                      const to = document.getElementById(id);
                      if (!to) return;
                      e.preventDefault();
                      // The page glides to the chapter so the jump reads as a move.
                      const still = window.matchMedia?.(
                        "(prefers-reduced-motion: reduce)",
                      ).matches;
                      to.scrollIntoView({
                        block: "start",
                        behavior: still ? "auto" : "smooth",
                      });
                      history.replaceState(history.state, "", `#${id}`);
                    }}
                  >
                    <span className="jr-seg-n">
                      {i + 1}. {c.title}
                    </span>
                    <span className="jr-seg-s">
                      {a === b ? `Request ${a}` : `Requests ${a} to ${b}`}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="jr-line">
        {chapters.map((c, i) => {
          const rs = c.requestIds.flatMap((id) => byId.get(id) ?? []);
          const id = `chapter-${i + 1}`;
          const helpers = rs.reduce((n, r) => n + r.tally.helpers, 0);
          const lastR = rs.at(-1);
          return (
            <section
              className="jr-chap"
              id={id}
              key={id}
              aria-labelledby={c.title ? `${id}-h` : undefined}
            >
              {c.title && rs[0] && lastR && (
                <header className="jr-ch">
                  <h2 id={`${id}-h`}>
                    {i + 1}. {c.title}
                  </h2>
                  <span className="jr-ch-meta num">
                    {[
                      many(rs.length, "request"),
                      // The last chapter runs to where the session's span does.
                      took(
                        rs[0].startedAt,
                        lastR === last ? ses.end : endOf(lastR),
                      ),
                      ...(helpers ? [many(helpers, "helper")] : []),
                    ].join(" · ")}
                  </span>
                </header>
              )}
              <ol className="jr-stops">
                {rs.flatMap((r) => {
                  const mine = decisions.filter((d) => d.requestId === r.id);
                  const out = pauses.find((p) => p.after === r.id && !p.inside);
                  return [
                    ...mine
                      .filter((d) => d.by === "user")
                      .map((d) => (
                        <Decision
                          key={`d-${d.ts}-${d.text}`}
                          you
                          text={d.text}
                        />
                      )),
                    <Station
                      key={r.id}
                      sessionId={sessionId}
                      request={r}
                      mark={marks.get(r.id)?.mark ?? "done"}
                      end={endOf(r)}
                      pulse={r === pulsing}
                      busiest={busiest}
                      quiet={pauses.filter((p) => p.after === r.id && p.inside)}
                      order={order(r)}
                    />,
                    ...mine
                      .filter((d) => d.by === "claude")
                      .map((d) => (
                        <Decision key={`d-${d.ts}-${d.text}`} text={d.text} />
                      )),
                    ...(out
                      ? [
                          <li className="jr-pause" key={`p-${out.from}`}>
                            {gap(out.from, out.to)} away. Nothing ran between{" "}
                            {when(out.from)} and {when(out.to)}.
                          </li>,
                        ]
                      : []),
                  ];
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Totals(props: {
  totals: NonNullable<SessionView["journey"]>["totals"];
  pauses: Pause[];
  rise: boolean;
}) {
  const { totals: t, pauses, rise } = props;
  const longest = pauses.reduce<Pause | undefined>(
    (a, p) =>
      !a ||
      Date.parse(p.to) - Date.parse(p.from) >
        Date.parse(a.to) - Date.parse(a.from)
        ? p
        : a,
    undefined,
  );
  const away = longest ? gap(longest.from, longest.to) : "";
  const items: [number, string][] = [
    [t.helpers, "helpers ran"],
    [t.files, "files changed"],
    [t.commands, "commands run"],
    [t.sentBack, "tasks sent back after review"],
    [
      t.pauses,
      t.pauses === 1
        ? `pause over an hour, ${away}`
        : `pauses over an hour${away ? `, the longest ${away}` : ""}`,
    ],
  ];
  // A zero says nothing, so its tile is left out.
  const shown = items.filter(([n]) => n > 0);
  if (!shown.length) return null;
  return (
    <ul className={rise ? "jr-totals jr-in" : "jr-totals"} aria-label="Totals">
      {shown.map(([n, label]) => (
        <li key={label} className="jr-tot">
          <b className="jr-tot-v num">{thousands(n)}</b>
          <span className="jr-tot-l">{label}</span>
        </li>
      ))}
    </ul>
  );
}

function Decision(props: { text: string; you?: boolean }) {
  return (
    <li className="jr-dec">
      <span className="jr-dec-txt">
        <svg className="jr-dec-g" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.4 4.1 7.5 8 3" />
        </svg>
        {props.you ? `You approved: “${props.text}”` : props.text}
      </span>
    </li>
  );
}

function Station(props: {
  sessionId: string;
  request: RequestView;
  mark: Mark;
  end: string;
  pulse: boolean;
  busiest: number;
  quiet: Pause[];
  /** Its place in the rise on load; null when it does not rise. */
  order: number | null;
}) {
  const { sessionId, request: r, mark, end, pulse, busiest, quiet } = props;
  const path = requestPath(sessionId, r.id);
  const tasks = r.phases.flatMap((p) => p.tasks);
  const done = tasks.filter((t) => t.status === "done").length;
  const going = live(mark);
  // Its one title, as the rail and the Timeline name it; what it asked under it.
  const short = requestShort(r);
  const ask = askOf(r);
  const figs: [string, string][] = [
    [took(r.startedAt, end), going ? "so far" : "took"],
    [thousands(r.tally.helpers), "helpers"],
    [thousands(r.tally.files), "files"],
    [tasks.length ? `${done}/${tasks.length}` : "0", "tasks"],
  ];
  const share = r.tally.helpers
    ? Math.max(2, Math.round((r.tally.helpers / busiest) * 100))
    : 0;
  return (
    <li
      className={`jr-st ${mark}${props.order === null ? "" : " jr-in"}`}
      style={{ "--i": props.order ?? 0 } as CSSProperties}
    >
      <span className="jr-when num">
        <b className="jr-day">{dayLabel(r.startedAt).replace(/^\w+ /, "")}</b>
        {clock(r.startedAt)}
      </span>
      <span className="jr-dot">
        <StateMark mark={mark} pulse={pulse} />
      </span>
      <a className={`jr-card ${mark}`} href={path} onClick={follow(path)}>
        <span className="jr-card-head">
          {!r.kindInferred && (
            <span className="label-chip">{KIND[r.kind]}</span>
          )}
          <span className="jr-card-ttl">{short}</span>
        </span>
        {ask && ask !== short && <span className="jr-card-goal">{ask}</span>}
        {(r.outcome || going) && (
          <span className="jr-out">
            {going && (
              <b className={mark === "waiting" ? "jr-need" : "jr-live"}>
                {mark === "waiting" ? "Waiting on you" : "Running"}
              </b>
            )}
            {going && r.outcome && " · "}
            {r.outcome}
          </span>
        )}
        <span className="jr-figs">
          {figs.map(([v, l]) => (
            <span className="jr-fig" key={l}>
              <b className="jr-fig-v num">{v}</b>
              <span className="jr-fig-l">{l}</span>
            </span>
          ))}
        </span>
        {quiet.length > 0 && (
          <span className="jr-quiet">
            Paused{" "}
            {quiet
              .map(
                (p) =>
                  `${gap(p.from, p.to)}, ${when(p.from)} to ${
                    sameDay(p.from, p.to) ? clock(p.to) : when(p.to)
                  }`,
              )
              .join("; ")}
            .
          </span>
        )}
        {share > 0 && (
          <span className="jr-load" aria-hidden="true">
            <i className={going ? "now" : ""} style={{ width: `${share}%` }} />
          </span>
        )}
      </a>
      <span className="sr-only">, {mark === "open" ? "left open" : mark}</span>
    </li>
  );
}
