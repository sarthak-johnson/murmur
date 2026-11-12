// The office: a session drawn as a pixel room. Claude moves between its desk, the plan board,
// the archive and its helpers' desks; each helper sits at a desk wired to the sticky note it
// works on. It follows the session live, and its replay bar goes back to any moment. The
// detail drawer holds everything the other views show, so the room never costs detail.
import type { MurmurEvent, SessionView } from "@murmur/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigate, officePath, sessionPath } from "../router";
import { type RequestState, requestMark } from "../session";
import { type SessionStatus, useSession } from "../useSession";
import { Drawer } from "./Drawer";
import { type DrawerState, drawerFor } from "./drawerState";
import {
  countAt,
  doingLogOf,
  type FileHit,
  fileLogOf,
  firstAfter,
  logsOf,
  mainLogOf,
  modelsOf,
  nextEventAfter,
  touchersOf,
  useViewAt,
} from "./feed";
import { H, T, W } from "./map";
import { createOverlay, type Overlay } from "./overlay";
import { createRenderer, deskTile, type Renderer } from "./render";
import { activeRequest, deriveScene, QUIET_MS, type Scene } from "./scene";
import { clockOf, dur } from "./util";
import "./office.css";

export function OfficePage(props: { sessionId: string; requestId?: string }) {
  const { view, status, events } = useSession(props.sessionId);
  // Not drawn from the first pages: they would show an old floor as the live one for a moment.
  if (!view || status === "loading")
    return <OfficeShell sessionId={props.sessionId} status={status} />;
  if (!view.requests.length)
    return (
      <OfficeShell
        sessionId={props.sessionId}
        status={status}
        note="Waiting for the first prompt in this session."
      />
    );
  return (
    <Office
      sessionId={props.sessionId}
      pinnedId={props.requestId}
      view={view}
      events={events}
      status={status}
    />
  );
}

function OfficeShell(props: {
  sessionId: string;
  status: SessionStatus;
  note?: string;
}) {
  return (
    <div className="office">
      <header className="of-top">
        <BackLink sessionId={props.sessionId} />
        <Brand />
      </header>
      <main
        className="of-stage of-empty"
        aria-busy={props.status === "loading"}
      >
        <p className="muted">
          {props.status === "error"
            ? "This session could not be loaded."
            : (props.note ?? "Opening the office…")}
        </p>
      </main>
      <footer className="of-replay" />
    </div>
  );
}

function Brand() {
  return (
    <span className="of-brand">
      <span className="of-brand-mark" aria-hidden="true" />
      Murmur <span className="of-brand-sub">office</span>
    </span>
  );
}

function BackLink({ sessionId }: { sessionId: string }) {
  const path = sessionPath(sessionId);
  return (
    <a
      className="of-back-link"
      href={path}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(path);
      }}
      aria-label="Back to the session"
      title="Back to the session"
    >
      ‹
    </a>
  );
}

const DRAG_STEP_MS = 10 * 60_000;
/** Playing skips quiet stretches longer than this, landing a few seconds before the next event. */
const IDLE_MS = 3 * 60_000;
const LEAD_MS = 5_000;

