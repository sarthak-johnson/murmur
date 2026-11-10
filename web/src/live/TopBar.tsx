import type {
  MurmurEvent,
  PartView,
  RequestView,
  SessionView,
} from "@murmur/core";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Me } from "../api";
import { EventView } from "../part/EventView";
import { follow, navigate, requestPath, sessionPath } from "../router";
import {
  type Mark,
  nowLine,
  type RequestState,
  requestShort,
  shortTitle,
  type Waiting,
  waitingLabel,
} from "../session";
import { duration, nOf } from "../story";
import { StateMark } from "./Rail";

/** The amber "needs you" mark: a ring with a dot. */
export function NeedIcon() {
  return (
    <svg className="g" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 4.6v4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.2" r="1" fill="currentColor" />
    </svg>
  );
}

/** Closes an open popover on Escape (focus back on its button) or a click outside it. */
function useDismiss(
  open: boolean,
  close: () => void,
  box: React.RefObject<HTMLElement | null>,
  btn: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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

/** The now line: what Claude is doing, its why or source one click away. */
function NowLine(props: {
  request: RequestView;
  done: boolean;
  events: MurmurEvent[];
  cwd: string;
}) {
  const { request, done, events, cwd } = props;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), box, btn);
  const line = nowLine(request, events, done);
  const more = !!(line.src || line.why);
  return (
    <section className="nowline" aria-label="Now" ref={box}>
      <span className="k">{line.label}</span>
      <span className="txt" title={line.text}>
        {line.text}
      </span>
      {more && (
        <button
          ref={btn}
          type="button"
          className="now-more"
          aria-label="Details"
          title="Details"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <svg className="chev" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 6.5 8 10l3.5-3.5" />
          </svg>
        </button>
      )}
      {open && more && (
        <div className="now-pop">
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
        className={armed ? "menu-item danger armed" : "menu-item danger"}
        onClick={click}
      >
        {armed ? "Delete?" : "Delete session"}
      </button>
      {(armed || failed) && (
        <p
          className={failed ? "menu-note error" : "menu-note"}
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

/** The session's menu: the account's links and deleting the session. */
function SessionMenu(props: {
  sessionId: string;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, me, onSignOut } = props;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), box, btn);
  return (
    <div className="menu" ref={box}>
      <button
        ref={btn}
        type="button"
        className="icon-btn"
        aria-label="Session menu"
        title="Session menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.5" cy="8" r="1.3" />
        </svg>
      </button>
      {open && (
        <div className="menu-pop">
          {me && (
            <nav aria-label="Account">
              <span className="menu-who">
                {me.avatarUrl && <img src={me.avatarUrl} alt="" />}
                {me.login}
              </span>
              <a
                className="menu-item"
                href="/settings"
                onClick={follow("/settings")}
              >
                Settings
              </a>
              {onSignOut && (
                <button type="button" className="menu-item" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </nav>
          )}
          <DeleteSession sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}

const PILL: Record<Mark, string> = {
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  open: "Left open",
  failed: "Failed",
};

const took = (from: string, to: string) => {
  const d = duration(from, to);
  return d === "under a minute" ? "<1 m" : d;
};

interface Crumb {
  label: string;
  /** Unset on the last level: where you are is not a link. */
  href?: string;
  title?: string;
}

/** Where you are: Session › Request n › Phase › Task, only the levels that apply. */
export function crumbs(p: {
  sessionId: string;
  view: SessionView;
  request: RequestView | undefined;
  part: PartView | undefined;
  /** On /s/:sid, before any request is picked. */
  onSession: boolean;
}): Crumb[] {
  const { sessionId, view, request, part, onSession } = p;
  const folder = view.cwd.split("/").filter(Boolean).pop() ?? "Session";
  // Core's title is already the first prompt cut at a word; the full prompt on hover.
  const session = view.title || folder;
  const prompt = view.requests[0]?.prompt ?? view.title;
  if (onSession || !request)
    return [
      { label: "Sessions", href: "/" },
      { label: session, title: prompt },
    ];
  const n = view.requests.indexOf(request) + 1;
  const req: Crumb = {
    label: `${n} · ${requestShort(request)}`,
    title: request.goal || request.prompt,
  };
  const top: Crumb = {
    label: session,
    href: sessionPath(sessionId),
    title: prompt,
  };
  if (!part) return [top, req];
  const base = requestPath(sessionId, request.id);
  const tasks = request.phases.flatMap((ph) => ph.tasks);
  const task = tasks.find((t) => t.part === part.id);
  const phase = request.phases.find((ph) => task && ph.tasks.includes(task));
  const name = shortTitle(part.title);
  return [
    top,
    { ...req, href: base },
    ...(phase
      ? [{ label: phase.title, href: `${base}#phase-${phase.id}` }]
      : []),
    {
      label: task ? `Task ${tasks.indexOf(task) + 1} · ${name}` : name,
      title: part.title,
    },
  ];
}

/**
 * The bar pinned over the page: where you are on the left; on the right the now line, the
 * amber chip only when Claude waits on you, the state pill and the session's menu.
 */
export function TopBar(props: {
  sessionId: string;
  view: SessionView;
  request: RequestView | undefined;
  part: PartView | undefined;
  onSession: boolean;
  state: RequestState;
  /** How it stands as the rail marks it (core's state): the pill's word and colour. */
  mark: Mark;
  /** The request's last activity, for how long a finished one took. */
  end: string;
  waiting: Waiting | null;
  events: MurmurEvent[];
  drawerOpen: boolean;
  onRequests(): void;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, view, request, part, onSession, state, mark, end } = props;
  const { waiting, events, drawerOpen, onRequests, me, onSignOut } = props;
  const now = new Date().toISOString();
  const base = request ? requestPath(sessionId, request.id) : "";
  const levels = crumbs({ sessionId, view, request, part, onSession });
  const since =
    state === "waiting" && waiting
      ? waiting.since
      : (request?.startedAt ?? view.startedAt);
  const helping =
    state === "waiting"
      ? (request?.agents.filter((a) => a.status === "running").length ?? 0)
      : 0;
  return (
    <header className={`top ${state}`}>
      <button
        type="button"
        id="rail-toggle"
        className="rail-toggle"
        aria-controls="rail"
        aria-expanded={drawerOpen}
        onClick={onRequests}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
        Requests
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          {levels.map((c) => (
            <li key={`${c.label}:${c.href ?? ""}`}>
              {c.href ? (
                <a
                  href={c.href}
                  title={c.title ?? c.label}
                  onClick={follow(c.href)}
                >
                  {c.label}
                </a>
              ) : (
                <span aria-current="page" title={c.title ?? c.label}>
                  {c.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {request && (
        <NowLine
          request={request}
          done={state === "done"}
          events={events}
          cwd={view.cwd}
        />
      )}
      <div className="top-right">
        {request && waiting && (
          <a
            className="need-chip"
            href={part ? base : "#needs"}
            onClick={part ? follow(base) : undefined}
          >
            <NeedIcon />
            {waitingLabel(waiting)}
            <span className="num">{took(waiting.since, now)}</span>
          </a>
        )}
        {request && (
          <span className={`state-pill ${mark}`}>
            <StateMark mark={mark} />
            <span className="num">
              <span>{PILL[mark]}</span>
              {" · "}
              {helping
                ? `${nOf(helping, "helper")} still working`
                : took(since, state === "done" ? end : now)}
            </span>
          </span>
        )}
        <SessionMenu sessionId={sessionId} me={me} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
