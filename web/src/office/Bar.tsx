// The office's bars and lists: the session switcher, the request picker and the requests
// rail (one list, grouped by day), the now line, and the menu with the account's links.
import type { MurmurEvent, RequestView, SessionView } from "@murmur/core";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type Me, type SessionRow } from "../api";
import { ago, byDay } from "../format";
import { StateMark, Words } from "../marks";
import { EventView } from "../part/EventView";
import { floorPath, follow, navigate } from "../router";
import { nowLine, requestShort, type Waiting } from "../session";
import {
  isOver,
  listedNow,
  type RequestNow,
  requestNow,
  type SessionNow,
  sessionNow,
} from "../state";

/**
 * Closes an open popover on Escape (focus back on its button) or a click outside it. Its
 * Escape is its own: the office's keys (closing the panel) do not hear it.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  box: React.RefObject<HTMLElement | null>,
  btn: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      btn.current?.focus();
    };
    const click = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [open, close, box, btn]);
}

/** A button with a popover under it, closed by Escape, a click outside, or a pick. */
function Pop(props: {
  className: string;
  label: string;
  title?: string;
  button: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  onOpen?(): void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, box, btn);
  return (
    <div className={`of-pop-wrap ${props.className}`} ref={box}>
      <button
        ref={btn}
        type="button"
        className="of-pop-btn"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={props.label}
        title={props.title ?? props.label}
        onClick={() => {
          if (!open) props.onOpen?.();
          setOpen(!open);
        }}
      >
        {props.button}
      </button>
      {open && <div className="of-pop">{props.children(close)}</div>}
    </div>
  );
}

const folder = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? cwd;

