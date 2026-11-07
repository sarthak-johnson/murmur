import type { MurmurEvent, RequestView, SessionView } from "@murmur/core";
import { useEffect, useRef, useState } from "react";
import { EventView } from "../part/EventView";
import { navigate } from "../router";
import {
  livePhase,
  nowLine,
  phasePlace,
  type RequestState,
  type Waiting,
  waitingLabel,
} from "../session";
import { duration } from "../story";

const enc = encodeURIComponent;

const KIND: Record<RequestView["kind"], string> = {
  feature: "Feature",
  bug: "Bug hunt",
  refactor: "Refactor",
  question: "Question",
};

const STATE: Record<RequestState, string> = {
  running: "Running",
  waiting: "Waiting",
  done: "Done",
};

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

function RequestSwitcher(props: {
  requests: RequestView[];
  selectedId: string;
  onSelect(id: string): void;
}) {
  const { requests, selectedId, onSelect } = props;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    const click = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [open]);
  const k = requests.findIndex((r) => r.id === selectedId);
  return (
    <div className="switch" ref={box}>
      <button
        ref={btn}
        type="button"
        className="switch-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <span className="num">
          Request {k + 1} of {requests.length}
        </span>
        <svg className="g chev" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4.5 6.5 8 10l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <nav className="switch-menu" aria-label="Requests">
          <ul>
            {[...requests].reverse().map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="request"
                  aria-current={r.id === selectedId ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onSelect(r.id);
                  }}
                >
                  <span className="kind">
                    {!r.finished && <i className="live-mark" />}
                    {KIND[r.kind]}
                    {r.kindInferred && (
                      <span className="inferred">inferred</span>
                    )}
                  </span>
                  <span className="clamp">{r.goal || r.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/** The now line: what Claude is doing, its why or source one click away. */
function NowCell(props: {
  request: RequestView;
  done: boolean;
  events: MurmurEvent[];
  cwd: string;
}) {
  const { request, done, events, cwd } = props;
  const [open, setOpen] = useState(false);
  const line = nowLine(request, events, done);
  const more = !!(line.src || line.why);
  return (
    <section className="cell grow now-cell" aria-label="Now">
      <span className="k">{line.label}</span>
      <span className="v" title={line.text}>
        {line.text}
      </span>
      {more && (
        <button
          type="button"
          className="link now-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Details
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

/** The bar pinned across the page: state, now, where in the plan, and whether it needs you. */
export function TopBar(props: {
  sessionId: string;
  view: SessionView;
  request: RequestView | undefined;
  state: RequestState;
  waiting: Waiting | null;
  events: MurmurEvent[];
  /** The task page shows the same bar; its needs-you chip goes back to the request. */
  onTaskPage?: boolean;
}) {
  const { sessionId, view, request, state, waiting, events, onTaskPage } =
    props;
  const done = state === "done";
  const tasks = request?.phases.flatMap((p) => p.tasks) ?? [];
  const live = request && livePhase(request, done);
  const shownPhase = live ?? request?.phases.at(-1);
  const base = request ? `/s/${enc(sessionId)}/r/${enc(request.id)}` : "";
  return (
    <header className="bar">
      <div className="bar-brand">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <i aria-hidden="true" />
          Murmur
        </a>
        {request && view.requests.length > 1 && (
          <RequestSwitcher
            requests={view.requests}
            selectedId={request.id}
            onSelect={(id) => navigate(`/s/${enc(sessionId)}/r/${enc(id)}`)}
          />
        )}
      </div>
      {request && (
        <>
          <div className="cell">
            <span className={`state ${state}`}>
              <i aria-hidden="true" />
              {STATE[state]}
            </span>
          </div>
          <NowCell
            request={request}
            done={done}
            events={events}
            cwd={view.cwd}
          />
          {request.phases.length > 0 && shownPhase && (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the bar
            <div className="cell progress" role="group" aria-label="Progress">
              <span className="k">{phasePlace(request, shownPhase)}</span>
              <span className="mt" aria-hidden="true">
                {tasks.map((t) => (
                  <b
                    key={t.id}
                    className={`seg ${
                      t.status === "failed"
                        ? "bad"
                        : done && t.status !== "done"
                          ? "open"
                          : t.status
                    }`}
                  />
                ))}
              </span>
              <span className="v num">
                {tasks.filter((t) => t.status === "done").length}/{tasks.length}
              </span>
            </div>
          )}
          {waiting && (
            <a
              className="cell need"
              href={onTaskPage ? base : "#needs"}
              onClick={(e) => {
                if (!onTaskPage) return;
                e.preventDefault();
                navigate(base);
              }}
            >
              <NeedIcon />
              {waitingLabel(waiting)}
              <span className="num">
                {duration(waiting.since, new Date().toISOString())}
              </span>
            </a>
          )}
        </>
      )}
    </header>
  );
}
