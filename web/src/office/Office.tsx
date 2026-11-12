// The office: a session drawn as a pixel room, and the app's one shell. Claude moves
// between its desk, the plan board, the archive and its helpers' desks; each helper sits at
// a desk wired to the sticky note it works on. It follows the session live, and its replay
// bar goes back to any moment. The requests rail is on its left, the panel on its right
// holds everything about the session and the request on the floor; the URL says which floor
// (`/s/:sid` follows Claude, `/s/:sid/r/:rid` pins one) and what the panel shows (`?open=`).
import type { MurmurEvent, SessionView } from "@murmur/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Me } from "../api";
import { useLastLooked } from "../lastLooked";
import { closedHere, floorPath, follow, navigate } from "../router";
import {
  namedAsNow,
  type RequestState,
  requestMark,
  requestShort,
} from "../session";
import { requestNow, sessionFacts, sessionNow } from "../state";
import { clock } from "../story";
import { type SessionStatus, useSession } from "../useSession";
import {
  Menu,
  NowLine,
  RequestList,
  RequestPicker,
  SessionSwitcher,
} from "./Bar";
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
import { Panel } from "./Panel";
import {
  isSessionTab,
  isTab,
  isWideView,
  openFor,
  readOpen,
  roomKey,
} from "./panelState";
import { createRenderer, type Renderer } from "./render";
import { activeRequest, deriveScene, type Scene } from "./scene";
import { clockOf, dur } from "./util";
import "./office.css";

interface PageProps {
  sessionId: string;
  requestId?: string | undefined;
  /** The URL's `?open=`: what the panel shows. */
  open?: string | undefined;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}

export function OfficePage(props: PageProps) {
  const { view, status, events } = useSession(props.sessionId);
  const lastLooked = useLastLooked(props.sessionId);
  const { sessionId, me, onSignOut } = props;
  const menu = { sessionId, me, onSignOut };
  // Not drawn from the first pages: they would show an old floor as the live one for a moment.
  if (!view || status === "loading")
    return (
      <OfficeShell status={status} {...(status === "error" ? menu : {})} />
    );
  if (!view.requests.length)
    return (
      <OfficeShell
        status={status}
        note="Waiting for the first prompt in this session."
        {...menu}
      />
    );
  return (
    <Office
      sessionId={props.sessionId}
      pinnedId={props.requestId}
      open={props.open}
      view={view}
      events={events}
      status={status}
      lastLooked={lastLooked}
      me={props.me}
      onSignOut={props.onSignOut}
    />
  );
}

/**
 * The office before its session has loaded (or while the app learns who is signed in), or
 * a session with nothing to draw: its menu is there once it is known whose it is.
 */