/** The session's title as a menu of the recent sessions: another one is two clicks away. */
export function SessionSwitcher(props: { sessionId: string; title: string }) {
  const [rows, setRows] = useState<SessionRow[] | null | "failed">(null);
  const load = () =>
    api.sessions().then(
      (r) => setRows(r.sessions),
      () => setRows("failed"),
    );
  const now = Date.now();
  return (
    <Pop
      className="of-switch"
      label={`Session: ${props.title}. Switch session`}
      title="Switch session"
      onOpen={load}
      button={
        <>
          <span className="of-switch-t">{props.title}</span>
          <span className="of-caret" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <nav aria-label="Recent sessions">
          <p className="of-pop-k">Recent sessions</p>
          {rows === "failed" ? (
            <p className="of-pop-note">Could not load the sessions.</p>
          ) : !rows ? (
            <p className="of-pop-note">Loading…</p>
          ) : (
            <ul className="of-sess-list">
              {rows.slice(0, 12).map((s) => {
                const path = floorPath(s.sessionId, undefined);
                const l = listedNow(s, now);
                return (
                  <li key={s.sessionId}>
                    <a
                      href={path}
                      className="of-sess-row"
                      aria-current={
                        s.sessionId === props.sessionId ? "true" : undefined
                      }
                      onClick={(e) => {
                        close();
                        follow(path)(e);
                      }}
                    >
                      <span className="of-sess-t">{l.title}</span>
                      <span className="of-sess-m">
                        <span className={`of-sess-st ${l.tag}`}>{l.word}</span>
                        {[
                          folder(s.cwd),
                          s.machineName,
                          l.facts,
                          ago(s.lastEventAt, now),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          <a
            className="of-pop-foot"
            href="/"
            onClick={(e) => {
              close();
              follow("/")(e);
            }}
          >
            All sessions
          </a>
        </nav>
      )}
    </Pop>
  );
}

const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * Every request of the session by the day it was asked: its number, short title, state,
 * how long it took and its helpers. The rail, the request picker and the Requests view.
 */
export function RequestList(props: {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
  /** The request on the floor. */
  currentId: string;
  /** The floor Claude is on: its row's link follows the session. */
  activeId: string | undefined;
  /** The session at the moment shown (default: live, now): a quiet one's running request is paused. */
  ses?: SessionNow | undefined;
  /** The `open` a row's link keeps. */
  keep: string | null;
  onPick(requestId: string): void;
  label?: string;
}) {
  const { sessionId, view, events, currentId, activeId, keep, onPick } = props;
  // Each request as every view reads it (state.ts): a quiet session's running one is paused.
  const marks = useMemo(() => {
    const ses = props.ses ?? sessionNow(view);
    return new Map(
      view.requests.map((r) => [r, requestNow(view, r, events, ses)]),
    );
  }, [view, events, props.ses]);
  const box = useRef<HTMLElement>(null);
  // The floor's row comes into view when the floor changes, only if it is out of view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed per floor
  useEffect(() => {
    const cur = box.current?.querySelector<HTMLElement>("[aria-current]");
    cur?.scrollIntoView?.({ block: "nearest" });
  }, [currentId]);
  const sub = (req: RequestView, rn: RequestNow) =>
    [
      // Its state's own span, as the bar's pill times it: a wait from when it began.
      ...(isOver(rn.state) ? [] : [rn.word]),
      rn.clock,
      ...(req.tally.helpers ? [many(req.tally.helpers, "helper")] : []),
    ].join(" · ");
  return (
    <nav className="of-rl" aria-label={props.label ?? "Requests"} ref={box}>
      {byDay(view.requests).map((day) => (
        <Fragment key={`${day.label}-${day.rows[0]?.n}`}>
          <h3 className="of-rl-day">{day.label}</h3>
          <ol>
            {day.rows.map(({ req, n }) => {
              const rn = marks.get(req);
              const mark = rn?.mark ?? "done";
              const cur = req.id === currentId;
              const path = floorPath(
                sessionId,
                req.id === activeId ? undefined : req.id,
                keep,
              );
              return (
                <li key={req.id}>
                  <a
                    className={`of-rl-row ${mark}${cur ? " cur" : ""}`}
                    href={path}
                    title={req.goal || req.prompt}
                    aria-current={cur ? "true" : undefined}
                    onClick={(e) => {
                      if (
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey ||
                        e.button !== 0
                      )
                        return;
                      e.preventDefault();
                      onPick(req.id);
                    }}
                  >
                    <StateMark mark={mark} />
                    <span className="of-rl-txt">
                      <span className="of-rl-t">
                        <b className="of-rl-n">{n}</b>
                        <Words text={requestShort(req)} />
                      </span>
                      {rn && <span className="of-rl-sub">{sub(req, rn)}</span>}
                    </span>
                    {rn && isOver(rn.state) && (
                      <span className="sr-only">, {rn.word}</span>
                    )}
                  </a>
                </li>
              );
            })}
          </ol>
        </Fragment>
      ))}
    </nav>
  );
}

/** The request picker: the floor's request, the whole list one click away. */
export function RequestPicker(
  props: React.ComponentProps<typeof RequestList> & {
    n: number;
    short: string;
  },
) {
  const { n, short, ...list } = props;
  return (
    <Pop
      className="of-picker"
      label={`Request ${n} of ${list.view.requests.length}: ${short}. Pick another request`}
      title="Every request in this session"
      button={
        <>
          <span className="of-req-n">
            Request {n} of {list.view.requests.length}
          </span>
          <span className="of-req-title">{short}</span>
          <span className="of-caret" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <RequestList
          {...list}
          onPick={(id) => {
            close();
            list.onPick(id);
          }}
        />
      )}
    </Pop>
  );
}

/** The now line: what Claude is doing (or, over, what it did in all), its why one click away. */
export function NowLine(props: {
  request: RequestView;
  done: boolean;
  events: MurmurEvent[];
  cwd: string;
  /** Waiting on you: the line says what Claude asked, not its last narration. */
  waiting?: Waiting | null | undefined;
  /** Paused (state.ts): its now is its last word, not what Claude is doing. */
  paused?: boolean | undefined;
}) {
  const { request, done, events, cwd } = props;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, box, btn);
  const said = nowLine(request, events, done, props.waiting);
  const line =
    props.paused && said.label === "Now" ? { ...said, label: "Last" } : said;
  const more = !!(line.src || line.why);
  return (
    <section className="of-now" aria-label={line.label} ref={box}>
      <span className="of-now-k">{line.label}</span>
      <span className="of-now-t" title={line.text}>
        {line.text}
      </span>
      {more && (
        <button
          ref={btn}
          type="button"
          className="of-now-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {line.why ? "Why now" : "Source"}
          <span className="of-caret" aria-hidden="true" />
        </button>
      )}
      {open && more && (
        <div className="of-pop of-now-pop">
          {line.why && (
            <p className="now-why">
              <b>Why now:</b> {line.why}
            </p>
          )}
          {line.src && (
            <EventView
              eventId={line.src.id}
              events={events}
              cwd={cwd}
              agents={request.agents}
              quietTitle
            />
          )}
        </div>
      )}
    </section>
  );
}

/** Two clicks: "Delete session", then "Delete?" within 5 s. */
function DeleteSession({ sessionId }: { sessionId: string }) {
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function click() {
    setFailed(false);
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 5000);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    try {
      await api.deleteSession(sessionId);
    } catch (e) {
      // Already gone counts as deleted.
      if (!(e instanceof ApiError && e.status === 404)) return setFailed(true);
    }
    navigate("/");
  }
  return (
    <>
      <button
        type="button"
        className={armed ? "of-menu-item danger armed" : "of-menu-item danger"}
        onClick={click}
      >
        {armed ? "Delete?" : "Delete session"}
      </button>
      {(armed || failed) && (
        <p
          className={failed ? "of-pop-note error" : "of-pop-note"}
          role={failed ? "alert" : undefined}
        >
          {failed
            ? "Could not delete this session. Try again."
            : "If Claude is still running here, new activity will start this session again."}
        </p>
      )}
    </>
  );
}

/** The menu: who is signed in, Settings, Sign out, and deleting the session. */
export function Menu(props: {
  sessionId: string;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, me, onSignOut } = props;
  return (
    <Pop
      className="of-menu"
      label="Menu"
      button={
        <svg viewBox="0 0 16 16" aria-hidden="true" className="of-dots">
          <rect x="2" y="7" width="2" height="2" />
          <rect x="7" y="7" width="2" height="2" />
          <rect x="12" y="7" width="2" height="2" />
        </svg>
      }
    >
      {() => (
        <>
          {me && (
            <nav aria-label="Account">
              <span className="of-menu-who">
                {me.avatarUrl && <img src={me.avatarUrl} alt="" />}
                {me.login}
              </span>
              <a
                className="of-menu-item"
                href="/settings"
                onClick={follow("/settings")}
              >
                Settings
              </a>
              {onSignOut && (
                <button
                  type="button"
                  className="of-menu-item"
                  onClick={onSignOut}
                >
                  Sign out
                </button>
              )}
            </nav>
          )}
          <DeleteSession sessionId={sessionId} />
        </>
      )}
    </Pop>
  );
}
