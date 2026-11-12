/*
 * Reduces a session to its summary off the server's event loop (summary.ts starts it).
 * Takes { id, events } pages of one read and { id, end: true }; answers { id, summary }
 * (null for no events) or { id, error }; { id, end: true, drop: true } forgets a read.
 */
import { parentPort } from "node:worker_threads";
import { type MurmurEvent, reduce } from "@murmur/core";
import { summarize } from "./summarize.js";

const port = parentPort;
if (!port) throw new Error("summary-worker runs as a worker");
// ponytail: a read holds its whole session in memory before reduce runs (reduce takes
// the full list); a session of a few hundred thousand events is a few hundred MB here.
// Fold pages into an incremental reduce if sessions ever grow that long.
const reads = new Map<number, MurmurEvent[]>();
port.on(
  "message",
  (m: {
    id: number;
    events?: MurmurEvent[];
    end?: boolean;
    drop?: boolean;
  }) => {
    const list = reads.get(m.id) ?? [];
    if (m.events) {
      list.push(...m.events);
      reads.set(m.id, list);
    }
    if (!m.end) return;
    reads.delete(m.id);
    if (m.drop) return;
    try {
      // A session with no events left has nothing to say.
      const summary = list.length ? summarize(reduce(list)) : null;
      port.postMessage({ id: m.id, summary });
    } catch (e) {
      port.postMessage({ id: m.id, error: String(e) });
    }
  },
);
