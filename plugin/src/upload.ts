import fs from "node:fs";
import path from "node:path";
import { type MurmurEvent, MurmurEventSchema } from "@murmur/core";
import {
  type Credentials,
  isRevoked,
  projectState,
  queueDir,
  readCredentials,
  setRevoked,
} from "./local.js";

const MAX_EVENTS = 200;
// The queue keeps at most 7 days and 50 MB; the oldest go first. The 7 days are time
// spent waiting in the queue (file mtime), so backfilled history is not dropped for its age.
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_QUEUE_BYTES = 50_000_000;
// Decimal MB, so batches fit whichever 5 MB the server's body limit means.
const MAX_BYTES = 5_000_000;
// Finished queue files only; temp files start with a dot.
const QUEUED = /^\d{15}-[^/\\]+\.json$/;
const WRAPPER = '{"events":[]}'.length;

// queue/<ms zero-padded to 15>-<id>.json, so lexical order is chronological.
// Written to a temp name and renamed, so a concurrent flush never reads half a file.
export function enqueue(e: MurmurEvent): void {
  const dir = queueDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ms = Date.parse(e.ts);
  const name = `${String(Number.isNaN(ms) ? Date.now() : ms).padStart(15, "0")}-${e.id}.json`;
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, name));
}

// The file's JSON text, or null when it vanished, was malformed or is no longer
// wanted (then deleted).
function readQueued(
  file: string,
  wanted: (e: MurmurEvent) => boolean,
): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const r = MurmurEventSchema.safeParse(JSON.parse(text));
    if (r.success && wanted(r.data)) return text;
  } catch {}
  fs.rmSync(file, { force: true });
  return null;
}

// Names (sorted, oldest first) left after dropping what is past 7 days or over the size cap.
function prune(dir: string, names: string[], maxBytes: number): string[] {
  const oldest = Date.now() - MAX_AGE_MS;
  const keep: string[] = [];
  let total = 0;
  for (const name of names.toReversed()) {
    const file = path.join(dir, name);
    let queuedAt: number;
    try {
      const st = fs.statSync(file);
      total += st.size;
      queuedAt = st.mtimeMs;
    } catch {
      continue;
    }
    if (total > maxBytes || queuedAt < oldest) fs.rmSync(file, { force: true });
    else keep.push(name);
  }
  return keep.reverse();
}

export interface FlushOptions {
  fetch?: typeof fetch;
  budgetMs?: number;
  batchSize?: number;
  queueBytes?: number;
}

// Safe to run in two processes at once: each deletes only what it sent, and the
// server dedupes ids, so a double send is harmless. Events from another login, or
// from a project that is no longer on, are deleted unsent.
export async function flush(
  c: Credentials,
  {
    fetch: fetchImpl = fetch,
    budgetMs = 3000,
    batchSize = MAX_EVENTS,
    queueBytes = MAX_QUEUE_BYTES,
  }: FlushOptions = {},
): Promise<{ sent: number; kept: number }> {
  const deadline = Date.now() + budgetMs;
  const dir = queueDir();
  const on = new Map<string, boolean>();
  const wanted = (e: MurmurEvent) => {
    if (e.machineId !== c.machineId) return false;
    if (!on.has(e.cwd)) on.set(e.cwd, projectState(e.cwd) === "on");
    return on.get(e.cwd) as boolean;
  };
  let names: string[] = [];
  let sent = 0;
  let i = 0;
  try {
    names = prune(
      dir,
      fs
        .readdirSync(dir)
        .filter((n) => QUEUED.test(n))
        .sort(),
      queueBytes,
    );
    const revoked = isRevoked();
    while (!revoked && i < names.length) {
      const batch: { name: string; json: string }[] = [];
      let bytes = WRAPPER;
      let j = i;
      for (; j < names.length && batch.length < batchSize; j++) {
        const name = names[j] as string;
        const json = readQueued(path.join(dir, name), wanted);
        if (json === null) continue;
        const add = Buffer.byteLength(json) + (batch.length ? 1 : 0);
        // An event too big on its own still goes, alone.
        if (batch.length && bytes + add >= MAX_BYTES) break;
        batch.push({ name, json });
        bytes += add;
      }
      const left = deadline - Date.now();
      if (batch.length && left <= 0) break;
      if (batch.length) {
        const res = await fetchImpl(`${c.server}/api/ingest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${c.token}`,
          },
          body: `{"events":[${batch.map((b) => b.json).join(",")}]}`,
          signal: AbortSignal.timeout(left),
        });
        if (res.status === 401) {
          // A login that replaced this token while the request was in flight
          // must not be marked disconnected by the old token's 401.
          if (readCredentials()?.token === c.token) setRevoked(true);
          break;
        }
        // One event the server will never take must not wedge the queue: drop it
        // and build the batch again without it.
        if (res.status === 400) {
          const b = (await res.json().catch(() => null)) as {
            error?: unknown;
            index?: unknown;
          } | null;
          const bad =
            b?.error === "invalid" && typeof b.index === "number"
              ? batch[b.index]
              : undefined;
          if (!bad) break;
          fs.rmSync(path.join(dir, bad.name), { force: true });
          continue;
        }
        const tooBig = res.status === 413 && batch.length === 1;
        if (!res.ok && !tooBig) break;
        for (const b of batch)
          fs.rmSync(path.join(dir, b.name), { force: true });
        if (!tooBig) sent += batch.length;
      }
      i = j;
    }
  } catch {
    // Network error, timeout or no queue dir: keep the rest for the next run.
  }
  const kept = names
    .slice(i)
    .filter((n) => fs.existsSync(path.join(dir, n))).length;
  return { sent, kept };
}