export function OfficeShell(props: {
  status?: SessionStatus;
  note?: string;
  sessionId?: string;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { status, note, sessionId } = props;
  return (
    <div className="office">
      <header className="of-top">
        <div className="of-top-row">
          <Brand />
          {sessionId && (
            <>
              <span className="of-spacer" />
              <Menu
                sessionId={sessionId}
                me={props.me}
                onSignOut={props.onSignOut}
              />
            </>
          )}
        </div>
      </header>
      <main className="of-body of-empty" aria-busy={status === "loading"}>
        <p className="muted" role="status">
          {status === "error"
            ? "This session could not be loaded."
            : (note ?? "Opening the office…")}
        </p>
      </main>
      <footer className="of-replay" />
    </div>
  );
}

function Brand() {
  return (
    <a className="of-brand" href="/" onClick={follow("/")} title="All sessions">
      <span className="of-brand-mark" aria-hidden="true" />
      Murmur
    </a>
  );
}

const DRAG_STEP_MS = 10 * 60_000;
/** Playing skips quiet stretches longer than this, landing a few seconds before the next event. */
const IDLE_MS = 3 * 60_000;
const LEAD_MS = 5_000;

const PHONE = 760;
/** Under this width the rail folds into the request picker. */
const RAIL_MIN = 1200;
const RAIL_W = 248;
/** The panel's docked width: a third of a wide screen, within reading limits. */
const dockWidth = (w: number) =>
  Math.round(Math.min(640, Math.max(480, w * 0.3)));
/** Its wide width, for the boards: most of the stage, the room keeping a strip. */
const wideWidth = (stage: number) =>
  Math.round(Math.min(stage - 160, Math.max(960, stage * 0.55)));

/** A remembered choice of this viewer's; storage can be off, then it is the default. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
const PANEL_KEY = "murmur:panel";
const WIDE_KEY = "murmur:panelWide";
const RAIL_KEY = "murmur:rail";

/**
 * What the panel shows on a fresh load with no `open`: a request's old address reads its
 * story; else the reader's last choice, or the story when the room still fits beside it.
 */
function defaultOpen(pinned: boolean): string | null {
  if (closedHere()) return null;
  if (pinned) return "story";
  const last = stored(PANEL_KEY);
  if (last === "closed") return null;
  if (last && isTab(last)) return last;
  const vw = window.innerWidth;
  const stage = vw - (vw >= RAIL_MIN ? RAIL_W : 0);
  return vw > PHONE && stage - dockWidth(vw) - 16 >= W * 2 ? "story" : null;
}

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

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

/** On another request's floor the panel keeps a request's tab, else turns to its story. */
const keepFor = (o: string | null) =>
  !o ? null : isTab(o) && !isSessionTab(o) ? o : "story";

/** Keys typed into a field or a menu are its own, not the office's. */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))
  );
};

