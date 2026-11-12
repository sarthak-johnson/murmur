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
import { requestNow, sessionFacts, sessionNow, sessionTitle } from "../state";
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
import { backing, FIT_PAD, fitScale, isCrisp, layout, RAIL_W } from "./fit";
import { H, W } from "./map";
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
import { clockOf, dur, spread, timeAxis } from "./util";
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
  if (!view || status === "loading" || status === "error")
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
        <div className="of-empty-card px">
          <p className="of-kicker">
            {status === "error"
              ? "Not found"
              : note
                ? "Nothing yet"
                : "Loading"}
          </p>
          <p role="status">
            {status === "error"
              ? "This session could not be loaded. It may have been deleted."
              : (note ?? "Opening the office…")}
          </p>
          <a className="link-button" href="/" onClick={follow("/")}>
            All sessions
          </a>
        </div>
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
/** The least room between two ticks of the replay strip, in px: room for a number. */
const TICK_GAP = 12;
/** A tick's number shows when it is this far from the last number shown. */
const TICK_LABEL_GAP = 22;
/** Playing skips quiet stretches longer than this, landing a few seconds before the next event. */
const IDLE_MS = 3 * 60_000;
/** On the replay strip a quiet stretch takes no more width than this much work time. */
const AXIS_GAP = 5 * 60_000;
const LEAD_MS = 5_000;

const PHONE = 760;
/** Under this width the rail folds into the request picker. */
const RAIL_MIN = 1200;

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
 * story; else the reader's last choice, or the story where the room keeps its place beside
 * or above it (not on a phone, where the sheet would push the room off the screen).
 */
