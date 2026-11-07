import type { MurmurEvent, RequestView, SessionView } from "@murmur/core";
import { useEffect, useReducer, useRef, useState } from "react";
import { ApiError, api, type Me } from "../api";
import { type Brief, catchUpBrief } from "../catchup";
import { FileList, PathText } from "../files";
import { useLastLooked } from "../lastLooked";
import { Assumptions } from "../live/Assumptions";
import { BriefBlock } from "../live/Brief";
import { PlanColumn } from "../live/PlanColumn";
import { Story, storyPhases } from "../live/Story";
import { TopBar } from "../live/TopBar";
import { MapView } from "../map/MapView";
import { PartDetail } from "../part/PartDetail";
import { navigate } from "../router";
import {
  livePhase,
  type RequestState,
  requestState,
  type Waiting,
  waitingOn,
} from "../session";
import { clock, sentBack } from "../story";
import { type SessionStatus, useSession } from "../useSession";

const enc = encodeURIComponent;
const MINUS = "−";

export function SessionPage(props: {
  sessionId: string;
  requestId?: string | undefined;
  partId?: string | undefined;
  me?: Me;
  onSignOut?(): void;
}) {
  const { view, viewAt, status, events } = useSession(props.sessionId);
  const lastLooked = useLastLooked(props.sessionId);
  return (
    <Live
      {...props}
      view={view}
      events={events}
      viewAt={viewAt}
      status={status}
      lastLooked={lastLooked}
    />
  );
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
    <span className="delete-session">
      <button type="button" className="link" onClick={click}>
        {armed ? "Delete?" : "Delete session"}
      </button>
      {(armed || failed) && (
        <span
          className={failed ? "delete-note error" : "delete-note"}
          role={failed ? "alert" : undefined}
        >
          {failed
            ? "Could not delete this session. Try again."
            : "If Claude is still running here, new activity will start this session again."}
        </span>
      )}
    </span>
  );
}

