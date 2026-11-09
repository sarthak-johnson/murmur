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
  let seg: string[];
  try {
    seg = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { name: "notFound" };
  }
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
  startViewTransition?(update: () => void): { finished: Promise<unknown> };
};

/** While set on <html>, only `.vt-src` carries the title's transition name (theme.css). */
const MORPH = "vt-morph";
const SRC = "vt-src";

/** Names `el` the morphing card for one snapshot; `null` takes the name back. */
function mark(el: Element | null) {
  for (const old of document.querySelectorAll(`.${SRC}`))
    old.classList.remove(SRC);
  document.documentElement.classList.toggle(MORPH, !!el);
  el?.classList.add(SRC);
}

/** Set while navigate's own popstate runs, so useRoute starts no second transition. */
let moving = false;

/**
 * Moves to a path. Where the browser has View Transitions the change runs inside one: a
 * clicked card marked `data-morph` (a station, a rail row, a track station) grows into the
 * next page's title, and the page rises (theme.css); elsewhere it is instant.
 */
export function navigate(path: string, from?: Element | null): void {
  // Another page starts at its top, as a real link would; a hash within the page scrolls itself.
  const another = new URL(path, location.href).pathname !== location.pathname;
  const go = () => {
    // Back lands where the reader was: the scroll stays with the entry it leaves.
    history.replaceState({ y: window.scrollY }, "");
    if (another) window.scrollTo(0, 0);
    history.pushState(null, "", path);
    moving = true;
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
    } finally {
      moving = false;
    }
  };
  const doc = document as Transitioning;
  if (typeof doc.startViewTransition !== "function") {
    go();
    return;
  }
  mark(from?.closest("[data-morph]") ?? null);
  // The DOM must be the new page when the callback returns, so React renders at once.
  doc.startViewTransition(() => {
    mark(null);
    flushSync(go);
  });
}

/** A link's click as an in-app move; a modified click still opens a new tab. */
export function follow(path: string) {
  return (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    navigate(path, e.currentTarget as Element);
  };
}

/**
 * The card linking to `path` (its `href`, or the path in `data-morph` for a card that is
 * not itself the link): the main column's last one, else the rail's.
 */
function cardFor(path: string): Element | null {
  const all = [...document.querySelectorAll("[data-morph]")].filter(
    (el) => (el.getAttribute("data-morph") || el.getAttribute("href")) === path,
  );
  return all.findLast((el) => el.closest("main")) ?? all[0] ?? null;
}

/** The scroll an entry was left at, once its page is drawn. */
function restore() {
  const y = (history.state as { y?: unknown } | null)?.y;
  if (typeof y === "number") window.scrollTo(0, y);
}

const here = () => location.pathname + location.search;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => matchRoute(here()));
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    let shown = location.pathname;
    const on = () => {
      const left = shown;
      shown = location.pathname;
      const show = () => setRoute(matchRoute(here()));
      const doc = document as Transitioning;
      if (moving) return show();
      if (typeof doc.startViewTransition !== "function") {
        flushSync(show);
        return restore();
      }
      // Back or forward: the same path reversed, the title shrinking into its card.
      doc
        .startViewTransition(() => {
          flushSync(show);
          restore();
          mark(left === shown ? null : cardFor(left));
        })
        .finished.finally(() => mark(null));
    };
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
