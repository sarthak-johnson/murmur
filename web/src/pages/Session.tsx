import type { MurmurEvent, RequestView, SessionView } from "@murmur/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Me } from "../api";
import { type Brief, catchUpBrief } from "../catchup";
import { FileList } from "../files";
import { useLastLooked } from "../lastLooked";
import { Assumptions } from "../live/Assumptions";
import { BriefBlock } from "../live/Brief";
import { PlanColumn } from "../live/PlanColumn";
import { Brand, dayLabel, Rail, RailFoot } from "../live/Rail";
import { Story, storyPhases } from "../live/Story";
import { FilesTab, fileRow, HelpersTab, RequestTabs } from "../live/Tabs";
import { TopBar } from "../live/TopBar";
import { MapView } from "../map/MapView";
import { PartDetail } from "../part/PartDetail";
import { navigate, partPath, requestPath, type Tab } from "../router";
import {
  livePhase,
  phasePlace,
  type RequestState,
  requestMark,
  type Waiting,
} from "../session";
import { clock, sentBack } from "../story";
import { type SessionStatus, useSession } from "../useSession";

export function SessionPage(props: {
  sessionId: string;
  requestId?: string | undefined;
  partId?: string | undefined;
  tab?: Tab | undefined;
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
      <aside className="rail" aria-hidden={status === "error" || undefined}>
        <Brand />
        {status !== "error" && (
          <div className="sk-spine" aria-hidden="true">
            <div className="sk sk-ph" />
            <div className="sk sk-ph" />
          </div>
        )}
        <RailFoot status={status} />
      </aside>
      <div className="col">
        <header className="top">
          {note && (
            <span className="top-note muted" role="status">
              {note}
            </span>
          )}
        </header>
        <main className="main">{status !== "error" && <Skeleton />}</main>
      </div>
    </div>
  );
}