/** The plan column's foot: the connection, who is signed in, and the session's actions. */
function Footer(props: {
  sessionId: string;
  status: SessionStatus;
  ended?: boolean;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, status, ended, me, onSignOut } = props;
  return (
    <div className="spine-foot">
      <StatusLine status={status} {...(ended ? { ended } : {})} />
      {me && (
        <span className="user">
          {me.avatarUrl && <img src={me.avatarUrl} alt="" />}
          {me.login}
        </span>
      )}
      <nav aria-label="Account">
        <a
          href="/settings"
          onClick={(e) => {
            e.preventDefault();
            navigate("/settings");
          }}
        >
          Settings
        </a>
        {onSignOut && (
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </nav>
      <DeleteSession sessionId={sessionId} />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="sk sk-title" />
      <div className="sk sk-facts" />
      <div className="sk sk-brief" />
      <div className="sk sk-line" />
      <div className="sk sk-line" />
    </div>
  );
}

/** The frame before anything has loaded, also shown while /api/me loads. */
export function LiveSkeleton(props: { status?: SessionStatus; note?: string }) {
  const { status, note } = props;
  return (
    <div className="frame">
      <header className="bar">
        <div className="bar-brand">
          <span className="brand">
            <i aria-hidden="true" />
            Murmur
          </span>
        </div>
        {note && (
          <span className="cell muted" role="status">
            {note}
          </span>
        )}
      </header>
      <aside className="spine" aria-hidden={status === "error" || undefined}>
        {status !== "error" && (
          <div className="sk-spine" aria-hidden="true">
            <div className="sk sk-ph" />
            <div className="sk sk-ph" />
          </div>
        )}
        {status && (
          <div className="spine-foot">
            <StatusLine status={status} />
          </div>
        )}
      </aside>
      <main className="main">{status !== "error" && <Skeleton />}</main>
    </div>
  );
}

/** The live screen for one session; SessionPage feeds it from the stream. */
export function Live(props: {
  sessionId: string;
  requestId?: string | undefined;
  /** A task's page inside the same frame. */
  partId?: string | undefined;
  view: SessionView | null;
  viewAt(ts: string): SessionView | null;
  events?: MurmurEvent[];
  status: SessionStatus;
  lastLooked: string | null;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, view, viewAt, events = [], status, lastLooked } = props;
  const { partId, me, onSignOut } = props;
  // Relative times ("14 m ago") move on even when no events arrive.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  const [hoverPart, setHoverPart] = useState<string>();
  const [mode, setMode] = useViewMode();

  if (!view) return <LiveSkeleton status={status} />;
  const wanted = view.requests.find((r) => r.id === props.requestId);
  // A deep link to a request the first pages have not reached yet waits for it.
  if (props.requestId && !wanted && status === "loading")
    return <LiveSkeleton status={status} />;
  const req = wanted ?? view.requests.at(-1);
  const part = partId ? req?.parts.find((p) => p.id === partId) : undefined;
  // Nor does a task page wait-free: its part may be on a later page.
  if (partId && !part && status === "loading")
    return <LiveSkeleton status={status} />;

  const waiting = req ? waitingOn(view, req, events) : null;
  const { state, end } = req
    ? requestState(view, req, events, waiting)
    : { state: "running" as RequestState, end: view.lastEventAt };
  const done = state === "done";
  const base = req ? `/s/${enc(sessionId)}/r/${enc(req.id)}` : "";
  const open = (p: string) => navigate(`${base}/p/${enc(p)}`);
  const live = req ? livePhase(req, done) : undefined;
  const storied =
    req && !partId
      ? new Set(storyPhases(req, done).map((g) => g.phase.id))
      : undefined;
  const footer = (
    <Footer
      sessionId={sessionId}
      status={status}
      ended={view.ended}
      me={me}
      onSignOut={onSignOut}
    />
  );

  return (
    <div className="frame">
      <TopBar
        sessionId={sessionId}
        view={view}
        request={req}
        state={state}
        waiting={waiting}
        events={events}
        onTaskPage={!!partId}
      />
      {req ? (
        <PlanColumn
          request={req}
          done={done}
          end={end}
          events={events}
          partId={partId}
          {...(storied ? { storyPhases: storied } : {})}
          onOpen={open}
          onHover={setHoverPart}
          footer={footer}
        />
      ) : (
        <aside className="spine" aria-label="Plan">
          {footer}
        </aside>
      )}
      <main className="main" id="main" tabIndex={-1}>
        {!req ? (
          <p className="muted">Waiting for the first prompt in this session.</p>
        ) : partId ? (
          part ? (
            <PartDetail
              sessionId={sessionId}
              cwd={view.cwd}
              request={req}
              part={part}
              events={events}
              onBack={() => navigate(base)}
            />
          ) : (
            <>
              <p>This part is not in the map yet.</p>
              <button
                type="button"
                className="link"
                onClick={() => navigate(base)}
              >
                ‹ Back to the request
              </button>
            </>
          )
        ) : (
          <RequestMain
            key={req.id}
            sessionId={sessionId}
            view={view}
            viewAt={viewAt}
            events={events}
            lastLooked={lastLooked}
            status={status}
            mode={mode}
            setMode={setMode}
            request={req}
            waiting={waiting}
            live={live}
            done={done}
            hoverPart={hoverPart}
            onOpenPart={open}
          />
        )}
      </main>
    </div>
  );
}

type ViewMode = "story" | "map";
const VIEW = "murmur:view";
/** The viewer's Story or Map choice, kept across requests and visits. */
function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, set] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW) === "map" ? "map" : "story";
    } catch {
      return "story";
    }
  });
  const choose = (m: ViewMode) => {
    set(m);
    try {
      localStorage.setItem(VIEW, m);
    } catch {}
  };
  return [mode, choose];
}

const n_ = (n: number, one: string, many = `${one}s`) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

