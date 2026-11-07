import { catchUp, type MurmurEvent, type SessionView } from "@murmur/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useLastLooked } from "../lastLooked";
import { Assumptions } from "../live/Assumptions";
import { Notices } from "../live/Notices";
import { NowCard } from "../live/NowCard";
import { PhaseStrip } from "../live/PhaseStrip";
import { PlanPanel } from "../live/PlanPanel";
import { RequestList } from "../live/RequestList";
import { RequestHead, type RequestStatus, Story } from "../live/Story";
import { MapView } from "../map/MapView";
import { navigate } from "../router";
import { type SessionStatus, useSession } from "../useSession";

export function SessionPage(props: {
  sessionId: string;
  requestId?: string | undefined;
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

const enc = encodeURIComponent;

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

function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="notice-row" />
      <div className="sk sk-strip" />
      <div className="sk-grid">
        <div className="sk sk-now" />
        <div className="sk sk-plan" />
        <div className="sk sk-map" />
      </div>
    </div>
  );
}

/** The live screen before anything has loaded, also shown while /api/me loads. */
export function LiveSkeleton({ status }: { status?: SessionStatus }) {
  return (
    <main className="live-page">
      {status !== "error" && (
        <div className="sk-requests" aria-hidden="true">
          <div className="sk sk-req" />
          <div className="sk sk-req" />
        </div>
      )}
      <div className="live-main">
        {/* Same rows as the loaded screen, so nothing jumps when data lands. */}
        <div className="live-top">
          {status !== "error" && (
            <div className="sk sk-title" aria-hidden="true" />
          )}
          {status && <StatusLine status={status} />}
        </div>
        {status !== "error" && <Skeleton />}
      </div>
    </main>
  );
}

/** The live screen for one session; SessionPage feeds it from the stream. */
export function Live(props: {
  sessionId: string;
  requestId?: string | undefined;
  view: SessionView | null;
  viewAt(ts: string): SessionView | null;
  events?: MurmurEvent[];
  status: SessionStatus;
  lastLooked: string | null;
}) {
  const { sessionId, view, viewAt, events = [], status, lastLooked } = props;
  // Relative times ("14 min ago") move on even when no events arrive.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!view) return <LiveSkeleton status={status} />;

  const wanted = view.requests.find((r) => r.id === props.requestId);
  // A deep link to a request the first pages have not reached yet waits for it.
  if (props.requestId && !wanted && status === "loading")
    return <LiveSkeleton status={status} />;
  const req = wanted ?? view.requests.at(-1);
  return (
    <main className="live-page">
      {req && (
        <RequestList
          requests={view.requests}
          selectedId={req.id}
          onSelect={(id) => navigate(`/s/${enc(sessionId)}/r/${enc(id)}`)}
        />
      )}
      <div className="live-main">
        <div className="live-top">
          <h1 className="live-title">
            {req?.goal || req?.prompt || view.title}
          </h1>
          <StatusLine status={status} ended={view.ended} />
          <DeleteSession sessionId={sessionId} />
        </div>
        {req ? (
          <RequestScreen
            key={req.id}
            sessionId={sessionId}
            view={view}
            viewAt={viewAt}
            events={events}
            lastLooked={lastLooked}
            requestId={req.id}
          />
        ) : (
          <p className="muted">Waiting for the first prompt in this session.</p>
        )}
      </div>
    </main>
  );
}

function RequestScreen(props: {
  sessionId: string;
  view: SessionView;
  viewAt(ts: string): SessionView | null;
  events: MurmurEvent[];
  lastLooked: string | null;
  requestId: string;
}) {
  const { sessionId, view, viewAt, events, lastLooked, requestId } = props;
  const req = view.requests.find((r) => r.id === requestId);
  const [phaseId, setPhaseId] = useState<string>();
  const [partId, setPartId] = useState<string>();
  const before = lastLooked ? viewAt(lastLooked) : null;
  const since = useMemo(
    () => (before ? catchUp(before, view, requestId) : null),
    [before, view, requestId],
  );
  if (!req) return null;
  const open = (part: string) =>
    navigate(`/s/${enc(sessionId)}/r/${enc(req.id)}/p/${enc(part)}`);
  const k = view.requests.indexOf(req);
  const next = view.requests[k + 1];
  // The request's last activity: its last event before the next prompt.
  const last = events.findLast(
    (e) => e.ts >= req.startedAt && (!next || e.ts < next.startedAt),
  );
  const end = last?.ts ?? next?.startedAt ?? view.lastEventAt;
  // Claude ended its turn and no helper is still at work: done, until a new prompt.
  const stopped =
    last?.hook === "Stop" && !req.agents.some((a) => a.status === "running");
  const done = req.finished || view.ended || stopped;
  const state: RequestStatus = done
    ? "done"
    : view.needsYou && !next
      ? "needs"
      : "running";
  const story = (req.messages?.length ?? 0) > 1;
  const plan = (
    <PlanPanel
      request={req}
      hoverPart={partId}
      onHover={setPartId}
      onOpen={open}
    />
  );
  const map = (
    <section className="map-panel" aria-label="Map">
      <h2 className="lbl">How it ties together</h2>
      <div className="map-box">
        <MapView
          request={req}
          highlight={{
            ...(partId ? { partId } : {}),
            ...(phaseId ? { phaseId } : {}),
          }}
          onOpenPart={open}
        />
      </div>
    </section>
  );
  const assumptions = (
    <Assumptions sessionId={sessionId} assumptions={req.assumptions} />
  );

  return (
    <>
      <RequestHead request={req} status={state} end={end}>
        <Notices
          needsYou={view.needsYou}
          flags={req.flags}
          parts={req.parts}
          catchUp={since}
          since={lastLooked}
          needsSaid={state === "needs"}
        />
      </RequestHead>
      <PhaseStrip
        finished={req.finished}
        phases={req.phases}
        inferred={req.planInferred}
        selected={phaseId}
        onSelect={setPhaseId}
      />
      {story ? (
        <>
          <div className="story-grid">
            <Story request={req} onOpenPart={open} />
            <aside className="story-side">
              {!done && (
                <NowCard request={req} cwd={view.cwd} events={events} />
              )}
              {plan}
              {assumptions}
            </aside>
          </div>
          {map}
        </>
      ) : (
        <div className="live-grid">
          <NowCard request={req} cwd={view.cwd} events={events} />
          {plan}
          {map}
          {assumptions}
        </div>
      )}
    </>
  );
}
