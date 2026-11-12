/*
 * Where things stand at a moment, read once for every view: the room and each panel say
 * the same word, draw the same mark and time the same span for a session, a request, a
 * task (or part) and a helper.
 *
 * - A session is live while its stream is up, it has not ended and something happened in
 *   the last 15 minutes. Waiting on you keeps its clock running however long the wait, but
 *   it reads as waiting, not live. Otherwise it is quiet, and its clocks stop at its last
 *   event.
 * - A request core calls running is paused once the session is not ticking or nothing of
 *   its own (its events, its running helpers) has happened for an hour.
 * - A helper silent for an hour is not at work, whatever its last word: it reads paused
 *   at its last sign. Running helpers of a request that is over were left open.
 */
import type {
  AgentView,
  MurmurEvent,
  PartView,
  RequestView,
  SessionView,
  TaskView,
} from "@murmur/core";
import type { SessionRow } from "./api";
import { dayLabel } from "./format";
import {
  type Mark,
  QUIET_MS,
  requestMark,
  STALE_MS,
  type Waiting,
} from "./session";
import { duration, nOf } from "./story";
import type { SessionStatus } from "./useSession";

export { QUIET_MS, STALE_MS };

const DAY_MS = 86_400_000;

export type State =
  | "running"
  | "waiting"
  | "paused"
  | "done"
  | "open"
  | "failed"
  | "todo";

export const WORD: Record<State, string> = {
  running: "Running",
  waiting: "Waiting on you",
  paused: "Paused",
  done: "Done",
  open: "Left open",
  failed: "Failed",
  todo: "Not started",
};

/** The rail's and stickies' mark for a state: each state has its own. */
export const MARK: Record<State, Mark> = {
  running: "running",
  waiting: "waiting",
  paused: "paused",
  done: "done",
  open: "open",
  failed: "failed",
  todo: "todo",
};

/** The status class a state is drawn with (the office's `s-*`, the part page's glyph). */
export type Tone = "now" | "blocked" | "todo" | "failed" | "done";
export const TONE: Record<State, Tone> = {
  running: "now",
  waiting: "blocked",
  paused: "todo",
  done: "done",
  open: "todo",
  failed: "failed",
  todo: "todo",
};

/** Over: nothing more will happen to it. */
export const isOver = (s: State) =>
  s === "done" || s === "open" || s === "failed";

/** "40 m", "3 h 07 m", "<1 m". */
export const took = (from: string, to: string) => {
  const d = duration(from, to);
  return d === "under a minute" ? "<1 m" : d;
};

const iso = (ms: number) => new Date(ms).toISOString();
const latest = (xs: (string | undefined)[]) =>
  xs.reduce<string>((a, b) => (b && b > a ? b : a), "");

export type SessionTag =
  | "live"
  | "waiting"
  | "quiet"
  | "reconnecting"
  | "ended"
  | "offline";

export const SESSION_WORD: Record<SessionTag, string> = {
  live: "Live",
  waiting: "Waiting on you",
  quiet: "Quiet",
  reconnecting: "Reconnecting",
  ended: "Ended",
  offline: "Offline",
};

export interface SessionNow {
  /** The moment read. */
  at: string;
  /** The stream is up (or briefly reconnecting) and the session has not ended. */
  open: boolean;
  /**
   * The room follows real time: open, and active lately or waiting on you (a wait's own
   * clock runs on however long it lasts).
   */
  ticking: boolean;
  tag: SessionTag;
  word: string;
  /** How long since its last event, while open. */
  quietFor: number;
  /**
   * Where the clocks of work stop: the moment while live, else its last event. The
   * session's span, its last chapter and its running request all end here.
   */
  end: string;
  /** Its first request's start (else its first event's). */
  from: string;
  /** Its last event. */
  last: string;
}

/**
 * A session at a moment (`at`, default now), with its stream's status. `asking`: a wait
 * read from the events (a question in Claude's last message) waits as `needsYou` does.
 */
