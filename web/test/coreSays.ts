import { type MurmurEvent, reduce, type SessionView } from "@murmur/core";

/**
 * A made-up view with what core says of a wait: its `needsYou`, else core's reading of the
 * events given, and then its last request "waiting", as core marks the request asking.
 * Only core decides a wait (waitingOn), so a view made by hand says it the same way.
 */
export function asCoreSays(
  view: SessionView,
  events: MurmurEvent[] = [],
): SessionView {
  const needsYou = view.needsYou ?? reduce(events).needsYou;
  if (!needsYou) return view;
  const last = view.requests.length - 1;
  return {
    ...view,
    needsYou,
    requests: view.requests.map((r, i) =>
      i === last ? { ...r, state: "waiting" } : r,
    ),
  };
}
