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

let named: Element | null = null;

/** Names `el` the morphing card for one snapshot; `null` takes the name back. */
function mark(el: Element | null) {
  for (const old of document.querySelectorAll(`.${SRC}`))
    old.classList.remove(SRC);
  document.documentElement.classList.toggle(MORPH, !!el);
  el?.classList.add(SRC);
  named = el;
}

/**
 * Takes the name back from `el` only: a transition skipped by a quicker click still runs
 * its update, and must not unname the card that click named.
 */
const unmark = (el: Element | null) => named === el && mark(null);

/**
 * While set on <html>, the morph keeps both pictures at their own size (theme.css): the
 * source was a wide track's station, whose dot would otherwise blow up to the title's size.
 */
const DOT = "vt-dot";
let latest: object | null = null;

/** Marks the morph as a dot's (or not) until the newest transition has run. */
function dot(el: Element | null) {
  document.documentElement.classList.toggle(DOT, !!el?.closest(".trk-st"));
}

/** Runs `update` as a transition, the dot mark kept until the newest one has run. */
function transition(doc: Transitioning, update: () => void) {
  const t = doc.startViewTransition?.(update);
  if (!t) return;
  latest = t;
  return t.finished.finally(
    () => latest === t && document.documentElement.classList.remove(DOT),
  );
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
  const src = from?.closest("[data-morph]") ?? null;
  mark(src);
  dot(src);
  // The DOM must be the new page when the callback returns, so React renders at once.
  transition(doc, () => {
    unmark(src);
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
 * not itself the link): the main column's first one on screen, else its last, else the
 * rail's. Called once the page has its scroll back.
 */
function cardFor(path: string): Element | null {
  const all = [...document.querySelectorAll("[data-morph]")].filter(
    (el) => (el.getAttribute("data-morph") || el.getAttribute("href")) === path,
  );
  const main = all.filter((el) => el.closest("main"));
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  };
  return main.find(shown) ?? main.at(-1) ?? all[0] ?? null;
}

/**
 * The scroll an entry was left at, once its page is drawn; another page with none kept
 * (one the browser's back left) starts at its top, a hash within the page scrolls itself.
 */
function restore(another: boolean) {
  const y = (history.state as { y?: unknown } | null)?.y;
  if (typeof y === "number") window.scrollTo(0, y);
  else if (another) window.scrollTo(0, 0);
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
        return restore(left !== shown);
      }
      // Back or forward: the same path reversed, the title shrinking into its card.
      let card: Element | null = null;
      transition(doc, () => {
        flushSync(show);
        restore(left !== shown);
        card = left === shown ? null : cardFor(left);
        mark(card);
        dot(card);
      })?.finally(() => unmark(card));
    };
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