export function sessionNow(
  view: Pick<
    SessionView,
    "ended" | "lastEventAt" | "startedAt" | "needsYou"
  > & {
    requests: readonly { startedAt: string }[];
  },
  stream: SessionStatus = "live",
  at: number = Date.now(),
  asking = false,
): SessionNow {
  const last = Date.parse(view.lastEventAt);
  // A reconnect is a blip, not the session stopping: it stays open meanwhile.
  const open = (stream === "live" || stream === "reconnecting") && !view.ended;
  const quietFor = open ? Math.max(0, at - last) : 0;
  const recent = quietFor < QUIET_MS;
  const waits = !!view.needsYou || asking;
  const ticking = open && (recent || waits);
  const tag: SessionTag = view.ended
    ? "ended"
    : !open
      ? "offline"
      : stream === "reconnecting"
        ? "reconnecting"
        : recent
          ? "live"
          : waits
            ? "waiting"
            : "quiet";
  return {
    at: iso(at),
    open,
    ticking,
    tag,
    word: SESSION_WORD[tag],
    quietFor,
    end: tag === "live" ? iso(Math.max(at, last)) : view.lastEventAt,
    from: view.requests[0]?.startedAt ?? view.startedAt,
    last: view.lastEventAt,
  };
}

/**
 * How long a session has run, in words: "21 h 57 m", "3 days". From its first request to
 * where its clocks stop (`end`), so it matches the spans of its requests and chapters.
 */
export function sessionSpan(ses: SessionNow): string {
  const to = ses.end;
  const ms = Date.parse(to) - Date.parse(ses.from);
  const days = Math.round(ms / DAY_MS);
  return ms < DAY_MS
    ? duration(ses.from, to)
    : `${days} ${days === 1 ? "day" : "days"}`;
}

/** "13 requests · 136 helpers · 7 days". */
export function sessionFacts(view: SessionView, ses: SessionNow): string {
  const helpers = view.requests.reduce((n, r) => n + r.tally.helpers, 0);
  const span = sessionSpan(ses);
  return [
    nOf(view.requests.length, "request"),
    ...(helpers ? [nOf(helpers, "helper")] : []),
    span === "under a minute" ? "just started" : span,
  ].join(" · ");
}

export interface Listed {
  /** The session's title, as its top bar says it. */
  title: string;
  tag: SessionTag;
  word: string;
  /** "Fri 6 Nov": the day its first request began, as its Journey says it. */
  day: string;
  /** "14 requests · 219 helpers", when known. */
  facts: string;
}

/**
 * A session in the lobby and the switcher, from its row: named, counted and dated as its
 * page reads it, live and quiet by `sessionNow`. Waiting on you comes first there: it is
 * the one thing in the list the reader can do.
 */
export function listedNow(row: SessionRow, at: number = Date.now()): Listed {
  const s = row.summary;
  const ses = sessionNow(
    {
      ended: row.ended,
      lastEventAt: row.lastEventAt,
      startedAt: row.startedAt,
      needsYou: null,
      requests: s ? [{ startedAt: s.from }] : [],
    },
    "live",
    at,
    !!s?.waitingSince,
  );
  const tag: SessionTag =
    s?.waitingSince && ses.tag === "live" ? "waiting" : ses.tag;
  return {
    title: s?.title || row.title || "Untitled session",
    tag,
    word: SESSION_WORD[tag],
    day: dayLabel(ses.from),
    facts: s
      ? [
          nOf(s.requests, "request"),
          ...(s.helpers ? [nOf(s.helpers, "helper")] : []),
        ].join(" · ")
      : "",
  };
}

export interface RequestNow {
  state: State;
  word: string;
  mark: Mark;
  tone: Tone;
  waiting: Waiting | null;
  /** When it started. */
  from: string;
  /**
   * Where its run's clock stops: the session's `end` while it runs (or, the newest, pauses
   * or waits with helpers at work), its last activity otherwise.
   */
  to: string;
  /** Its last activity (core's reading). */
  end: string;
  /** Its state's own span: the wait while waiting (to the moment), else its run. */
  clock: string;
  /** "Running · 40 m", "Waiting on you · 5 m", "Paused · ran 33 h 53 m", "Done · 2 h 07 m". */
  label: string;
}

