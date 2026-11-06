import { catchUp, type SessionView } from "@murmur/core";
import { useEffect, useMemo, useReducer, useState } from "react";
import { useLastLooked } from "../lastLooked";
import { Assumptions } from "../live/Assumptions";
import { CatchUp } from "../live/CatchUp";
import { FlagsBar } from "../live/FlagsBar";
import { NowCard } from "../live/NowCard";
import { PhaseStrip } from "../live/PhaseStrip";
import { PlanPanel } from "../live/PlanPanel";
import { RequestList } from "../live/RequestList";
import { MapView } from "../map/MapView";
import { navigate } from "../router";
import { type SessionStatus, useSession } from "../useSession";

export function SessionPage(props: {
  sessionId: string;
  requestId?: string | undefined;
}) {
  const { view, viewAt, status } = useSession(props.sessionId);
  const lastLooked = useLastLooked(props.sessionId);
  return (
    <Live
      {...props}
      view={view}
      viewAt={viewAt}
      status={status}
      lastLooked={lastLooked}
    />
  );
}

const enc = encodeURIComponent;

function StatusLine({ status }: { status: SessionStatus }) {
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

/** The live screen for one session; SessionPage feeds it from the stream. */
export function Live(props: {
  sessionId: string;
  requestId?: string | undefined;
  view: SessionView | null;
  viewAt(ts: string): SessionView | null;
  status: SessionStatus;
  lastLooked: string | null;
}) {
  const { sessionId, view, viewAt, status, lastLooked } = props;
  // Relative times ("14 min ago") move on even when no events arrive.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!view) {
    return (
      <main className="live-page">
        <div className="live-main">
          <div className="live-top">
            <StatusLine status={status} />
          </div>
          {status !== "error" && (
            <div className="skeleton" aria-hidden="true">
              <div className="sk sk-strip" />
              <div className="sk-grid">
                <div className="sk" />
                <div className="sk sk-map" />
                <div className="sk" />
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  const req =
    view.requests.find((r) => r.id === props.requestId) ?? view.requests.at(-1);
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
          <StatusLine status={status} />
        </div>
        {req ? (
          <RequestScreen
            key={req.id}
            sessionId={sessionId}
            view={view}
            viewAt={viewAt}
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
  lastLooked: string | null;
  requestId: string;
}) {
  const { sessionId, view, viewAt, lastLooked, requestId } = props;
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

  return (
    <>
      <FlagsBar needsYou={view.needsYou} flags={req.flags} />
      <PhaseStrip
        phases={req.phases}
        inferred={req.planInferred}
        selected={phaseId}
        onSelect={setPhaseId}
      />
      <CatchUp text={since} since={lastLooked} />
      <div className="live-grid">
        <NowCard request={req} />
        <PlanPanel
          request={req}
          hoverPart={partId}
          onHover={setPartId}
          onOpen={open}
        />
        <section className="map-panel" aria-label="Map">
          <div className="lbl">How it ties together</div>
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
        <Assumptions sessionId={sessionId} assumptions={req.assumptions} />
      </div>
    </>
  );
}