export function Office(props: {
  sessionId: string;
  pinnedId: string | undefined;
  open?: string | undefined;
  view: SessionView;
  events: MurmurEvent[];
  status: SessionStatus;
  lastLooked?: string | null;
  me?: Me | undefined;
  onSignOut?: (() => void) | undefined;
}) {
  const { sessionId, view, events, status } = props;
  // Live, waiting or quiet, as every view reads it (state.ts): while it ticks the clock
  // runs with real time; quiet, it stops at the last event, so nothing reads as running
  // for a day. Waiting on you ticks however long the wait.
  const [wall, setWall] = useState(() => Date.now());
  // The floor Claude is on, now: pinned to it is following it, and the address says so.
  const liveActive = activeRequest(view.requests);
  const liveActiveId = liveActive?.id;
  // A wait read from the events (a question in Claude's last message) is a wait too.
  const asking = useMemo(
    () =>
      !!liveActive && requestMark(view, liveActive, events).mark === "waiting",
    [view, liveActive, events],
  );
  const ses = sessionNow(view, status, wall, asking);
  const { open, quietFor } = ses;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);
  const first = view.requests[0];
  const START = Date.parse(ses.from);
  // Reconnecting changes only the tag: the session is as last heard until the line is back.
  const reconnecting = status === "reconnecting";
  const live = ses.ticking;
  const lastAt = Date.parse(ses.last);
  const END = live ? Math.max(lastAt, wall) : lastAt;
  const pinnedId =
    props.pinnedId &&
    props.pinnedId !== liveActiveId &&
    view.requests.some((r) => r.id === props.pinnedId)
      ? props.pinnedId
      : undefined;
  // What the panel shows: the address's `open`, or on a fresh load its default.
  const [initial] = useState(() =>
    props.open ? null : defaultOpen(!!props.pinnedId),
  );
  const panel = readOpen(props.open);
  // The address says what is shown: a pin on the floor Claude is on (or on no request of
  // this session) becomes following, and the default panel of a fresh load goes into it.
  const filled = useRef(false);
  useEffect(() => {
    const fill = !filled.current && !props.open && !!initial;
    filled.current = true;
    if (!fill && !(props.pinnedId && !pinnedId)) return;
    const url = new URL(location.href);
    const o = url.searchParams.get("open") ?? (fill ? initial : null);
    url.searchParams.delete("open");
    const rest = url.searchParams.toString();
    const to = floorPath(sessionId, pinnedId, o);
    history.replaceState(
      history.state,
      "",
      `${to}${rest ? `${o ? "&" : "?"}${rest}` : ""}${url.hash}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [sessionId, props.pinnedId, pinnedId, props.open, initial]);
  // The tab a close-up climbs back to, and the reader's last choice for the next visit.
  const lastTab = useRef("story");
  useEffect(() => {
    if (panel && isTab(panel)) {
      lastTab.current = panel;
      keep(PANEL_KEY, panel);
    } else if (!panel && closedHere()) keep(PANEL_KEY, "closed");
  }, [panel]);

  // Time: null follows the newest moment; a number is a moment of the replay.
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const tNow = at === null ? END : Math.min(END, Math.max(START, at));
  // Showing the newest moment of a session gone quiet: as it was left, Claude at rest.
  const quietNow = at === null && open && !live;
  const iso = new Date(tNow).toISOString();
  const n = at === null ? events.length : countAt(events, iso);
  // A request keeps its one title through a replay: Claude often names it later.
  const viewAt = useViewAt(events, view, n) ?? view;
  const viewT = useMemo(() => namedAsNow(viewAt, view), [viewAt, view]);
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
  const pinned = reqs.find((r) => r.id === pinnedId);
  const req = pinned ?? active ?? first;
  const reqId = req?.id ?? "";
  const activeId = active?.id;
  const activeN = active ? reqs.indexOf(active) + 1 : reqs.length;
  // The panel reads one view: the moment's, or the live one when a stale moment lacks the request.
  const drawerView = req && viewT.requests.includes(req) ? viewT : view;
  const drawerEvents = drawerView === viewT ? eventsT : events;
  // Its clocks tick in 10 s steps, so a playing replay does not redraw it ten times a second.
  const drawerT = new Date(Math.floor(tNow / 10_000) * 10_000).toISOString();
  // Following, the request stands as the session does now; a replay's moment reads its own.
  const tick = Math.floor((at === null ? wall : tNow) / 10_000) * 10_000;
  // The requests list reads the live session in 10 s steps, not on every second's tick.
  const listTick = Math.floor(wall / 10_000) * 10_000;
  const listSes = useMemo(
    () => sessionNow(view, status, listTick, asking),
    [view, status, listTick, asking],
  );
  const sesT = useMemo(
    () => sessionNow(drawerView, status, tick, at === null && asking),
    [drawerView, status, tick, at, asking],
  );
  const mark = useMemo(
    () => (req ? requestNow(drawerView, req, drawerEvents, sesT) : null),
    [drawerView, req, drawerEvents, sesT],
  );
  const floorState = drawerView === viewT ? mark?.state : undefined;
  const derived = useMemo(
    () =>
      deriveScene(viewT, reqId, iso, logs, {
        onFloor: reqId === activeId,
        activeN,
        quiet: quietNow,
        // The room's stickies and desks read the request as the bar does.
        state: floorState,
      }),
    [viewT, reqId, iso, logs, activeId, activeN, quietNow, floorState],
  );
  // Before the first prompt of a replay there is no floor yet: the last one stays up.
  const lastScene = useRef<Scene | null>(null);
  if (derived) lastScene.current = derived;
  const scene =
    derived ??
    lastScene.current ??
    (deriveScene(view, view.requests.at(-1)?.id ?? "", iso, logs) as Scene);

  // Every change of the panel is a step in the history: Back undoes it.
  const floor$ = useRef(pinnedId);
  floor$.current = pinnedId;
  const go = useCallback(
    (o: string | null) =>
      navigate(
        floorPath(sessionId, floor$.current, o),
        o ? {} : { closed: true },
      ),
    [sessionId],
  );
  const panel$ = useRef(panel);
  panel$.current = panel;
  const pick = useCallback(
    (id: string) => {
      const o = panel$.current;
      navigate(
        floorPath(
          sessionId,
          id === liveActive$.current ? undefined : id,
          keepFor(o),
        ),
        o ? {} : { closed: true },
      );
    },
    [sessionId],
  );
  const liveActive$ = useRef(liveActiveId);
  liveActive$.current = liveActiveId;

  // Opened by a click in the room (not by a link in the panel): focus goes into it.
  const [focusKey, setFocusKey] = useState(0);
  const [phase, setPhase] = useState<{ id: string; n: number }>();
  const [hover, setHover] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlayEl = useRef<HTMLDivElement>(null);
  const mapWrap = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
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
  const railOn = box.vw >= RAIL_MIN;
  const [railOpen, setRailOpen] = useState(() => stored(RAIL_KEY) !== "shut");
  const [wide, setWide] = useState(() => stored(WIDE_KEY) !== "docked");
  const wideNow = !!panel && wide && isWideView(panel);
  // The panel beside the room; on a phone, the sheet under it.
  const pw =
    !panel || phone
      ? 0
      : wideNow
        ? Math.max(dockWidth(box.vw), wideWidth(box.w))
        : dockWidth(box.vw);
  const room = box.w - pw;
  const scale = phone
    ? 2
    : // Never under 2x, where words stay readable: a smaller window pans the room instead.
      Math.max(2, Math.floor(Math.min((room - 16) / W, (box.h - 16) / H)));
  const selected = roomKey(panel, req);

  // The engine: one renderer and overlay per mount, painted every frame from refs.
  const engine = useRef<{ r: Renderer; o: Overlay } | null>(null);
  const live$ = useRef({ scene, iso, scale, hover, item: selected });
  live$.current = { scene, iso, scale, hover, item: selected };
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

  const openKey = useCallback(
    (key: string) => {
      if (key.startsWith("req:")) return pick(key.slice(4));
      if (key.startsWith("phase:"))
        setPhase((p) => ({ id: key.slice(6), n: (p?.n ?? 0) + 1 }));
      go(openFor(key));
      setFocusKey((k) => k + 1);
    },
    [go, pick],
  );
  const floorReq$ = useRef(req);
  floorReq$.current = req;
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

  // Playing fast, people walk fast too, or a replay leaves them crowding the corridors.
  useEffect(() => {
    engine.current?.r.rush(
      playing ? Math.min(8, Math.max(1, speed / 10)) : false,
    );
  }, [playing, speed]);

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
      // Low enough that the first desks show under Claude's corner, the board's foot above.
      const x = away ? 6 * T : sc.waiting ? 32 * T : (c?.x ?? 32 * T);
      const y = away ? 7 * T : sc.waiting ? 4 * T : 8.5 * T;
      w.scrollTo?.({
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

  // A room wider than its column (the panel beside it, a small window) re-centres in what
  // is left: on the thing the panel is about, else on Claude, or a pinned floor's board.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the room's box, floor or selection changing
  useEffect(() => {
    const w = mapWrap.current;
    if (!w || phone) return;
    const raf = requestAnimationFrame(() => {
      const map = w.firstElementChild?.getBoundingClientRect();
      if (!map) return;
      const at = w.getBoundingClientRect();
      const x0 = map.left - at.left + w.scrollLeft;
      const y0 = map.top - at.top + w.scrollTop;
      const sel = overlayEl.current
        ?.querySelector(".sel")
        ?.getBoundingClientRect();
      const c = engine.current?.r.claudePos();
      const away = !live$.current.scene.request.current;
      const [x, y] = sel
        ? [
            sel.left - at.left + w.scrollLeft + sel.width / 2,
            sel.top - at.top + w.scrollTop + sel.height / 2,
          ]
        : away
          ? [x0, y0 + map.height / 2]
          : [x0 + (c?.x ?? W / 2) * scale, y0 + (c?.y ?? H / 2) * scale];
      w.scrollTo?.({
        left: away && !sel ? 0 : x - w.clientWidth / 2,
        top: y - w.clientHeight / 2,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [pw, scale, box.w, box.h, phone, selected, reqId]);

  // A click in the room on a phone opens the sheet under it: bring it into view.
  useEffect(() => {
    if (!phone || !focusKey) return;
    dock.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [focusKey, phone]);

  const seek = (ms: number, smooth = false) => {
    animate$.current = smooth;
    play$.current.t = ms;
    setAt(ms >= END ? null : ms);
  };
  /** Back to following the session: the floor Claude is on, the panel as it is. */
  const follow$ = () => {
    if (pinnedId) navigate(floorPath(sessionId, undefined, keepFor(panel)));
  };
  /** To a request's start: the floor shows it, newest-following again if it was pinned. */
  const goTo = (startedAt: string) => {
    setPlaying(false);
    seek(Date.parse(startedAt) + 1000);
    follow$();
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (at === null || tNow >= END) seek(START);
    play$.current.t = at === null || tNow >= END ? START : tNow;
    setPlaying(true);
  };

  // Escape closes a close-up, then the panel; [ and ] step to the request before or after.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e)) return;
      const o = panel$.current;
      if (e.key === "Escape" && o) {
        go(isTab(o) ? null : lastTab.current);
        return;
      }
      if (e.key !== "[" && e.key !== "]") return;
      const all = view.requests;
      const i = all.findIndex((r) => r.id === floorReq$.current?.id);
      const to = all[i + (e.key === "]" ? 1 : -1)];
      if (to) pick(to.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, pick, view.requests]);

  const following = at === null;
  const pinnedNow = following && !!pinnedId;
  // A session over more than a day says the day with the time.
  const spansDays =
    dayOf(new Date(START).toISOString()) !== dayOf(new Date(END).toISOString());
  const total = Math.max(1, Math.round((END - START) / 1000));
  const working = scene.desks.filter((d) => d.status === "running");
  const carried = working.filter((d) => d.fromRequest);
  // The request as state.ts reads it, so the bar, the room and the panel agree. Paused is
  // not over: the panel reads it as stopped mid-work, not done.
  const state: RequestState = !mark
    ? "running"
    : mark.state === "running" || mark.state === "paused"
      ? "running"
      : mark.state === "waiting"
        ? "waiting"
        : "done";
  // Waiting on you: how many questions when there are more than one.
  const asks =
    mark?.state === "waiting" ? (mark.waiting?.questions.length ?? 0) : 0;
  const pill =
    !req || !mark
      ? null
      : ([
          mark.tone,
          `${mark.label}${asks > 1 ? ` · ${asks} questions` : ""}`,
        ] as const);
  const helperMeta = !working.length
    ? "No helpers at work"
    : !carried.length
      ? `${working.length} helper${working.length > 1 ? "s" : ""} at work`
      : `${working.length} helper${working.length > 1 ? "s" : ""} at work · ${carried.length} on ${[...new Set(carried.map((d) => `Req ${d.fromRequest}`))].join(", ")}`;

  useEffect(() => {
    document.title = scene.waiting
      ? "(!) Waiting on you · Murmur"
      : `${view.title || "Session"} · Murmur`;
  }, [scene.waiting, view.title]);

  // A tick's label, while the pointer is on the strip or a tick has the keyboard.
  const [tip, setTip] = useState<number | null>(null);
  const tickAt = (i: number) =>
    ((Date.parse(view.requests[i]?.startedAt ?? "") - START) /
      (END - START || 1)) *
    100;
  const nearest = (x: number, el: Element) => {
    const b = el.getBoundingClientRect();
    const t = START + ((x - b.left) / (b.width || 1)) * (END - START);
    let best = 0;
    view.requests.forEach((r, i) => {
      const d = Math.abs(Date.parse(r.startedAt) - t);
      const was = view.requests[best];
      if (was && d < Math.abs(Date.parse(was.startedAt) - t)) best = i;
    });
    return best;
  };
  const tipReq = tip === null ? undefined : view.requests[tip];

  // The rail and the requests list rewind with the replay: the requests asked by then,
  // each as it stood at that moment.
  const list = {
    sessionId,
    view: at === null ? view : viewT,
    events: at === null ? events : eventsT,
    currentId: reqId,
    activeId: liveActiveId,
    ses: at === null ? listSes : sesT,
    keep: keepFor(panel),
    onPick: pick,
  };

  return (
    <div
      className={[
        "office",
        phone ? "phone" : "",
        playing && speed >= 60 ? "fast" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <a className="of-skip" href={panel ? "#panel" : "#main"}>
        Skip to the content
      </a>
      <header className="of-top">
        <div className="of-top-row">
          <Brand />
          <SessionSwitcher
            sessionId={sessionId}
            title={view.title || "Untitled session"}
          />
          <RequestPicker
            {...list}
            n={scene.request.n}
            short={scene.request.short}
          />
          {following && reconnecting ? (
            <span
              className="of-tag quiet"
              title="The line to Murmur dropped; this shows the session as last heard, and catches up when it is back"
            >
              Reconnecting
            </span>
          ) : pinnedNow ? (
            <span
              className="of-tag pinned"
              title={`This floor is request ${scene.request.n} as it stands. Claude is on request ${scene.activeN}.`}
            >
              Pinned
            </span>
          ) : following && ses.tag === "live" ? (
            <span
              className="of-tag live"
              title="Following the session as it happens"
            >
              {ses.word}
            </span>
          ) : following && ses.tag === "waiting" ? (
            // Waiting on you ticks on, but nothing has happened: it is not live. How long the
            // wait has run is the pill's to say, so the bar never shows two clocks for it.
            <span
              className="of-tag quiet waiting"
              title={`Claude is waiting on you; nothing else has happened in this session for ${dur(quietFor)}.`}
            >
              Waiting
            </span>
          ) : following && open ? (
            <span
              className="of-tag quiet"
              title={`Nothing has happened in this session for ${dur(quietFor)}. It shows as it was left, and wakes up when Claude does.`}
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
          {pill && (
            <span className={`of-pill s-${pill[0]} m-${mark?.mark}`}>
              {pill[1]}
            </span>
          )}
          <span className="of-spacer" />
          <button
            type="button"
            className="of-details"
            aria-expanded={!!panel}
            onClick={() => {
              if (panel) return go(null);
              go(lastTab.current);
              setFocusKey((k) => k + 1);
            }}
          >
            Details
          </button>
          <Menu
            sessionId={sessionId}
            me={props.me}
            onSignOut={props.onSignOut}
          />
        </div>
        <div className="of-top-row of-status">
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
                if (id) pick(id);
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
          {req && (
            <NowLine
              request={req}
              done={state === "done"}
              events={drawerEvents}
              cwd={view.cwd}
              waiting={mark?.state === "waiting" ? mark.waiting : null}
              paused={mark?.state === "paused"}
            />
          )}
        </div>
      </header>

      <div className="of-body">
        {railOn && (
          <aside
            className={railOpen ? "of-rail" : "of-rail shut"}
            aria-label="Requests rail"
            style={{ "--of-rw": `${RAIL_W}px` } as React.CSSProperties}
          >
            <div className="of-rail-head">
              {railOpen && (
                <span
                  className="of-rail-k"
                  title={sessionFacts(list.view, list.ses)}
                >
                  {sessionFacts(list.view, list.ses)}
                </span>
              )}
              <button
                type="button"
                className="of-rail-btn"
                aria-expanded={railOpen}
                aria-label={
                  railOpen ? "Fold the requests rail" : "Show the requests rail"
                }
                title={railOpen ? "Fold the rail" : "Show the requests"}
                onClick={() => {
                  keep(RAIL_KEY, railOpen ? "shut" : "open");
                  setRailOpen(!railOpen);
                }}
              >
                <span className="of-rail-chev" aria-hidden="true" />
              </button>
            </div>
            {railOpen && <RequestList {...list} />}
          </aside>
        )}
        <main
          className={pw ? "of-stage with-panel" : "of-stage"}
          ref={stage}
          id="main"
          tabIndex={-1}
          style={{ "--of-pw": `${pw}px` } as React.CSSProperties}
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
          {panel && req && mark && (
            <div className="of-dock" ref={dock}>
              <Panel
                sessionId={sessionId}
                view={drawerView}
                events={drawerEvents}
                request={req}
                state={state}
                stands={mark}
                ses={sesT}
                waiting={mark.waiting}
                lastLooked={props.lastLooked ?? null}
                mainLog={mainLog}
                t={drawerT}
                following={following && !quietNow}
                models={models}
                open={panel}
                floorId={pinnedId}
                activeId={liveActiveId}
                phase={phase}
                wide={wideNow}
                onWide={
                  phone
                    ? undefined
                    : () => {
                        keep(WIDE_KEY, wide ? "docked" : "wide");
                        setWide(!wide);
                      }
                }
                focusKey={focusKey}
                onPickRequest={pick}
                onClose={() => go(null)}
              />
            </div>
          )}
        </main>
      </div>

      <footer className="of-replay">
        <div className="of-track">
          {/* Requests close in time overlap, so a click on the strip takes the nearest one;
              each tick is still its own button for the keyboard. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the ticks inside are the keyboard's way */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
          <div
            className="of-ticks"
            onClick={(e) => {
              const r = view.requests[nearest(e.clientX, e.currentTarget)];
              if (r) goTo(r.startedAt);
            }}
            onMouseMove={(e) => setTip(nearest(e.clientX, e.currentTarget))}
            onMouseLeave={() => setTip(null)}
          >
            {view.requests.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className={[
                  r.id === reqId ? "cur" : "",
                  Date.parse(r.startedAt) > tNow ? "later" : "",
                  i === tip ? "tip" : "",
                ].join(" ")}
                style={{ left: `${tickAt(i)}%` }}
                aria-label={`Go to request ${i + 1}: ${requestShort(r)}`}
                aria-current={r.id === reqId ? "true" : undefined}
                // One tab stop for the strip, not one per request: the rail lists them all.
                tabIndex={r.id === reqId ? 0 : -1}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(r.startedAt);
                }}
              />
            ))}
            {tipReq && tip !== null && (
              <span
                className={`of-tick-tip${tickAt(tip) > 70 ? " end" : tickAt(tip) < 30 ? " start" : ""}`}
                style={{ left: `${tickAt(tip)}%` }}
                aria-hidden="true"
              >
                <b className="of-tick-n">{tip + 1}</b> {requestShort(tipReq)}{" "}
                <span className="of-tick-when">
                  {spansDays ? `${dayOf(tipReq.startedAt)} ` : ""}
                  {clock(tipReq.startedAt)}
                </span>
              </span>
            )}
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
        <div className="of-ctl">
          <button
            type="button"
            className={playing ? "of-play on" : "of-play"}
            aria-label={playing ? "Pause replay" : "Play replay"}
            onClick={togglePlay}
          >
            <span className="of-play-icon" aria-hidden="true" />
          </button>
          <span className={spansDays ? "of-clock days" : "of-clock"}>
            {spansDays && <span className="of-day">{dayOf(iso)} </span>}
            {clockOf(iso)}
            {following
              ? live && !pinnedNow
                ? " · now"
                : open
                  ? " · latest"
                  : " · end"
              : ` · ${dur(END - tNow)} earlier`}
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
              following && !pinnedNow
                ? ses.tag === "live"
                  ? "of-live on live"
                  : "of-live on"
                : "of-live"
            }
            onClick={() => {
              setPlaying(false);
              seek(END);
              follow$();
            }}
            aria-label={
              ses.tag === "live"
                ? "Follow the session live"
                : open
                  ? "Jump to the latest moment"
                  : "Jump to the end"
            }
          >
            {ses.tag === "live" ? "Live" : open ? "Latest" : "End"}
          </button>
          <span className="of-spacer" />
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
              <i className="k paused" />
              Paused
            </span>
            <span className="of-lg">
              <i className="k open" />
              Left open
            </span>
            <span className="of-lg">
              <i className="k todo" />
              Not started
            </span>
          </div>
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
