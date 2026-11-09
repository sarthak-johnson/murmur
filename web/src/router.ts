import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** The views of a request page, each its own URL: Story is the bare request path. */
export const TABS = ["story", "flow", "files", "helpers"] as const;
export type Tab = (typeof TABS)[number];

export type Route =
  | { name: "home" }
  | { name: "device"; code: string }
  | { name: "settings" }
  | { name: "session"; sessionId: string }
  | { name: "request"; sessionId: string; requestId: string; tab: Tab }
  | { name: "part"; sessionId: string; requestId: string; partId: string }
  | { name: "notFound" };

const isTab = (s: string | undefined): s is Tab =>
  !!s && s !== "story" && (TABS as readonly string[]).includes(s);

export function matchRoute(path: string): Route {
  const url = new URL(path, "http://x");
  const seg = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d, e] = seg;
  if (seg.length === 0) return { name: "home" };
  if (a === "device" && seg.length === 1)
    return { name: "device", code: url.searchParams.get("code") ?? "" };
  if (a === "settings" && seg.length === 1) return { name: "settings" };
  if (a === "s" && b) {
    if (seg.length === 2) return { name: "session", sessionId: b };
    if (c === "r" && d && seg.length === 4)
      return { name: "request", sessionId: b, requestId: d, tab: "story" };
    if (c === "r" && d && seg.length === 5 && isTab(e))
      return { name: "request", sessionId: b, requestId: d, tab: e };
    if (c === "r" && d && e === "p" && seg.length === 6 && seg[5]) {
      return { name: "part", sessionId: b, requestId: d, partId: seg[5] };
    }
  }
  return { name: "notFound" };
}

const enc = encodeURIComponent;

/** A session's path. */
export const sessionPath = (sessionId: string) => `/s/${enc(sessionId)}`;

/** A request's path, with its tab: `/s/:sid/r/:rid`, `/s/:sid/r/:rid/flow` and so on. */
export function requestPath(sessionId: string, requestId: string, tab?: Tab) {
  const base = `/s/${enc(sessionId)}/r/${enc(requestId)}`;
  return tab && tab !== "story" ? `${base}/${tab}` : base;
}

/** A task's page. */
export const partPath = (
  sessionId: string,
  requestId: string,
  partId: string,
) => `${requestPath(sessionId, requestId)}/p/${enc(partId)}`;

type Transitioning = Document & {
  startViewTransition?(update: () => void): unknown;
};

/**
 * Moves to a path. Where the browser has View Transitions the change runs inside one, so
 * the request title morphs and the page rises (theme.css); elsewhere it is instant.
 */
export function navigate(path: string): void {
  const go = () => {
    history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const doc = document as Transitioning;
  if (typeof doc.startViewTransition !== "function") {
    go();
    return;
  }
  // The DOM must be the new page when the callback returns, so React renders at once.
  doc.startViewTransition(() => flushSync(go));
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

export function useRoute(): Route {
  const [route, setRoute] = useState(() =>
    matchRoute(location.pathname + location.search),
  );
  useEffect(() => {
    const on = () => setRoute(matchRoute(location.pathname + location.search));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
