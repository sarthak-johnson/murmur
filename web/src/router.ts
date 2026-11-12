import { useEffect, useState } from "react";

/** A request's views in the office's panel. */
export const TABS = ["story", "tasks", "flow", "files", "helpers"] as const;
export type Tab = (typeof TABS)[number];
/** The session's views in the office's panel. */
export const SESSION_TABS = ["journey", "timeline", "requests"] as const;
export type SessionTab = (typeof SESSION_TABS)[number];

/**
 * Every session URL is the office. The path is the floor: `/s/:sid` follows Claude's
 * current request, `/s/:sid/r/:rid` pins one. `?open=` is what the panel shows: a tab
 * (`story`, `journey`...) or a close-up (`task:<partId>`, `helper:<agentId>`, `door`,
 * `terminal`, `claude`). No `open` is a closed panel, or on a fresh load the default.
 */
export type Route =
  | { name: "home" }
  | { name: "device"; code: string }
  | { name: "settings" }
  | {
      name: "session";
      sessionId: string;
      requestId?: string;
      open?: string;
    }
  | { name: "notFound" };

function segments(path: string): { url: URL; seg: string[] } | null {
  const url = new URL(path, "http://x");
  try {
    return {
      url,
      seg: url.pathname.split("/").filter(Boolean).map(decodeURIComponent),
    };
  } catch {
    return null;
  }
}

export function matchRoute(path: string): Route {
  const at = segments(path);
  if (!at) return { name: "notFound" };
  const { url, seg } = at;
  const [a, b, c, d] = seg;
  if (seg.length === 0) return { name: "home" };
  if (a === "device" && seg.length === 1)
    return { name: "device", code: url.searchParams.get("code") ?? "" };
  if (a === "settings" && seg.length === 1) return { name: "settings" };
  if (a === "s" && b) {
    const open = url.searchParams.get("open") || undefined;
    const rest = open ? { open } : {};
    if (seg.length === 2) return { name: "session", sessionId: b, ...rest };
    if (c === "r" && d && seg.length === 4)
      return { name: "session", sessionId: b, requestId: d, ...rest };
  }
  return { name: "notFound" };
}

const enc = encodeURIComponent;
/** `open`'s value as it reads in a URL: a close-up's colon kept plain. */
const openQuery = (open: string | undefined | null) =>
  open ? `?open=${open.split(":").map(enc).join(":")}` : "";

/** A floor of the office (following, or pinned to a request) with what its panel shows. */
export const floorPath = (
  sessionId: string,
  requestId: string | undefined,
  open?: string | null,
) =>
  `/s/${enc(sessionId)}${requestId ? `/r/${enc(requestId)}` : ""}${openQuery(open)}`;

/** The office following the session, its panel on one of the session's views. */
export const sessionPath = (sessionId: string, tab?: SessionTab) =>
  floorPath(sessionId, undefined, tab);

/** A request's floor, its panel on one of its tabs (the story when none is named). */
export const requestPath = (sessionId: string, requestId: string, tab?: Tab) =>
  floorPath(sessionId, requestId, tab ?? "story");

/** A task's close-up on its request's floor. */
export const partPath = (
  sessionId: string,
  requestId: string,
  partId: string,
) => floorPath(sessionId, requestId, `task:${partId}`);

/** A helper's close-up on its request's floor. */
export const helperPath = (
  sessionId: string,
  requestId: string,
  agentId: string,
) => floorPath(sessionId, requestId, `helper:${agentId}`);

/**
 * The address an old link meant, for the pages the office replaced: the session's flow,
 * the office's own paths, a request's tab and a task's page. Null for a current address.
 */
export function redirectOf(path: string): string | null {
  const at = segments(path);
  if (!at) return null;
  const { url, seg } = at;
  const [a, b, c, d, e, f] = seg;
  if (a !== "s" || !b) return null;
  // The rest of the query (a flow board's `?part=`) and the hash come along.
  const keep = (to: string, open?: string) => {
    const q = new URLSearchParams(url.search);
    const o = open ?? q.get("open");
    q.delete("open");
    const rest = q.toString();
    return `${to}${openQuery(o)}${rest ? `${o ? "&" : "?"}${rest}` : ""}${url.hash}`;
  };
  if (seg.length === 3 && c === "flow")
    return keep(floorPath(b, undefined), "timeline");
  if (seg.length === 3 && c === "office") return keep(floorPath(b, undefined));
  if (c !== "r" || !d) return null;
  if (seg.length === 5 && e === "office") return keep(floorPath(b, d));
  if (seg.length === 5 && (TABS as readonly string[]).includes(e ?? ""))
    return keep(floorPath(b, d), e);
  if (seg.length === 6 && e === "p" && f)
    return keep(floorPath(b, d), `task:${f}`);
  return null;
}

/** What `navigate` keeps with an entry: the scroll it was left at, and a closed panel. */
interface EntryState {
  y?: number;
  closed?: boolean;
}
const entry = (): EntryState => (history.state as EntryState | null) ?? {};

/** The panel was closed on this entry (it survives a reload), so its default does not reopen it. */
export const closedHere = () => !!entry().closed;

/**
 * Moves to a path: a new history entry, so Back and Forward walk it. `closed` marks an
 * entry whose panel was closed by hand. A move to another page starts at its top.
 */
export function navigate(path: string, opts: { closed?: boolean } = {}): void {
  const another = new URL(path, location.href).pathname !== location.pathname;
  // Back lands where the reader was: the scroll stays with the entry it leaves.
  history.replaceState({ ...entry(), y: window.scrollY }, "");
  if (another) window.scrollTo(0, 0);
  history.pushState(opts.closed ? { closed: true } : null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** A link's click as an in-app move; a modified click still opens a new tab. */
export function follow(path: string) {
  return (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    navigate(path);
  };
}

const here = () => location.pathname + location.search + location.hash;

/** The route of the address shown, an old address first replaced by the one it meant. */
function current(): Route {
  const to = redirectOf(here());
  if (to) history.replaceState(history.state, "", to);
  return matchRoute(here());
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    let shown = location.pathname;
    const on = () => {
      const another = shown !== location.pathname;
      shown = location.pathname;
      setRoute(current());
      // Back lands where the reader was; another page with none kept starts at its top.
      const y = entry().y;
      if (typeof y === "number") window.scrollTo(0, y);
      else if (another) window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
