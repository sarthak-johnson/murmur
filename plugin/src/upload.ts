import fs from "node:fs";
import path from "node:path";
import { type MurmurEvent, MurmurEventSchema } from "@murmur/core";
import { type Credentials, murmurDir } from "./local.js";

const MAX_EVENTS = 200;
// Decimal MB, so batches fit whichever 5 MB the server's body limit means.
const MAX_BYTES = 5_000_000;
// Finished queue files only; temp files start with a dot.
const QUEUED = /^\d{15}-[^/\\]+\.json$/;
const WRAPPER = '{"events":[]}'.length;

const queueDir = () => path.join(murmurDir(), "queue");

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

// The file's JSON text, or null when it vanished or was malformed (then deleted).
function readQueued(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    if (MurmurEventSchema.safeParse(JSON.parse(text)).success) return text;
  } catch {}
  fs.rmSync(file, { force: true });
  return null;
}

// Safe to run in two processes at once: each deletes only what it sent, and the
// server dedupes ids, so a double send is harmless.
export async function flush(
  c: Credentials,
  fetchImpl: typeof fetch = fetch,
  budgetMs = 3000,
): Promise<{ sent: number; kept: number }> {
  const deadline = Date.now() + budgetMs;
  const dir = queueDir();
  let names: string[] = [];
  let sent = 0;
  let i = 0;
  try {
    names = fs
      .readdirSync(dir)
      .filter((n) => QUEUED.test(n))
      .sort();
    while (i < names.length) {
      const batch: { name: string; json: string }[] = [];
      let bytes = WRAPPER;
      let j = i;
      for (; j < names.length && batch.length < MAX_EVENTS; j++) {
        const name = names[j] as string;
        const json = readQueued(path.join(dir, name));
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
        // A lone event the server will never take must not wedge the queue.
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