/** The drawer under 900 px: open, closed on Escape, a scrim click, navigation or a wider window. */
function useDrawer() {
  const [open, setOpen] = useState(false);
  const back = useRef(false);
  const close = useCallback((toToggle = true) => {
    back.current = toToggle;
    setOpen(false);
  }, []);
  // Focus goes back to the Requests button once the page is no longer inert.
  useEffect(() => {
    if (open || !back.current) return;
    back.current = false;
    document.getElementById("rail-toggle")?.focus();
  }, [open]);
  // Every navigation closes it, the request already shown too (navigate and back and
  // forward all end in popstate); focus goes back to the Requests button.
  useEffect(() => {
    if (!open) return;
    const on = () => close();
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, [open, close]);
  useEffect(() => {
    const wide = window.matchMedia?.("(min-width: 900px)");
    if (!wide) return;
    const on = () => wide.matches && setOpen(false);
    wide.addEventListener("change", on);
    return () => wide.removeEventListener("change", on);
  }, []);
  return { open, toggle: () => setOpen((o) => !o), close };
}

/** The live screen for one session; SessionPage feeds it from the stream. */
export function Live(props: {
  sessionId: string;
  /** Unset on the session page, which shows the newest request in place. */
  requestId?: string | undefined;
  /** A task's page inside the same frame. */
  partId?: string | undefined;
  tab?: Tab | undefined;
  view: SessionView | null;
  viewAt(ts: string): SessionView | null;
  events?: MurmurEvent[];
  status: SessionStatus;
  lastLooked: string | null;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, view, viewAt, events = [], status, lastLooked } = props;
  const { partId, me, onSignOut, tab = "story" } = props;
  // Relative times ("14 m ago") move on even when no events arrive.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  const [hoverPart, setHoverPart] = useState<string>();
  const drawer = useDrawer();
  const closeDrawer = drawer.close;
  const onClose = useCallback(() => closeDrawer(), [closeDrawer]);

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

  const { state, end, waiting } = req
    ? requestMark(view, req, events)
    : {
        state: "running" as RequestState,
        end: view.lastEventAt,
        waiting: null,
      };
  const done = state === "done";
  const live = req ? livePhase(req, done) : undefined;

  return (
    <div className={drawer.open ? "frame drawer-open" : "frame"}>
      <a className="skip" href="#main">
        Skip to the content
      </a>
      <Rail
        sessionId={sessionId}
        view={view}
        events={events}
        currentId={req?.id}
        onRequestPage={!!wanted && !partId}
        status={status}
        me={me}
        open={drawer.open}
        onClose={onClose}
      />
      {drawer.open && (
        <div className="scrim" aria-hidden="true" onClick={onClose} />
      )}
      <div className="col" inert={drawer.open || undefined}>
        <TopBar
          sessionId={sessionId}
          view={view}
          request={req}
          part={part}
          onSession={!props.requestId}
          state={state}
          end={end}
          waiting={waiting}
          events={events}
          drawerOpen={drawer.open}
          onRequests={drawer.toggle}
          me={me}
          onSignOut={onSignOut}
        />
        <main
          className={tab === "flow" && !partId ? "main wide" : "main"}
          id="main"
          tabIndex={-1}
        >
          {!req ? (
            <p className="muted">
              Waiting for the first prompt in this session.
            </p>
          ) : partId ? (
            part ? (
              <PartDetail
                cwd={view.cwd}
                sessionId={sessionId}
                requestNumber={view.requests.indexOf(req) + 1}
                request={req}
                part={part}
                events={events}
              />
            ) : (
              <>
                <p>This part is not in the map yet.</p>
                <button
                  type="button"
                  className="link"
                  onClick={() => navigate(requestPath(sessionId, req.id))}
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
              tab={tab}
              request={req}
              waiting={waiting}
              live={live}
              done={done}
              end={end}
              hoverPart={hoverPart}
              onHoverPart={setHoverPart}
              onOpenPart={(p) => navigate(partPath(sessionId, req.id, p))}
            />
          )}
        </main>
      </div>
    </div>
  );
}

const KIND: Record<RequestView["kind"], string> = {
  feature: "Feature",
  bug: "Bug hunt",
  refactor: "Refactor",
  question: "Question",
};

const n_ = (n: number, one: string, many = `${one}s`) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

/** Where the plan stands, under the title: the phase, a bar of its tasks, the count. */
function Progress(props: { request: RequestView; done: boolean }) {
  const { request, done } = props;
  const tasks = request.phases.flatMap((p) => p.tasks);
  const shown = livePhase(request, done) ?? request.phases.at(-1);
  if (!shown) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the bar
    <div className="progress" role="group" aria-label="Progress">
      <span className="k">{phasePlace(request, shown)}</span>
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
  );
}

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
  end: string;
  hoverPart: string | undefined;
  onHoverPart(partId: string | undefined): void;
  status: SessionStatus;
  tab: Tab;
  onOpenPart(partId: string): void;
}) {
  const { sessionId, view, viewAt, events, lastLooked, request: req } = props;
  const { status, tab, end } = props;
  const { waiting, live, done, hoverPart, onHoverPart, onOpenPart } = props;
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
  // A breadcrumb's phase link lands on that phase of the story.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: "start" });
  }, []);
  const brief = frozen?.looked === lastLooked ? frozen.brief : null;
  const tasks = req.phases.flatMap((p) => p.tasks);
  const back = sentBack(req);
  const facts = [
    ...n_(tasks.length, "task"),
    ...n_(req.tally.helpers, "helper"),
    ...n_(back, "sent back after review", "sent back after review"),
  ];
  const storied = new Set(storyPhases(req, done).map((g) => g.phase.id));
  const map = (
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
  );
  return (
    <>
      <div className="over">
        <span className="label-chip">
          {KIND[req.kind]}
          {req.kindInferred && <span className="inferred">inferred</span>}
        </span>
        <span className="num">
          Request {view.requests.indexOf(req) + 1} of {view.requests.length} ·{" "}
          {dayLabel(req.startedAt)}
        </span>
      </div>
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
        {req.phases.length > 0 && <Progress request={req} done={done} />}
      </div>
      <BriefBlock
        brief={brief}
        since={lastLooked}
        waiting={waiting}
        flags={req.flags}
      />
      <Assumptions sessionId={sessionId} assumptions={req.assumptions} />
      <RequestTabs sessionId={sessionId} requestId={req.id} tab={tab} />
      <div className="tab-body">
        {tab === "flow" ? (
          map
        ) : tab === "files" ? (
          <FilesTab request={req} events={events} cwd={view.cwd} />
        ) : tab === "helpers" ? (
          <HelpersTab sessionId={sessionId} request={req} events={events} />
        ) : (
          <div className="req-split">
            <div className="req-story">
              {/* With nothing said yet, the map tells how the work ties together. */}
              {hasStory ? (
                <Story
                  request={req}
                  live={live}
                  done={done}
                  onOpenPart={onOpenPart}
                />
              ) : (
                map
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
                    row={fileRow(view.cwd)}
                  />
                </section>
              )}
            </div>
            <PlanColumn
              request={req}
              done={done}
              end={end}
              events={events}
              storyPhases={storied}
              onOpen={onOpenPart}
              onHover={onHoverPart}
            />
          </div>
        )}
      </div>
    </>
  );
}
