import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "device"; code: string }
  | { name: "settings" }
  | { name: "session"; sessionId: string }
  | { name: "request"; sessionId: string; requestId: string }
  | { name: "part"; sessionId: string; requestId: string; partId: string }
  | { name: "notFound" };

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
      return { name: "request", sessionId: b, requestId: d };
    if (c === "r" && d && e === "p" && seg.length === 6 && seg[5]) {
      return { name: "part", sessionId: b, requestId: d, partId: seg[5] };
    }
  }
  return { name: "notFound" };
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