function defaultOpen(pinned: boolean): string | null {
  if (closedHere()) return null;
  if (pinned) return "story";
  const last = stored(PANEL_KEY);
  if (last === "closed") return null;
  if (last && isTab(last)) return last;
  return window.innerWidth > PHONE ? "story" : null;
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
  // Each second while it ticks; quiet, once a minute is enough to move its "quiet for".
  // A new event wakes it at once: its time is past the clock, so it reads live.
  const ticking = ses.ticking;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setWall(Date.now()), ticking ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [open, ticking]);
  const first = view.requests[0];
  const START = Date.parse(ses.from);
  // Reconnecting changes only the tag: the session is as last heard until the line is back.
  const reconnecting = status === "reconnecting";
  const live = ses.ticking;
  const lastAt = Date.parse(ses.last);
  const END = live ? Math.max(lastAt, wall) : lastAt;
  // A task's close-up keeps its request's pin even on the floor Claude is on: task ids
  // repeat across requests, so following would show another request's task once Claude
  // moves on.
  const pinnedId =
    props.pinnedId &&
    (props.pinnedId !== liveActiveId || !!props.open?.startsWith("task:")) &&
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
  // In a replay, the newest request at the moment goes on when the session has more of it
  // later (an event of it after the moment, before the next request): it is not over yet.
  const newestT = viewT.requests.at(-1);
  const goesOn = useMemo(() => {
    if (at === null || !newestT) return undefined;
    const next =
      view.requests[view.requests.findIndex((r) => r.id === newestT.id) + 1];
    const after = events[n];
    return after && (!next || after.ts < next.startedAt)
      ? newestT.id
      : undefined;
  }, [at, newestT, view.requests, events, n]);
  const sesT = useMemo(
    () => ({
      ...sessionNow(drawerView, status, tick, at === null && asking),
      goesOn,
    }),
    [drawerView, status, tick, at, asking, goesOn],
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
  const scene = derived ?? lastScene.current ?? newestScene();
  /** The live session's newest floor: it has one, since the page draws no office without. */
  function newestScene(): Scene {
    const s = deriveScene(view, view.requests.at(-1)?.id ?? "", iso, logs);
    if (!s) throw new Error("The office needs a session with a request.");
    return s;
  }

  // Every change of the panel is a step in the history: Back undoes it.
  const floor$ = useRef(pinnedId);
  floor$.current = pinnedId;
  // A task's close-up names its request: its id means nothing on another floor.
  const go = useCallback(
    (o: string | null) =>
      navigate(
        floorPath(
          sessionId,
          o?.startsWith("task:")
            ? (floor$.current ?? floorReq$.current?.id)
            : floor$.current,
          o,
        ),
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
  // A click's focus is taken once: the panel reopened by Back later does not pull focus in.
  const focusTaken = useRef(0);
  useEffect(() => {
    focusTaken.current = focusKey;
  }, [focusKey]);
  const focusNow = focusKey !== focusTaken.current ? focusKey : 0;
  const closePanel = useCallback(() => go(null), [go]);
  // Closed with nothing left to hold focus (the panel's own opener gone), focus goes back
  // to Details, the way it opens again.
  const detailsBtn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!panel && wasOpen.current) {
      const el = document.activeElement;
      if (!el || el === document.body) detailsBtn.current?.focus();
    }
    wasOpen.current = !!panel;
  }, [panel]);
  const [phase, setPhase] = useState<{ id: string; n: number }>();
  const [hover, setHover] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlayEl = useRef<HTMLDivElement>(null);
  const mapWrap = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  // The room's box is the body under the bars, less the rail: measured, never guessed from
  // the window, so the bars' own heights and the rail's width are always in it.
  const body = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, vw: 0, dpr: 1 });
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const on = () =>
      setBox({
        w: el.clientWidth,
        h: el.clientHeight,
        vw: window.innerWidth,
        dpr: window.devicePixelRatio || 1,
      });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    // A zoom, or the window dragged to another screen, changes the device px per CSS px,
    // and with it which scales are crisp: a resize may not come with it, so it is watched.
    window.addEventListener("resize", on);
    let mq: MediaQueryList | undefined;
    const onDpr = () => {
      on();
      watchDpr();
    };
    const watchDpr = () => {
      mq?.removeEventListener("change", onDpr);
      mq = window.matchMedia?.(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      mq?.addEventListener?.("change", onDpr);
    };
    watchDpr();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", on);
      mq?.removeEventListener?.("change", onDpr);
    };
  }, []);
  const phone = box.vw > 0 && box.vw <= PHONE;
  const railOn = box.vw >= RAIL_MIN;
  // The viewer's own choice for the rail; the panel folds it to its strip without touching it.
  const [railOpen, setRailOpen] = useState(() => stored(RAIL_KEY) !== "shut");
  // Opening the rail while it was folded for the panel keeps it open until the panel closes.
  const [railInsist, setRailInsist] = useState(false);
  useEffect(() => {
    if (!panel) setRailInsist(false);
  }, [panel]);
  // Docked unless the viewer pressed Wide: opening a view never takes the room's width.
  const [wide, setWide] = useState(() => stored(WIDE_KEY) === "wide");
  const wideNow = !!panel && wide && isWideView(panel);
  // Stable, so the memoised panel is not redrawn on every tick of the room.
  const toggleWide = useCallback(
    () =>
      setWide((w) => {
        keep(WIDE_KEY, w ? "docked" : "wide");
        return !w;
      }),
    [],
  );
  const lay = phone
    ? // A phone's page scrolls: the room takes its width, the sheet or the requests under it.
      {
        ...fitScale(box.w, Number.POSITIVE_INFINITY, box.dpr),
        rail: "none" as const,
        railFolded: false,
        pw: 0,
        below: panel ? ("panel" as const) : ("list" as const),
        rh: 0,
      }
    : layout({
        w: box.w,
        h: box.h,
        vw: box.vw,
        dpr: box.dpr,
        rail: railOn
          ? railOpen
            ? railInsist
              ? "insist"
              : "open"
            : "shut"
          : "none",
        panel: !!panel,
        wide: wideNow,
      });
  const railShown = lay.rail === "open";
  const pw = lay.pw;
  // The scale the room settles at; each frame draws the scale its box has on the way there.
  const scale = lay.scale;
  const selected = roomKey(panel, req);

  // The engine: one renderer and overlay per mount, painted every frame from refs.
  const engine = useRef<{ r: Renderer; o: Overlay } | null>(null);
  const live$ = useRef({ scene, iso, scale, hover, item: selected, phone });
  live$.current = { scene, iso, scale, hover, item: selected, phone };
  // The room's box, kept by an observer: a frame reads it without asking for a layout.
  const wrapBox = useRef({ w: 0, h: 0, x: 0, y: 0 });
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
    const wrap = mapWrap.current;
    const map = wrap?.firstElementChild as HTMLElement | null;
    const measure = () => {
      if (!wrap) return;
      const b = wrap.getBoundingClientRect();
      wrapBox.current = {
        w: wrap.clientWidth,
        h: wrap.clientHeight,
        x: b.left,
        y: b.top,
      };
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap) ro.observe(wrap);
    // The scale as drawn: it follows the box frame by frame, so a panel opening or a rail
    // folding (their widths slide) grows or shrinks the room smoothly, never a jump.
    let shown = { s: 0, d: 0, ml: -1, mt: -1, w: 0, h: 0 };
    const fitFrame = () => {
      const s = live$.current;
      const z = wrapBox.current;
      const d = window.devicePixelRatio || 1;
      const bh = s.phone ? Number.POSITIVE_INFINITY : z.h;
      const to = z.w ? fitScale(z.w, bh, d).scale : s.scale;
      // Eased toward it, so a snap to a crisp step glides too; never past what the box holds.
      const most = z.w
        ? Math.max(to, Math.min((z.w - FIT_PAD) / W, (bh - FIT_PAD) / H))
        : to;
      // While the box slides (a panel or the rail opening, Dock or Wide), the room is its
      // fit frame by frame: one motion with the box, centred all the way, never lagging it.
      // Once it rests, the room eases onto the crisp step under that fit.
      const moving = !!shown.w && (z.w !== shown.w || z.h !== shown.h);
      const eased = shown.s + (to - shown.s) * 0.35;
      const sc =
        !shown.s || reduced?.matches || Math.abs(to - shown.s) < 0.004
          ? to
          : moving
            ? most
            : Math.min(most, eased);
      // Centred, on whole device px: a room half a px off would smooth every pixel.
      const snap = (at: number, room: number, box: number) =>
        Math.max(0, Math.round((at + (box - room) / 2) * d) / d - at);
      const ml = snap(z.x, W * sc, z.w);
      const mt = s.phone ? FIT_PAD / 2 : snap(z.y, H * sc, z.h);
      if (sc !== shown.s || d !== shown.d) {
        o.setScale(sc);
        cv.classList.toggle("crisp", isCrisp(sc, d));
      }
      if (map && (ml !== shown.ml || mt !== shown.mt)) {
        map.style.marginLeft = `${ml}px`;
        map.style.marginTop = map.style.marginBottom = `${mt}px`;
      }
      shown = { s: sc, d, ml, mt, w: z.w, h: z.h };
      return { sc, k: backing(sc, d) };
    };
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
      const f = fitFrame();
      r.focusOn(pointedAgents(s.hover ?? s.item, s.scene));
      r.draw(now, s.iso, f.sc, f.k);
      o.render(s.scene, r.claudePos(), r.walkers(), s.item, s.hover, s.iso);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      o.destroy?.();
      engine.current = null;
    };
  }, []);

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

  // A box too small for the room to read whole (under the floor) pans it: the camera centres
  // on the thing the panel is about, else on Claude, or a pinned floor's board.
  const pans = lay.pans;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the room's box, floor or selection changing
  useEffect(() => {
    const w = mapWrap.current;
    if (!w || !pans) return;
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
  }, [pw, scale, box.w, box.h, pans, selected, reqId]);

  // On a phone the panel is a sheet under the room: whatever opens it (a tap, a link, an
  // address), it comes into view with its content, the same every way.
  const sheetOpen = phone && !!panel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new view of the sheet
  useEffect(() => {
    if (!sheetOpen) return;
    const raf = requestAnimationFrame(() =>
      dock.current?.scrollIntoView?.({ block: "start" }),
    );
    return () => cancelAnimationFrame(raf);
  }, [sheetOpen, panel, focusKey]);

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
  // Pinned to another request than Claude's: the floor does not follow.
  const pinnedNow = following && !!pinnedId && pinnedId !== liveActiveId;
  // A pinned old floor shows its request as it last stood: the bar says that moment, not now.
  const shownAt = pinnedNow && mark ? Math.min(END, Date.parse(mark.to)) : tNow;
  const shownIso = new Date(shownAt).toISOString();
  // A session over more than a day says the day with the time.
  const spansDays =
    dayOf(new Date(START).toISOString()) !== dayOf(new Date(END).toISOString());
  // The strip spends its width on what happened: a quiet stretch takes only AXIS_GAP.
  const axis = useMemo(
    () => timeAxis(eventMs, START, END, AXIS_GAP),
    [eventMs, START, END],
  );
  const total = Math.max(1, Math.round(axis.total / 1000));
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
          mark.mark,
        ] as const);
  const helperMeta = !working.length
    ? "No helpers at work"
    : !carried.length
      ? `${working.length} helper${working.length > 1 ? "s" : ""} at work`
      : `${working.length} helper${working.length > 1 ? "s" : ""} at work · ${carried.length} on ${[...new Set(carried.map((d) => `Req ${d.fromRequest}`))].join(", ")}`;

  useEffect(() => {
    document.title = scene.waiting
      ? "(!) Waiting on you · Murmur"
      : `${sessionTitle(view.title) || "Session"} · Murmur`;
  }, [scene.waiting, view.title]);

  // A tick's label, while the pointer is on the strip or a tick has the keyboard.
  const [tip, setTip] = useState<number | null>(null);
  // Where each request's tick sits on the strip: at its start, crowds spread so each is
  // its own target (36 requests in a morning would sit on one pixel). The strip spans the
  // footer less its 8 px insets each side.
  const stripW = Math.max(1, box.vw - 2 * 16 - 16);
  const tickPx = useMemo(
    () =>
      spread(
        view.requests.map(
          (r) => (axis.at(Date.parse(r.startedAt)) / axis.total) * stripW,
        ),
        stripW,
        TICK_GAP,
      ),
    [view.requests, axis, stripW],
  );
  const tickAt = (i: number) => ((tickPx[i] ?? 0) / stripW) * 100;
  // Numbers on the strip, as many as fit without touching, the last always.
  const tickLabels = useMemo(() => {
    const out = new Set<number>();
    let last = Number.NEGATIVE_INFINITY;
    const n = tickPx.length;
    tickPx.forEach((p, i) => {
      const room = i === n - 1 || (tickPx[n - 1] ?? 0) - p >= TICK_LABEL_GAP;
      if (p - last >= TICK_LABEL_GAP && room) {
        out.add(i);
        last = p;
      }
    });
    if (n) out.add(n - 1);
    return out;
  }, [tickPx]);
  /** The tick under a point of the strip: the nearest as drawn. */
  const nearest = (x: number, el: Element) => {
    const b = el.getBoundingClientRect();
    const px = ((x - b.left) / (b.width || 1)) * stripW;
    let best = 0;
    tickPx.forEach((p, i) => {
      if (Math.abs(p - px) < Math.abs((tickPx[best] ?? 0) - px)) best = i;
    });
    return best;
  };
  const tipReq = tip === null ? undefined : view.requests[tip];
  // The strip's one tab stop: the floor's tick, else the newest, so it always has one.
  const tickStop = view.requests.some((r) => r.id === reqId)
    ? reqId
    : view.requests.at(-1)?.id;

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
            title={sessionTitle(view.title) || "Untitled session"}
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
          ) : !following ? (
            <span
              className="of-tag replay"
              title={`A replay of this session. ${open ? "It is still open; its latest moment" : "It ended"} at ${clockOf(new Date(END).toISOString())}.`}
            >
              Replay
            </span>
          ) : ses.tag === "live" ? (
            <span
              className="of-tag live"
              title="Following the session as it happens"
            >
              {ses.word}
            </span>
          ) : // Quiet beside a pill that says waiting on you or paused, with its clock, is a
          // second state word: the pill says it.
          open &&
            (mark?.state === "waiting" ||
              mark?.state === "paused") ? null : open ? (
            <span
              className="of-tag quiet"
              title={`Nothing has happened in this session for ${dur(quietFor)}. It shows as it was left, and wakes up when Claude does.`}
            >
              Quiet · {dur(quietFor)}
            </span>
          ) : (
            // As the lobby says it: an ended session at its end is ended, not a replay.
            <span
              className={`of-tag ${ses.tag === "ended" ? "ended" : "replay"}`}
              title={`This session ${ses.tag === "ended" ? "ended" : "was last heard"} at ${clockOf(new Date(END).toISOString())}. The replay bar goes back to any moment of it.`}
            >
              {ses.tag === "ended" ? ses.word : "Replay"}
            </span>
          )}
          {pill && (
            <span className={`of-pill s-${pill[0]} m-${pill[2]}`}>
              {pill[1]}
            </span>
          )}
          <span className="of-spacer" />
          <button
            ref={detailsBtn}
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

      <div className="of-body" ref={body}>
        {railOn && (
          <aside
            className={railShown ? "of-rail" : "of-rail shut"}
            aria-label="Requests rail"
            style={{ "--of-rw": `${RAIL_W}px` } as React.CSSProperties}
          >
            <div className="of-rail-head">
              {railShown && (
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
                aria-expanded={railShown}
                aria-label={
                  railShown
                    ? "Fold the requests rail"
                    : "Show the requests rail"
                }
                title={
                  lay.railFolded
                    ? "Folded to make room for the panel: show the requests"
                    : railShown
                      ? "Fold the rail"
                      : "Show the requests"
                }
                onClick={() => {
                  // The viewer's own choice; opened while the panel is up, it stays open
                  // beside the panel until the panel closes.
                  keep(RAIL_KEY, railShown ? "shut" : "open");
                  setRailOpen(!railShown);
                  setRailInsist(!railShown && !!panel);
                }}
              >
                <span className="of-rail-chev" aria-hidden="true" />
              </button>
            </div>
            {railShown && <RequestList {...list} />}
          </aside>
        )}
        <main
          className={[
            "of-stage",
            lay.below ? "below" : "",
            lay.pans ? "pans" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          id="main"
          tabIndex={-1}
          style={
            {
              "--of-pw": `${pw}px`,
              "--of-rh": lay.rh ? `${lay.rh}px` : "auto",
            } as React.CSSProperties
          }
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
                onWide={phone ? undefined : toggleWide}
                focusKey={focusNow}
                onPickRequest={pick}
                onClose={closePanel}
              />
            </div>
          )}
          {!panel && lay.below === "list" && (
            // No rail beside the room and room to spare under it: the requests, not a band.
            <div className="of-dock of-under">
              <RequestList {...list} follow={!phone} />
            </div>
          )}
        </main>
      </div>

      <footer className="of-replay">
        <div className="of-track">
          {/* Requests close in time overlap, so a click on the strip takes the nearest one;
              each tick is still its own button for the keyboard. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the ticks inside are the keyboard's way */}
          <div
            className="of-ticks"
            // The arrow keys walk the ticks: one tab stop, every request in reach.
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              const all = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button",
                ),
              ];
              const i = all.indexOf(e.target as HTMLButtonElement);
              const to = all[i + (e.key === "ArrowRight" ? 1 : -1)];
              if (i < 0 || !to) return;
              e.preventDefault();
              e.stopPropagation();
              to.focus();
            }}
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
                tabIndex={r.id === tickStop ? 0 : -1}
                onFocus={() => setTip(i)}
                onBlur={() => setTip(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(r.startedAt);
                }}
              >
                {tickLabels.has(i) && (
                  <span className="of-tick-num" aria-hidden="true">
                    {i + 1}
                  </span>
                )}
              </button>
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
            value={Math.round(axis.at(shownAt) / 1000)}
            aria-label="Replay time"
            aria-valuetext={`${dayOf(new Date(shownAt).toISOString())} ${clockOf(new Date(shownAt).toISOString())}${
              pinnedNow
                ? `, request ${scene.request.n} as it stands`
                : following
                  ? ", the latest moment"
                  : `, ${dur(END - tNow)} before the latest`
            }`}
            // How far the replay has played, for the track's fill.
            style={
              {
                "--p": `${((axis.at(tNow) / axis.total) * 100).toFixed(2)}%`,
              } as React.CSSProperties
            }
            onChange={(e) => {
              setPlaying(false);
              const t = Math.round(axis.time(Number(e.target.value) * 1000));
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
            {spansDays && <span className="of-day">{dayOf(shownIso)} </span>}
            {clockOf(shownIso)}
            {pinnedNow
              ? ` · request ${scene.request.n}'s last`
              : following
                ? live
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
              pinnedNow
                ? `Back to following Claude, on request ${scene.activeN}`
                : ses.tag === "live"
                  ? "Follow the session live"
                  : open
                    ? "Jump to the latest moment"
                    : "Jump to the end"
            }
            title={
              pinnedNow
                ? `This floor is request ${scene.request.n}; Claude is on request ${scene.activeN}`
                : undefined
            }
          >
            {pinnedNow
              ? "Follow"
              : ses.tag === "live"
                ? "Live"
                : open
                  ? "Latest"
                  : "End"}
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
