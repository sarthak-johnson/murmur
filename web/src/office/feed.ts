// The office's data, from the same events the rest of the app reads: Claude's own tool calls
// (where Claude stands), the files touched over time (which binders light up), helper models,
// and the session as it stood at any moment of the replay.
import {
  type AgentView,
  type MurmurEvent,
  reduce,
  relPath,
  type SessionView,
} from "@murmur/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { modelOf } from "../session";
import { latestAt, type MainEntry, type OfficeLogs } from "./scene";

const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" ? (x as Record<string, unknown>) : {};

/** Cut at a word within n characters. */
const cut = (s: string | undefined, n: number) =>
  s && s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s;

const MURMUR_TOOL = /^mcp__plugin_murmur_murmur__/;

/** Claude's own (main-thread) calls, turn starts and ends: where Claude stands in the room. */
export function mainLogOf(events: MurmurEvent[]): MainEntry[] {
  const log: MainEntry[] = [];
  for (const e of events) {
    const p = e.payload;
    if (p.agent_id) continue;
    if (e.hook === "UserPromptSubmit") {
      const report = str(p.prompt)?.startsWith("<task-notification>");
      log.push({ t: e.ts, k: report ? "report" : "prompt" });
    } else if (e.hook === "Stop") log.push({ t: e.ts, k: "stop" });
    else if (e.hook === "PreToolUse") {
      const ti = obj(p.tool_input);
      const tool = (str(p.tool_name) ?? "").replace(MURMUR_TOOL, "murmur:");
      const file = str(ti.file_path)?.split("/").pop();
      const label =
        str(ti.description) ?? str(ti.now) ?? str(ti.summary) ?? file;
      const entry: MainEntry = {
        t: e.ts,
        k: "tool",
        tool,
        label: cut(label, 120),
      };
      if (tool === "SendMessage") entry.to = str(ti.to);
      if (tool === "Agent") {
        entry.desc = str(ti.description);
        entry.model = str(ti.model);
      }
      if (tool === "murmur:narrate") entry.task = str(ti.task);
      log.push(entry);
    }
  }
  return log;
}

export interface FileHit {
  t: string;
  path: string;
  /** The request whose files list it, for an edit. */
  req?: string;
  kind: "edit" | "read";
  /** The helper that read it, for a read. */
  agent?: string;
}

/** Every edit and read of a file, oldest first: the archive's binders light up as they pass. */
export function fileLogOf(view: SessionView, events: MurmurEvent[]): FileHit[] {
  const tsById = new Map(events.map((e) => [e.id, e.ts]));
  const out: FileHit[] = [];
  for (const r of view.requests) {
    const touches = [...r.parts.flatMap((p) => p.files), ...r.looseFiles];
    for (const f of touches)
      for (const id of f.eventIds) {
        const t = tsById.get(id);
        if (t) out.push({ t, path: f.path, req: r.id, kind: "edit" });
      }
  }
  for (const e of events) {
    const p = e.payload;
    const path = str(obj(p.tool_input).file_path);
    if (e.hook !== "PreToolUse" || p.tool_name !== "Read" || !path) continue;
    // Core keeps edited paths relative to the project; a read names the same binder.
    const hit: FileHit = { t: e.ts, path: relPath(path, e.cwd), kind: "read" };
    const agent = str(p.agent_id);
    if (agent) hit.agent = agent;
    out.push(hit);
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/** The helpers whose own file list has a file, per request: who lights a binder. */
export function touchersOf(view: SessionView): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const r of view.requests)
    for (const a of r.agents)
      for (const f of a.files ?? []) {
        const k = `${r.id}|${f}`;
        const list = by.get(k);
        if (list) list.push(a.id);
        else by.set(k, [a.id]);
      }
  return by;
}