/** The request's last sign of work: its own last event, or a running helper's. */
function lastSign(req: RequestView, end: string): string {
  return latest([
    end,
    ...req.agents
      .filter((a) => a.status === "running")
      .map((a) => a.doing?.ts ?? a.startedAt),
  ]);
}

/** A request at the session's moment. */
export function requestNow(
  view: SessionView,
  req: RequestView,
  events: MurmurEvent[],
  ses: SessionNow,
): RequestNow {
  const m = requestMark(view, req, events);
  const at = Date.parse(ses.at);
  // Every later event is the newest request's: its work runs to the session's end.
  const newest = req === view.requests.at(-1);
  let state: State;
  let to: string;
  if (m.mark === "running") {
    const sign = lastSign(req, m.end);
    const stale = !ses.ticking || at - Date.parse(sign) >= STALE_MS;
    state = stale ? "paused" : "running";
    to = !stale || newest ? latest([ses.end, sign]) : sign;
  } else if (m.mark === "waiting") {
    state = "waiting";
    // Its run stops at its last word, unless its helpers are still at work.
    const working = req.agents.some((a) => a.status === "running");
    to = newest && working ? ses.end : m.end;
  } else {
    state = m.mark;
    to = m.end;
  }
  const from = req.startedAt;
  // A wait's clock runs to the moment, however long it lasts.
  const clock =
    state === "waiting"
      ? took(m.waiting?.since ?? from, ses.ticking ? ses.at : ses.last)
      : took(from, to);
  const label =
    state === "paused"
      ? `${WORD.paused} · ran ${clock}`
      : `${WORD[state]} · ${clock}`;
  return {
    state,
    word: WORD[state],
    mark: MARK[state],
    tone: TONE[state],
    waiting: m.waiting,
    from,
    to,
    end: m.end,
    clock,
    label,
  };
}

/**
 * A request's state by core's reading alone, for a view handed only the request: no
 * clock, so never paused. `requestNow` is the full reading.
 */
export function coreState(req: RequestView): State {
  const s = req.state;
  if (s === "left-open") return "open";
  if (s === "running" || s === "waiting" || s === "done" || s === "failed")
    return s;
  return req.finished ? "done" : "running";
}

/**
 * A plan task's or a map part's state, under its request's. Once the request is over, work
 * not done was left open; while it is paused, work under way is paused too.
 */
export function workState(
  status: TaskView["status"] | PartView["status"],
  request: State,
): State {
  if (status === "failed") return "failed";
  if (status === "done") return "done";
  if (isOver(request)) return "open";
  if (status === "blocked") return "waiting";
  if (status === "now") return request === "paused" ? "paused" : "running";
  return "todo";
}

export interface HelperNow {
  state: State;
  word: string;
  mark: Mark;
  tone: Tone;
  from: string;
  /** Where its clock stops: the moment while it runs, else its end (or last sign). */
  to: string;
  /** Its last sign of life. */
  sign: string;
}

/**
 * A helper at a moment (`at`, ISO), under its request's state. Silent for an hour, it is
 * paused at its last sign; still running in a request that is over, it was left open.
 */
export function helperNow(
  a: AgentView,
  at: string,
  request?: State,
): HelperNow {
  const sign = a.doing?.ts ?? a.startedAt;
  const failed = /failed|killed/.test(a.report?.status ?? "");
  let state: State;
  let to: string;
  if (a.status === "running") {
    if (request && isOver(request)) state = "open";
    else if (
      request === "paused" ||
      Date.parse(at) - Date.parse(sign) >= STALE_MS
    )
      state = "paused";
    else state = "running";
    to = state === "running" ? at : latest([sign, a.report?.ts]);
  } else {
    state = failed ? "failed" : "done";
    to = a.endedAt ?? a.report?.ts ?? sign;
  }
  return {
    state,
    word: WORD[state],
    mark: MARK[state],
    tone: TONE[state],
    from: a.startedAt,
    to,
    sign,
  };
}
