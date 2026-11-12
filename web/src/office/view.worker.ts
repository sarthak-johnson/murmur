// Reduces the session up to a moment of the replay, off the main thread.
import { type MurmurEvent, reduce } from "@murmur/core";
import type { FromWorker, ToWorker } from "./feed";

let events: MurmurEvent[] = [];

self.onmessage = (m: MessageEvent<ToWorker>) => {
  const d = m.data;
  if ("events" in d) {
    events = events.slice(0, d.from).concat(d.events);
    return;
  }
  let reply: FromWorker;
  try {
    reply = { gen: d.gen, n: d.n, view: reduce(events.slice(0, d.n)) };
  } catch (e) {
    reply = { gen: d.gen, n: d.n, error: String(e) };
  }
  self.postMessage(reply);
};
