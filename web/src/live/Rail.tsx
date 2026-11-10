import type { MurmurEvent, RequestView, SessionView } from "@murmur/core";
import { Fragment, useEffect, useMemo, useRef } from "react";
import type { Me } from "../api";
import { follow, requestPath, sessionPath } from "../router";
import { type Mark, requestMark, requestShort } from "../session";
import { duration } from "../story";
import type { SessionStatus } from "../useSession";

/** A state's word, said beside its mark so colour and shape never carry it alone. */
export const MARK_WORD: Record<Mark, string> = {
  done: "Done",
  running: "Running",
  waiting: "Waiting on you",
  open: "Left open",
  failed: "Failed",
};

/**
 * A request's mark: a check for done, a blue dot for running (it pulses only where
 * `pulse` is set, the one loop on screen), an amber question mark for waiting on you,
 * a hollow ring for left open, a red cross for failed.
 */
export function StateMark(props: { mark: Mark; pulse?: boolean }) {
  const { mark, pulse } = props;
  return (
    <span
      className={`mk ${mark}${pulse && mark === "running" ? " pulse" : ""}`}
      aria-hidden="true"
    >
      {mark === "done" ? (
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.4 4.1 7.5 8 3" />
        </svg>
      ) : mark === "failed" ? (
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="m3 3 4 4M7 3 3 7" />
        </svg>
      ) : mark === "waiting" ? (
        "?"
      ) : null}
    </span>
  );
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
/** "Mon 2 Nov". */
export const dayLabel = (iso: string) =>
  DAY.format(new Date(iso)).replace(",", "");
const dayKey = (iso: string) => new Date(iso).toDateString();

/** The requests by the day they were asked, oldest first, numbered from 1. */
export function byDay(requests: RequestView[]) {
  const days: { label: string; rows: { req: RequestView; n: number }[] }[] = [];
  requests.forEach((req, i) => {
    const last = days.at(-1);
    const row = { req, n: i + 1 };
    const prev = requests[i - 1];
    if (last && prev && dayKey(prev.startedAt) === dayKey(req.startedAt))
      last.rows.push(row);
    else
      days.push({
        label: dayLabel(req.startedAt),
        rows: [row],
      });
  });
  return days;
}

const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** How long the session has run: "7 days", "3 h 07 m", "under a minute". */
export function sessionSpan(view: SessionView): string {
  const ms = Date.parse(view.lastEventAt) - Date.parse(view.startedAt);
  return ms < 86_400_000
    ? duration(view.startedAt, view.lastEventAt)
    : many(Math.round(ms / 86_400_000), "day");
}

/** "13 requests · 136 helpers · 7 days". */
export function sessionFacts(view: SessionView): string {
  const helpers = view.requests.reduce((n, r) => n + r.tally.helpers, 0);
  const span = sessionSpan(view);
  return [
    many(view.requests.length, "request"),
    ...(helpers ? [many(helpers, "helper")] : []),
    span === "under a minute" ? "just started" : span,
  ].join(" · ");
}

function StatusLine(props: { status: SessionStatus; ended?: boolean }) {
  const { status, ended } = props;
  if (ended && status !== "error")
    return (
      <span className="status-line muted" role="status">
        ended
      </span>
    );
  if (status === "live")
    return (
      <span className="status-line live-dot" role="status">
        live
      </span>
    );
  if (status === "reconnecting")
    return (
      <span className="status-line muted" role="status">
        reconnecting…
      </span>
    );
  if (status === "error")
    return (
      <span className="status-line" role="status">
        Session not found
      </span>
    );
  return null;
}

/** The rail's foot: the connection, who is signed in, and Settings. */
export function RailFoot(props: {
  status?: SessionStatus | undefined;
  ended?: boolean;
  me?: Me | undefined;
}) {
  const { status, ended, me } = props;
  return (
    <div className="rail-foot">
      {status && <StatusLine status={status} {...(ended ? { ended } : {})} />}
      {me && (
        <span className="user">
          {me.avatarUrl && <img src={me.avatarUrl} alt="" />}
          {me.login}
        </span>
      )}
      {me && (
        <a
          className="rail-settings"
          href="/settings"
          onClick={follow("/settings")}
        >
          Settings
        </a>
      )}
    </div>
  );
}

export function Brand() {
  return (
    <a className="rail-brand" href="/" onClick={follow("/")}>
      <i aria-hidden="true" />
      <span>Murmur</span>
    </a>
  );
}

/**
 * The left rail, the same on every page of a session: Murmur, the session and its facts,
 * then every request as a spine grouped by day, the shown one highlighted. Under 900 px it
 * is a drawer: open traps focus, and Escape closes it.
 */
export function Rail(props: {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
  /** The request on screen, and whether the page is that request's own. */
  currentId: string | undefined;
  onRequestPage: boolean;
  /** The session's own page (the journey): its running station is the loop, not the rail's. */
  onJourney?: boolean;
  /** The page has its own loop (a running task in the Tasks tab): the rail does not pulse. */
  ownLoop?: boolean;
  status: SessionStatus;
  me?: Me | undefined;
  /** Open as the drawer (under 900 px). */
  open: boolean;
  onClose(): void;
}) {
  const { sessionId, view, events, currentId, onRequestPage } = props;
  const { status, me, open, onClose, onJourney, ownLoop } = props;
  const box = useRef<HTMLElement>(null);
  const marks = useMemo(
    () => new Map(view.requests.map((r) => [r, requestMark(view, r, events)])),
    [view, events],
  );
  const now = new Date().toISOString();
  // One loop on screen: the newest running request's mark.
  const pulsing =
    onJourney || ownLoop
      ? undefined
      : view.requests.findLast((r) => marks.get(r)?.mark === "running");

  // The shown request scrolls into the rail's view when it changes, only if it is out of
  // view, so a click never jumps. New requests arriving live (appended below) never move
  // the list, so a reader scrolled elsewhere in it stays there. On the journey, with no
  // request shown, the newest one is placed: where the session is now.
  const placed = useRef<string>(undefined);
  useEffect(() => {
    const list = box.current?.querySelector<HTMLElement>(".spine");
    const key = currentId ?? (onJourney ? "journey" : undefined);
    const cur = currentId
      ? list?.querySelector<HTMLElement>(".stop.cur")
      : onJourney
        ? [...(list?.querySelectorAll<HTMLElement>(".stop") ?? [])].at(-1)
        : undefined;
    if (placed.current === key || !list || !cur) return;
    placed.current = key;
    // Rows sit in .spine-in, which starts at the top of the scrolled list; the
    // bottom 24 px is under the fade.
    const fade = 24;
    const seen =
      cur.offsetTop >= list.scrollTop &&
      cur.offsetTop + cur.offsetHeight <=
        list.scrollTop + list.clientHeight - fade;
    if (!seen)
      list.scrollTop = Math.max(
        0,
        cur.offsetTop - list.clientHeight / 2 + cur.offsetHeight / 2,
      );
  });

  // As a drawer: focus moves in, Tab stays in, Escape closes.
  useEffect(() => {
    const rail = box.current;
    if (!open || !rail) return;
    const stops = () =>
      [...rail.querySelectorAll<HTMLElement>("a[href], button")].filter(
        (el) => !el.hasAttribute("disabled"),
      );
    (rail.querySelector<HTMLElement>(".stop.cur") ?? stops()[0])?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const all = stops();
      const first = all[0];
      const last = all.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);

  const sub = (req: RequestView, mark: Mark, end: string) => {
    const helpers = req.tally.helpers
      ? [many(req.tally.helpers, "helper")]
      : [];
    const live = mark === "running" || mark === "waiting";
    const took = duration(req.startedAt, live ? now : end);
    return [
      ...(live ? [MARK_WORD[mark]] : []),
      took === "under a minute" ? "<1 m" : took,
      ...helpers,
    ].join(" · ");
  };

  return (
    <aside
      ref={box}
      id="rail"
      className={open ? "rail open" : "rail"}
      aria-label="This session"
      {...(open ? { role: "dialog", "aria-modal": true } : {})}
    >
      <Brand />
      <a
        className="rail-sess"
        href={sessionPath(sessionId)}
        onClick={follow(sessionPath(sessionId))}
        title={view.requests[0]?.prompt ?? view.title}
        aria-current={onJourney ? "page" : undefined}
      >
        <span className="sess-ttl">{view.title || "Untitled session"}</span>
        <span className="sess-sub">{sessionFacts(view)}</span>
      </a>
      <nav className="spine" aria-label="Requests">
        <div className="spine-in">
          {byDay(view.requests).map((day) => (
            <Fragment key={`${day.label}-${day.rows[0]?.n}`}>
              <h3 className="day">{day.label}</h3>
              <ol>
                {day.rows.map(({ req, n }) => {
                  const { mark, end } = marks.get(req) ?? {
                    mark: "done" as const,
                    end: now,
                  };
                  const cur = req.id === currentId;
                  const short = requestShort(req);
                  const path = requestPath(sessionId, req.id);
                  const showSub =
                    cur || mark === "running" || mark === "waiting";
                  return (
                    <li key={req.id}>
                      <a
                        className={cur ? `stop ${mark} cur` : `stop ${mark}`}
                        href={path}
                        title={req.goal || req.prompt}
                        data-tip={`${short} · ${MARK_WORD[mark]}`}
                        aria-current={
                          cur ? (onRequestPage ? "page" : "true") : undefined
                        }
                        onClick={follow(path)}
                        data-morph=""
                      >
                        <StateMark mark={mark} pulse={req === pulsing} />
                        <span className="stop-txt">
                          <span className="stop-ttl">
                            <b className="num stop-n">{n}</b>
                            {short}
                          </span>
                          {showSub && (
                            <span className="stop-sub">
                              {sub(req, mark, end)}
                            </span>
                          )}
                        </span>
                        {/* Running and waiting say their word in the sub line. */}
                        {mark !== "running" && mark !== "waiting" && (
                          <span className="sr-only">, {MARK_WORD[mark]}</span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ol>
            </Fragment>
          ))}
        </div>
      </nav>
      <RailFoot status={status} ended={view.ended} me={me} />
    </aside>
  );
}