const base = (p: string | undefined) =>
  (p ?? "").replace(/["']/g, "").split("/").filter(Boolean).pop() ?? "";
const LEAD = /^\s*(cd\s+\S+\s*(&&|;)|[A-Z_]+=\S*\s*(&&|;)?)\s*/;
const FILE_ARG = /^[^-<>|&;$][^<>|&;$]*\.[a-z]{1,5}$/i;

/**
 * A helper's action in plain words, more exact than a generic "Running a command": the
 * Bash description, else what the command does to which file. Undefined says nothing,
 * and the lit screen and typing hands say enough.
 */
export function actionText(
  tool: string,
  ti: Record<string, unknown>,
): string | undefined {
  const file = str(ti.file_path);
  if (tool === "Read") return `Reading ${base(file)}`;
  if (tool === "Write") return `Writing ${base(file)}`;
  if (tool === "Edit" || tool === "MultiEdit") return `Editing ${base(file)}`;
  if (tool === "Grep" || tool === "Glob") return "Searching the code";
  if (tool === "Monitor") return "Watching a test run";
  if (tool !== "Bash") return undefined;
  const desc = str(ti.description);
  if (desc) return desc;
  let c = (str(ti.command) ?? "").trim();
  while (LEAD.test(c) && c.replace(LEAD, "") !== c) c = c.replace(LEAD, "");
  const w = c.split(/\s+/);
  const [cmd = "", sub] = w;
  const arg = w
    .slice(1)
    .reverse()
    .find((x) => FILE_ARG.test(x.replace(/["']/g, "")) && !/dev\/null|\*/.test(x));
  const named = base(arg);
  const into = /(?:^|\s)>>?\s*([^\s>]+\.[a-z]{1,5})/i.exec(c);
  if (cmd === "cat" && into) return `Writing ${base(into[1])}`;
  if (cmd === "git") return `git ${sub ?? ""}`.trim();
  if (
    /^(npm|pnpm|npx|yarn|bun|vitest|jest|playwright)$/.test(cmd) &&
    /test|vitest|jest|playwright|spec/.test(c)
  )
    return `Running tests${named ? ` · ${named}` : ""}`;
  if (/^(grep|rg|ag)$/.test(cmd))
    return named ? `Searching ${named}` : "Searching the code";
  if (/^(sed|cat|head|tail|less|wc|awk)$/.test(cmd))
    return named ? `Reading ${named}` : "Reading a file";
  if (cmd === "ls" || cmd === "find") return "Listing files";
  if (cmd === "mkdir") return "Making a folder";
  if (cmd === "cp" || cmd === "mv") return "Moving files";
  if (/^(python3?|node|bash|sh)$/.test(cmd))
    return /<</.test(c) ? "Running a script" : `Running ${named || "a script"}`;
  return undefined;
}

export interface Doing {
  t: string;
  text: string;
}

/** Each helper's actions in plain words, oldest first. */
export function doingLogOf(events: MurmurEvent[]): Map<string, Doing[]> {
  const by = new Map<string, Doing[]>();
  for (const e of events) {
    const agent = str(e.payload.agent_id);
    if (e.hook !== "PreToolUse" || !agent) continue;
    const text = actionText(
      str(e.payload.tool_name) ?? "",
      obj(e.payload.tool_input),
    );
    if (!text) continue;
    const entry = { t: e.ts, text: cut(text, 90) as string };
    const list = by.get(agent);
    if (list) list.push(entry);
    else by.set(agent, [entry]);
  }
  return by;
}

/** The logs the scene reads: Claude's calls, each helper's latest action and model. */
export function logsOf(
  view: SessionView,
  mainLog: MainEntry[],
  doingLog: Map<string, Doing[]>,
  models: Map<string, string>,
): OfficeLogs {
  const agents = new Map<string, AgentView>(
    view.requests.flatMap((r) => r.agents.map((a) => [a.id, a])),
  );
  return {
    mainLog,
    // Its latest plain-words action at the time shown, else core's own words for it.
    doing: (id, t) => {
      const list = doingLog.get(id);
      const i = list ? latestAt(list, t) : -1;
      return (i >= 0 ? list?.[i]?.text : undefined) ?? agents.get(id)?.doing?.text;
    },
    info: (id) => ({ model: models.get(id) }),
  };
}

/** Each helper's model, from the Agent call Claude briefed it with ("Sonnet", "Opus"). */
export function modelsOf(view: SessionView, events: MurmurEvent[]) {
  const calls = events.filter(
    (e) => e.hook === "PreToolUse" && e.payload.tool_name === "Agent",
  );
  const out = new Map<string, string>();
  for (const r of view.requests)
    for (const a of r.agents) {
      const m = modelOf(a, calls);
      if (m) out.set(a.id, m);
    }
  return out;
}

/** How many events happened at or before `iso` (they are sorted by time). */
export function countAt(events: MurmurEvent[], iso: string): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid] as MurmurEvent).ts <= iso) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type Reply = { n: number; view: SessionView };

/**
 * The session as it stood after its first `n` events. `n` at the end is the live view, free;
 * any earlier moment is reduced in a worker (a long session takes a few hundred ms), the
 * last answer shown meanwhile, so scrubbing never blocks the room's animation.
 */
export function useViewAt(
  events: MurmurEvent[],
  live: SessionView | null,
  n: number,
): SessionView | null {
  const atEnd = n >= events.length;
  const [reply, setReply] = useState<Reply | null>(null);
  const worker = useRef<Worker | null>(null);
  const sent = useRef<{ len: number; lastId: string | undefined }>({
    len: 0,
    lastId: undefined,
  });
  const busy = useRef(false);
  const want = useRef(n);
  want.current = n;
  const cache = useRef(new Map<number, SessionView>());
  const askRef = useRef<((k: number) => void) | null>(null);

  // No workers (tests, old browsers): reduce here.
  const noWorker = typeof Worker === "undefined";
  const inline = useMemo(
    () => (noWorker && !atEnd ? reduce(events.slice(0, n)) : null),
    [noWorker, atEnd, events, n],
  );

  useEffect(() => {
    if (noWorker) return;
    const w = new Worker(new URL("./view.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    sent.current = { len: 0, lastId: undefined };
    w.onmessage = (m: MessageEvent<Reply>) => {
      busy.current = false;
      const c = cache.current;
      c.set(m.data.n, m.data.view);
      // ponytail: a small FIFO of views; an LRU if replays jump around a lot.
      if (c.size > 24) c.delete(c.keys().next().value as number);
      setReply(m.data);
      if (want.current !== m.data.n) ask(want.current);
    };
    function ask(k: number) {
      const hit = cache.current.get(k);
      if (hit) return setReply({ n: k, view: hit });
      if (busy.current) return;
      busy.current = true;
      w.postMessage({ n: k });
    }
    askRef.current = ask;
    return () => {
      w.terminate();
      worker.current = null;
      askRef.current = null;
      busy.current = false;
      cache.current.clear();
    };
  }, [noWorker]);

  useEffect(() => {
    const w = worker.current;
    if (!w || atEnd) return;
    // Send only the events the worker lacks; a reordered stream resends them all.
    const s = sent.current;
    const same = s.len > 0 && events[s.len - 1]?.id === s.lastId;
    if (!same || s.len > events.length) {
      w.postMessage({ events, reset: true });
      cache.current.clear();
    } else if (s.len < events.length)
      w.postMessage({ events: events.slice(s.len) });
    sent.current = { len: events.length, lastId: events.at(-1)?.id };
    askRef.current?.(n);
  }, [events, n, atEnd]);

  if (atEnd) return live;
  if (inline) return inline;
  return reply?.view ?? live;
}