const PHONE = 760;
/** A phone's drawer when none was picked: the story, one object so its memo holds. */
const PHONE_DRAWER: DrawerState = { tab: "story" };
/** The drawer's width beside the room: a third of a wide screen, within reading limits. */
const drawerWidth = (w: number) =>
  Math.round(Math.min(640, Math.max(480, w * 0.3)));

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** "3 h 12 m", "35 m", "40 s", "8 d 3 h": the app's own form, at most two parts. */
function span(ms: number) {
  const m = Math.round(ms / 60000);
  if (m >= 48 * 60)
    return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} m`;
  return m >= 1 ? `${m} m` : `${Math.max(1, Math.round(ms / 1000))} s`;
}

/** The helpers a pointed-at thing stands for: a desk, every helper on a sticky, or on a phase. */
function pointedAgents(key: string | null, scene: Scene): string[] {
  if (!key) return [];
  const [kind, id] = key.split(/:(.*)/s);
  if (kind === "agent" && id) return [id];
  if (kind === "task")
    return scene.desks.filter((d) => d.task === id).map((d) => d.agent);
  if (kind === "phase")
    return scene.desks
      .filter(
        (d) =>
          d.task && d.phase !== undefined && scene.columns[d.phase]?.id === id,
      )
      .map((d) => d.agent);
  return [];
}

export function Office(props: {
  sessionId: string;
  pinnedId: string | undefined;
  view: SessionView;
  events: MurmurEvent[];
  status: SessionStatus;
}) {
  const { sessionId, view, events, status } = props;
  // Live: the stream is up, the session has not ended and something happened lately; the
  // clock then runs with real time. Up but silent for a while, it is quiet: its clock stops
  // at its last event, so nothing reads as running for a day.
  // A reconnect is a blip, not the session stopping: it stays live meanwhile.
  const open = (status === "live" || status === "reconnecting") && !view.ended;
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);
  const first = view.requests[0];
  const START = Date.parse(first?.startedAt ?? view.startedAt);
  const lastAt = Date.parse(view.lastEventAt);
  const quietFor = open ? Math.max(0, wall - lastAt) : 0;
  // Waiting on you is live however long the wait: that clock runs on.
  // Reconnecting, it is not quiet either: what is missing is the line to it, not the work.
  const reconnecting = status === "reconnecting";
  const live = open && (reconnecting || quietFor < QUIET_MS || !!view.needsYou);
  const END = live ? Math.max(lastAt, wall) : lastAt;

  // Time: null follows the newest moment; a number is a moment of the replay.
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const tNow = at === null ? END : Math.min(END, Math.max(START, at));
  // Showing the newest moment of a session gone quiet: as it was left, Claude at rest.
  const quietNow = at === null && open && !live;
  const iso = new Date(tNow).toISOString();
  const n = at === null ? events.length : countAt(events, iso);
  const viewT = useViewAt(events, view, n) ?? view;
  const eventsT = useMemo(
    () => (n >= events.length ? events : events.slice(0, n)),
    [events, n],
  );

  const mainLog = useMemo(() => mainLogOf(events), [events]);
  const models = useMemo(() => modelsOf(view, events), [view, events]);
  const fileLog = useMemo(() => fileLogOf(view, events), [view, events]);
  const touchers = useMemo(() => touchersOf(view), [view]);
  const doingLog = useMemo(() => doingLogOf(events), [events]);
  const logs = useMemo(
    () => logsOf(viewT, mainLog, doingLog, models),
    [viewT, mainLog, doingLog, models],
  );

  // The request on the floor: the one pinned by the address, else the newest at that moment.
  const reqs = viewT.requests;
  const active = activeRequest(reqs);
  const pinned = reqs.find((r) => r.id === props.pinnedId);
  const req = pinned ?? active ?? first;
  const reqId = req?.id ?? "";
  const activeId = active?.id;
  const activeN = active ? reqs.indexOf(active) + 1 : reqs.length;
  const derived = useMemo(
    () =>
      deriveScene(viewT, reqId, iso, logs, {
        onFloor: reqId === activeId,
        activeN,
        quiet: quietNow,
      }),
    [viewT, reqId, iso, logs, activeId, activeN, quietNow],
  );
  // Before the first prompt of a replay there is no floor yet: the last one stays up.
  const lastScene = useRef<Scene | null>(null);
  if (derived) lastScene.current = derived;
  const scene =
    derived ??
    lastScene.current ??
    (deriveScene(view, view.requests.at(-1)?.id ?? "", iso, logs) as Scene);
  // The drawer reads one view: the moment's, or the live one when a stale moment lacks the request.
  const drawerView = req && viewT.requests.includes(req) ? viewT : view;
  const drawerEvents = drawerView === viewT ? eventsT : events;
  const mark = useMemo(
    () => (req ? requestMark(drawerView, req, drawerEvents) : null),
    [drawerView, req, drawerEvents],
  );
  // Its clocks tick in 10 s steps, so a playing replay does not redraw it ten times a second.
  const drawerT = new Date(Math.floor(tNow / 10_000) * 10_000).toISOString();

  // The drawer: open beside the room on a wide screen, over it on a narrow one.
  const [drawer, setDrawer] = useState<DrawerState | null>(() =>
    window.innerWidth >= 1800 ? { tab: "story" } : null,
  );
  // Opened by a click (not on load): focus goes into it, and back when it closes.
  const [focusKey, setFocusKey] = useState(0);
  const openDrawer = useCallback((d: DrawerState) => {
    setDrawer(d);
    setFocusKey((k) => k + 1);
  }, []);
  const [hover, setHover] = useState<string | null>(null);
  // A phone has no room beside the strip: the detail reads under it, the story first.
  const stage = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlayEl = useRef<HTMLDivElement>(null);
  const mapWrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, vw: 0 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const on = () =>
      setBox({ w: el.clientWidth, h: el.clientHeight, vw: window.innerWidth });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const phone = box.vw > 0 && box.vw <= PHONE;
  const shown = phone ? (drawer ?? PHONE_DRAWER) : drawer;
  const dw = drawerWidth(box.vw);
  // Docked only when the room still gets 2x beside it; otherwise the drawer floats over it.
  const docked = !!drawer && !phone && box.w - dw - 16 >= W * 2;
  const room = docked ? box.w - dw : box.w;
  const scale = phone
    ? 2
    : // Never under 2x, where words stay readable: a smaller window pans the room instead.
      Math.max(2, Math.floor(Math.min((room - 16) / W, (box.h - 16) / H)));

  // The engine: one renderer and overlay per mount, painted every frame from refs.
  const engine = useRef<{ r: Renderer; o: Overlay } | null>(null);
  const live$ = useRef({
    scene,
    iso,
    scale,
    hover,
    item: drawer?.item ?? null,
  });
  live$.current = { scene, iso, scale, hover, item: drawer?.item ?? null };
  const eventMs = useMemo(() => events.map((e) => Date.parse(e.ts)), [events]);
  const play$ = useRef({ playing, speed, t: tNow, START, END, ms: eventMs });
  play$.current = {
    playing,
    speed,
    t: playing ? play$.current.t : tNow,
    START,
    END,
    ms: eventMs,
  };

  const activeId$ = useRef(activeId);
  activeId$.current = activeId;
  const openKey = useCallback(
    (key: string) => {
      if (key.startsWith("req:")) {
        const id = key.slice(4);
        // The floor Claude is on is the office's own address; any other is pinned.
        navigate(
          officePath(sessionId, id === activeId$.current ? undefined : id),
        );
        return;
      }
      openDrawer(drawerFor(key));
    },
    [sessionId, openDrawer],
  );
  const pickRequest = useCallback(
    (id: string) => open$.current(`req:${id}`),
    [],
  );
  const open$ = useRef(openKey);
  open$.current = openKey;

  useEffect(() => {
    const cv = canvas.current;
    const ov = overlayEl.current;
    if (!cv || !ov) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const r = createRenderer(cv, { reduced: () => !!reduced?.matches });
    const o = createOverlay(
      ov,
      (k) => open$.current(k),
      (k) => setHover(k),
    );
    engine.current = { r, o };
    let raf = 0;
    let last = performance.now();
    let pushed = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const p = play$.current;
      if (p.playing) {
        p.t = Math.min(p.END, p.t + dt * 1000 * p.speed);
        // A long quiet stretch (a night's pause) is skipped to just before the next event.
        const next = nextEventAfter(p.ms, p.t);
        if (next - p.t > IDLE_MS) p.t = Math.min(p.END, next - LEAD_MS);
        // React hears of the new time ten times a second; the room moves every frame.
        if (now - pushed > 100 || p.t >= p.END) {
          pushed = now;
          const t = p.t;
          setAt(t >= p.END ? null : t);
          if (t >= p.END) setPlaying(false);
        }
      }
      const s = live$.current;
      r.focusOn(pointedAgents(s.hover ?? s.item, s.scene));
      r.draw(now, s.iso, s.scale);
      o.render(s.scene, r.claudePos(), r.walkers(), s.item, s.hover, s.iso);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      o.destroy?.();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.o.setScale(scale);
  }, [scale]);

  // A new scene walks people to their new places; a jump (or a drag's big step) snaps.
  const prev = useRef<{ t: number; req: string } | null>(null);
  const animate$ = useRef(true);
  const litFiles = useRef(new Set<string>());
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const before = prev.current;
    // While the first pages load, the room catches up without celebrating old news.
    const animate =
      !!before &&
      before.req === reqId &&
      animate$.current &&
      status !== "loading";
    e.r.update(scene, { animate });
    // Binders light once for each touch that has come in since the last scene: by touch, not
    // by a time window, since a live touch reaches the browser after its own time has passed.
    // A jump relights the last 20 s, older ones already fading.
    if (!animate) litFiles.current.clear();
    const lo =
      animate && before ? Math.min(before.t, tNow - 20_000) : tNow - 20_000;
    const nowMs = performance.now();
    for (let i = firstAfter(fileLog, lo); i < fileLog.length; i++) {
      const f = fileLog[i] as FileHit;
      if (f.ms > tNow) break;
      const key = `${f.t}|${f.kind}|${f.path}|${f.agent ?? ""}`;
      if (litFiles.current.has(key)) continue;
      litFiles.current.add(key);
      const who = f.req
        ? (touchers.get(`${f.req}|${f.path}`) ?? [])
        : f.agent
          ? [f.agent]
          : [];
      const agent =
        who.find((id) =>
          scene.desks.some((d) => d.agent === id && d.status === "running"),
        ) ?? who[0];
      const ago = animate ? 0 : ((tNow - f.ms) / 20_000) * 2600;
      e.r.lightFile(f.path, nowMs - ago, agent);
    }
    prev.current = { t: tNow, req: reqId };
    animate$.current = true;
  }, [scene, reqId, tNow, fileLog, touchers, status]);

  // On a phone the room is a strip: bring Claude into view when the request changes, once it
  // has walked to its place (its first frames are still at the door), and again when it
  // starts waiting on you, at the door.
  // biome-ignore lint/correctness/useExhaustiveDependencies: centre per request and on waiting
  useEffect(() => {
    if (!phone) return;
    const centre = (smooth: boolean) => {
      const w = mapWrap.current;
      const sc = live$.current.scene;
      const c = engine.current?.r.claudePos();
      if (!w) return;
      // A pinned floor has no Claude on it: its board and desks are the story.
      const away = !sc.request.current;
      const x = away ? 12 * T : sc.waiting ? 32 * T : (c?.x ?? 32 * T);
      const y = away ? 9 * T : sc.waiting ? 3 * T : (c?.y ?? 3 * T) - T;
      w.scrollTo({
        left: x * scale - w.clientWidth / 2,
        top: y * scale - w.clientHeight / 2,
        behavior: smooth ? "smooth" : "auto",
      });
    };
    const first = requestAnimationFrame(() => centre(false));
    const settled = setTimeout(() => centre(true), 1400);
    return () => {
      cancelAnimationFrame(first);
      clearTimeout(settled);
    };
  }, [reqId, phone, !!scene.waiting]);

  // The drawer docks away from what was clicked, so it never covers it.
  const dockLeft = (() => {
    const item = drawer?.item;
    if (!item || docked) return false;
    const [kind, id] = item.split(/:(.*)/s);
    if (kind === "agent") {
      const d = scene.desks.find((k) => k.agent === id);
      return !!d && deskTile(d).x * T > W / 2;
    }
    if (kind === "task") {
      const xs = scene.desks
        .filter((d) => d.task === id)
        .map((d) => deskTile(d).x * T);
      return xs.length > 0 && xs.reduce((a, b) => a + b, 0) / xs.length > W / 2;
    }
    return kind === "door" || kind === "terminal";
  })();

  const seek = (ms: number, smooth = false) => {
    animate$.current = smooth;
    play$.current.t = ms;
    setAt(ms >= END ? null : ms);
  };
  /** To a request's start: the floor shows it, newest-following again if it was pinned. */
  const goTo = (startedAt: string) => {
    setPlaying(false);
    seek(Date.parse(startedAt) + 1000);
    if (props.pinnedId) navigate(officePath(sessionId));
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (at === null || tNow >= END) seek(START);
    play$.current.t = at === null || tNow >= END ? START : tNow;
    setPlaying(true);
  };

  useEffect(() => {
    if (!drawer) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawer]);

  const following = at === null;
  // A session over more than a day says the day with the time.
  const spansDays =
    dayOf(new Date(START).toISOString()) !== dayOf(new Date(END).toISOString());
  const total = Math.max(1, Math.round((END - START) / 1000));
  const working = scene.desks.filter((d) => d.status === "running");
  const carried = working.filter((d) => d.fromRequest);
  // The request's own mark wins (core's state), so the bar, the room and the drawer agree.
  const state: RequestState = !mark
    ? "running"
    : mark.mark === "running" || mark.mark === "waiting"
      ? mark.mark
      : "done";
  const pill =
    !req || !mark
      ? null
      : scene.waiting
        ? ([
            "blocked",
            `Waiting on you · ${dur(tNow - Date.parse(scene.waiting.since))}`,
          ] as const)
        : state === "running" && following && open && !live
          ? // Left mid-work: it ran this long, then nothing more came.
            ([
              "todo",
              `Paused · ran ${dur(tNow - Date.parse(req.startedAt))}`,
            ] as const)
          : state === "running"
            ? ([
                "now",
                `Running · ${dur(tNow - Date.parse(req.startedAt))}`,
              ] as const)
            : mark.mark === "failed"
              ? (["failed", "Failed"] as const)
              : mark.mark === "open"
                ? (["todo", "Left open"] as const)
                : (["done", "Done"] as const);
  const helperMeta = !working.length
    ? "No helpers at work"
    : !carried.length
      ? `${working.length} helper${working.length > 1 ? "s" : ""} at work`
      : `${working.length} helper${working.length > 1 ? "s" : ""} at work · ${carried.length} on ${[...new Set(carried.map((d) => `Req ${d.fromRequest}`))].join(", ")}`;

  useEffect(() => {
    document.title = scene.waiting
      ? "(!) Waiting on you · Murmur office"
      : `${view.title || "Session"} · Murmur office`;
  }, [scene.waiting, view.title]);

  return (
    <div className={phone ? "office phone" : "office"}>
      <header className="of-top">
        <BackLink sessionId={sessionId} />
        <Brand />
        {following && reconnecting ? (
          <span
            className="of-tag quiet"
            title="The line to Murmur dropped; this shows the session as last heard, and catches up when it is back"
          >
            Reconnecting…
          </span>
        ) : following && live ? (
          <span
            className="of-tag live"
            title="Following the session as it happens"
          >
            Live
          </span>
        ) : following && open ? (
          <span
            className="of-tag quiet"
            title={`Nothing has happened in this session for ${span(quietFor)}. It shows as it was left, and wakes up when Claude does.`}
          >
            Quiet · {dur(quietFor)}
          </span>
        ) : (
          <span
            className="of-tag replay"
            title={`A replay of this session. ${open ? "It is still open; its latest moment" : "It ended"} at ${clockOf(new Date(END).toISOString())}.`}
          >
            Replay
          </span>
        )}
        <button
          type="button"
          className="of-req"
          onClick={() => openDrawer({ tab: "requests" })}
          title="Every request in this session"
        >
          <span className="of-req-n">
            Request {scene.request.n} of {scene.jobs.length}
          </span>
          <span className="of-req-title">{scene.request.short}</span>
          <span className="of-caret" aria-hidden="true" />
        </button>
        {pill && <span className={`of-pill s-${pill[0]}`}>{pill[1]}</span>}
        {!scene.request.current && (
          // A pinned floor, not the one Claude is on: the way back, said in the bar.
          <button
            type="button"
            className="of-away"
            title={`This floor is how request ${scene.request.n} stands. ${
              scene.activeN > scene.request.n
                ? `Claude has moved on to request ${scene.activeN}.`
                : `Claude is still at work on request ${scene.activeN}.`
            }`}
            onClick={() => {
              const id = scene.jobs[scene.activeN - 1]?.id;
              if (id) openKey(`req:${id}`);
            }}
          >
            Claude is on request {scene.activeN} ›
          </button>
        )}
        <span className="of-meta">
          {scene.plan.total ? (
            <>
              Plan{" "}
              <b>
                {scene.plan.done} of {scene.plan.total}
              </b>{" "}
              done
            </>
          ) : state === "running" ? (
            "No plan yet"
          ) : (
            "No plan"
          )}
        </span>
        <span className="of-meta">{helperMeta}</span>
        <span className="of-spacer" />
        <span className="of-session">{view.title}</span>
        {/* Stays in place while the drawer is open, so focus has somewhere to come back to. */}
        <button
          type="button"
          className="of-details"
          aria-expanded={!!drawer}
          onClick={() =>
            drawer ? setDrawer(null) : openDrawer({ tab: "story" })
          }
        >
          {drawer ? "Hide details" : "Details"}
        </button>
      </header>

      <main
        className={docked ? "of-stage docked" : "of-stage"}
        ref={stage}
        style={{ "--of-dw": `${dw}px` } as React.CSSProperties}
      >
        {scene.waiting && (
          <div className="of-ask" role="status">
            {/^claude is waiting/i.test(scene.waiting.text) ? (
              <b>{scene.waiting.text}</b>
            ) : (
              <>
                <b>Claude is waiting on you:</b> {scene.waiting.text}
              </>
            )}
          </div>
        )}
        <div className="of-mapwrap" ref={mapWrap}>
          <div className="of-map">
            <canvas
              ref={canvas}
              className="of-cv"
              width={W}
              height={H}
              role="img"
              aria-label={`The office for request ${scene.request.n}: ${scene.request.short}`}
            />
            <div className="of-overlay" ref={overlayEl} />
          </div>
        </div>
        {shown && req && mark && (
          <div className={dockLeft ? "of-dock left" : "of-dock"}>
            <Drawer
              sessionId={sessionId}
              view={drawerView}
              events={drawerEvents}
              request={req}
              state={state}
              end={mark.end}
              waiting={mark.waiting}
              mainLog={mainLog}
              t={drawerT}
              following={following && !quietNow}
              models={models}
              drawer={shown}
              docked={docked}
              focusKey={focusKey}
              onPickRequest={pickRequest}
              onChange={setDrawer}
            />
          </div>
        )}
      </main>

      <footer className="of-replay">
        <button
          type="button"
          className={playing ? "of-play on" : "of-play"}
          aria-label={playing ? "Pause replay" : "Play replay"}
          onClick={togglePlay}
        >
          <span className="of-play-icon" aria-hidden="true" />
        </button>
        <div className="of-track">
          {/* Requests close in time overlap, so a click on the strip takes the nearest one;
              each tick is still its own button for the keyboard. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the ticks inside are the keyboard's way */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
          <div
            className="of-ticks"
            title="Requests: click to go to one"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const at =
                START +
                ((e.clientX - box.left) / (box.width || 1)) * (END - START);
              const near = view.requests.reduce((a, b) =>
                Math.abs(Date.parse(b.startedAt) - at) <
                Math.abs(Date.parse(a.startedAt) - at)
                  ? b
                  : a,
              );
              goTo(near.startedAt);
            }}
          >
            {view.requests.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className={[
                  r.id === reqId ? "cur" : "",
                  Date.parse(r.startedAt) > tNow ? "later" : "",
                ].join(" ")}
                style={{
                  left: `${((Date.parse(r.startedAt) - START) / (END - START || 1)) * 100}%`,
                }}
                aria-label={`Go to request ${i + 1}`}
                aria-current={r.id === reqId ? "true" : undefined}
                // One tab stop for the strip, not one per request: the Requests tab lists them all.
                tabIndex={r.id === reqId ? 0 : -1}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(r.startedAt);
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={total}
            step={1}
            value={Math.round((tNow - START) / 1000)}
            aria-label="Replay time"
            onChange={(e) => {
              setPlaying(false);
              const t = START + Number(e.target.value) * 1000;
              // A small drag step is a fast-forward: people walk (quickly) to their places.
              const small = Math.abs(t - tNow) < DRAG_STEP_MS;
              engine.current?.r.rush(small);
              seek(t, small);
            }}
            onPointerUp={() => engine.current?.r.rush(false)}
            onKeyUp={() => engine.current?.r.rush(false)}
          />
        </div>
        <span className={spansDays ? "of-clock days" : "of-clock"}>
          {spansDays && <span className="of-day">{dayOf(iso)} </span>}
          {clockOf(iso)}
          {following
            ? live
              ? " · now"
              : open
                ? " · latest"
                : " · end"
            : ` · ${span(END - tNow)} earlier`}
        </span>
        <label className="of-speed">
          <span className="sr-only">Replay speed</span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[10, 30, 60, 120].map((v) => (
              <option key={v} value={v}>
                {v}x
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={
            following ? (live ? "of-live on live" : "of-live on") : "of-live"
          }
          onClick={() => {
            setPlaying(false);
            seek(END);
          }}
          aria-label={
            live
              ? "Follow the session live"
              : open
                ? "Jump to the latest moment"
                : "Jump to the end"
          }
        >
          {live ? "Live" : open ? "Latest" : "End"}
        </button>
        <div className="of-legend">
          <span className="of-lg">
            <i className="k now" />
            Running
          </span>
          <span className="of-lg">
            <i className="k done" />
            Done
          </span>
          <span className="of-lg">
            <i className="k blocked" />
            Waiting on you
          </span>
          <span className="of-lg">
            <i className="k failed" />
            Failed
          </span>
          <span className="of-lg">
            <i className="k todo" />
            Not started
          </span>
        </div>
      </footer>
      <PhaseKey scene={scene} />
    </div>
  );
}

/** Screen readers get the room as a list: who works on what, and what Claude is doing. */
function PhaseKey({ scene }: { scene: Scene }) {
  return (
    <section className="sr-only" aria-label="Who is at work">
      <p>Claude: {scene.claude.bubble ?? "at its desk"}</p>
      <ul>
        {scene.desks.map((d) => (
          <li key={d.agent}>
            {d.name}, {d.roleWord},{" "}
            {d.status === "running" ? "working" : "done"}
            {d.bubble ? `: ${d.bubble}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