function RequestMain(props: {
  sessionId: string;
  view: SessionView;
  viewAt(ts: string): SessionView | null;
  events: MurmurEvent[];
  lastLooked: string | null;
  request: RequestView;
  waiting: Waiting | null;
  live: ReturnType<typeof livePhase>;
  done: boolean;
  hoverPart: string | undefined;
  status: SessionStatus;
  mode: ViewMode;
  setMode(mode: ViewMode): void;
  onOpenPart(partId: string): void;
}) {
  const { sessionId, view, viewAt, events, lastLooked, request: req } = props;
  const { status, mode, setMode } = props;
  const { waiting, live, done, hoverPart, onOpenPart } = props;
  const hasStory = (req.messages?.length ?? 0) > 0;
  // Built the first time the stream is live and kept still after, through reconnects,
  // so new work never moves the story under the reader; built again only when they
  // come back (a new last look). The past is reduced once, here, not on every batch.
  const [frozen, setFrozen] = useState<{
    looked: string | null;
    brief: Brief | null;
  }>();
  useEffect(() => {
    if (status !== "live" || (frozen && frozen.looked === lastLooked)) return;
    const before = lastLooked ? viewAt(lastLooked) : null;
    setFrozen({
      looked: lastLooked,
      brief: catchUpBrief(before, view, req.id, lastLooked),
    });
  }, [status, lastLooked, frozen, view, viewAt, req.id]);
  const brief = frozen?.looked === lastLooked ? frozen.brief : null;
  const tasks = req.phases.flatMap((p) => p.tasks).length;
  const back = sentBack(req);
  const facts = [
    ...n_(tasks, "task"),
    ...n_(req.tally.helpers, "helper"),
    ...n_(back, "sent back after review", "sent back after review"),
  ];
  const showMap = !hasStory || mode === "map";
  return (
    <>
      <h1 className="ask live-title" title={req.prompt}>
        {req.goal || req.prompt}
      </h1>
      <div className="asked-row">
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the facts */}
        <div className="asked" role="group" aria-label="Summary">
          <span className="num">
            Asked at <b>{clock(req.startedAt)}</b>
          </span>
          {facts.map((f) => {
            const [n, ...rest] = f.split(" ");
            return (
              <span key={f}>
                <b>{n}</b> {rest.join(" ")}
              </span>
            );
          })}
        </div>
        {hasStory && (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around two buttons
          <div className="view-toggle" role="group" aria-label="View">
            {(["story", "map"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "story" ? "Story" : "Map"}
              </button>
            ))}
          </div>
        )}
      </div>
      <BriefBlock
        brief={brief}
        since={lastLooked}
        waiting={waiting}
        flags={req.flags}
      />
      <Assumptions sessionId={sessionId} assumptions={req.assumptions} />
      {showMap ? (
        <section className="map-panel" aria-label="Map">
          <div className="sect">
            <h2>How it ties together</h2>
          </div>
          <div className="map-box">
            <MapView
              request={req}
              highlight={hoverPart ? { partId: hoverPart } : {}}
              onOpenPart={onOpenPart}
            />
          </div>
        </section>
      ) : (
        <Story request={req} live={live} done={done} onOpenPart={onOpenPart} />
      )}
      {req.looseFiles.length > 0 && (
        <section className="loose" aria-label="Files touched">
          <div className="sect">
            <h2>Files touched</h2>
            <span>outside any task</span>
          </div>
          <FileList
            files={req.looseFiles}
            events={events}
            label="Files touched"
            className="loose-files"
            row={(f) => (
              <li key={f.path}>
                <PathText path={f.path} cwd={view.cwd} />
                <span className={f.added ? "pd-add" : "pd-add zero"}>
                  +{f.added}
                </span>
                <span className={f.removed ? "pd-del" : "pd-del zero"}>
                  {MINUS}
                  {f.removed}
                </span>
                {f.role && <span className="muted">{f.role}</span>}
              </li>
            )}
          />
        </section>
      )}
    </>
  );
}
