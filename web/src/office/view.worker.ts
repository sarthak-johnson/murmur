// Reduces the session up to a moment of the replay, off the main thread.
import { type MurmurEvent, reduce } from "@murmur/core";

let events: MurmurEvent[] = [];

self.onmessage = (
  m: MessageEvent<{ events?: MurmurEvent[]; reset?: boolean; n?: number }>,
) => {
  const d = m.data;
  if (d.events) events = d.reset ? d.events : events.concat(d.events);
  if (d.n !== undefined)
    self.postMessage({ n: d.n, view: reduce(events.slice(0, d.n)) });
};
