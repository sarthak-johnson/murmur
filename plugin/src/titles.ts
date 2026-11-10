/*
 * The titles run: the user's own Claude names every request it has not titled, names the
 * session, and groups the requests into storylines. One `claude -p` run, isolated as the
 * recap's (`ask` in recap.ts: no tools, hooks, plugins or saved session, killed on exit,
 * timed out), about the newest 80 requests at most: the ones no run covered get their
 * material (prompt, Claude's first and last message, files, helpers), the others only
 * their title and goal, as context. The answer is validated with core's `TitlesInput`,
 * its labels ("r1") turned into request keys (core's `requestKeys`), and queued as one
 * `PostToolUse` event of `TITLES_TOOL`, marked `recap: true` and `titles: true`, timed a
 * millisecond after the latest event read; it never passes through the hook, and core
 * takes it out of the session before reading requests.
 * It runs in the detached backfill child after the recap (so imported history is titled
 * in full), and in the detached child a Stop spawns. Either way: only when a request no
 * run covered is not among those the last ask covered, at most once every 10 minutes per
 * session, and only while Murmur would send (logged in, on, not paused), checked again
 * before anything is queued. Same switches as the recap: `MURMUR_RECAP=0`, a headless
 * run or the recap's own run never asks.
 */
import {
  cutWords,
  type MurmurEvent,
  markPasted,
  plainText,
  type RequestView,
  reduce,
  requestKeys,
  scrubString,
  TITLES_TOOL,
  TitlesInput,
} from "@murmur/core";
import { readBackfill } from "./backfill.js";
import {
  isHeadless,
  readCredentials,
  readSession,
  readTitles,
  type TitlesState,
  writeTitles,
} from "./local.js";
import {
  type Ask,
  ask,
  costOf,
  emitter,
  refused,
  sending,
  stillSending,
} from "./recap.js";
import { enqueue } from "./upload.js";

const MAX_REQUESTS = 80;
const EVERY_MS = 10 * 60_000;
// 44 requests took 20 s; the Stop child also runs a refresh inside its 4 minutes.
export const TITLES_TIMEOUT_MS = 90_000;

const INSTRUCTIONS = `You name the requests of one Claude Code session for Murmur, a page that tells the person who ran the session what happened in it, and you group the requests into storylines.
Below are the session's requests, oldest first, each with a label (r1, r2, ...) and its time. For most you see what the person typed (pasted text and images show as "(pasted text)" and "(image)"), what Claude first said and what it ended with, the files it changed and the helpers it started. A request marked "titled" already has a title; it is there so you see the whole session.
Answer with one JSON object and nothing else, in exactly this shape:
{
  "session": { "title": "what the whole session was about" },
  "threads": [{ "id": "t1", "title": "a storyline" }],
  "requests": [{ "id": "r1", "short": "a title", "goal": "one sentence", "kind": "feature" | "bug" | "refactor" | "question", "thread": "t1", "follows": "r3" }]
}
Rules:
- One entry in "requests" for every request below, with its label as "id". For a titled request, copy its title and goal.
- "short": what was done or decided in that request, as a title of 2 to 5 words, at most 40 characters ("Ship build 9 to TestFlight", "Free up disk space", "Pick a chat style"). Read what Claude did and said to know. Never the person's own words: a reply like "yes", "ok", "go ahead" or "waiting" is titled by what it set in motion or what Claude reported.
- "goal": one plain sentence on what the request did or found, at most 120 characters.
- "kind": feature (build or change something), bug (find or fix a fault), refactor (clean up without changing behaviour) or question (an answer, a check or a plan, nothing built).
- "threads": the few storylines a person would name when telling the story of this session. A storyline is one piece of work with its own aim, from its start to where it ended: a feature, a release, a bug hunt, an ask to a colleague. It is never a kind of activity: "Ship build 9" and "Umang's server changes" are storylines, "Builds and PRs" and "Messages" are not. Expect 3 to 10 for a long session and 1 for a short one. A storyline can stop and come back later: put the requests about the same work in it even when other work came between. A request that only checks on or talks about a piece of work belongs to that work's storyline. Thread titles are 2 to 5 words, at most 40 characters.
- "follows": only when a request picks up a different, earlier request than the one before it in its storyline; else leave it out.
- "session.title": what the session was about, at most 48 characters.
- Plain English words a junior developer understands. Only say what the material shows.`;

/** A request's time as "2026-11-03 19:32". */
const time = (ts: string) => `${ts.slice(0, 10)} ${ts.slice(11, 16)}`;
const clean = (s: string, max: number) =>
  cutWords(plainText(scrubString(markPasted(s))), max);

/**
 * The material for a titles run about `reqs` (oldest first), labelled r1, r2, ... by
 * position. `keys` are the requests' keys, by position; `state` says which a run covered.
 */
export function titlesInput(
  reqs: RequestView[],
  keys: string[],
  state: TitlesState,
): string {
  const threads = Object.entries(state.threads ?? {});
  const lines = reqs.map((r, i) => {
    const head = `r${i + 1} (${time(r.startedAt)})`;
    const was = state.covered?.[keys[i] as string];
    if (was)
      return `${head}, titled "${was.short}": ${was.goal.replace(/\.$/, "")}. Storyline so far: ${was.thread}`;
    if (r.titledBy === "claude" && r.short)
      return `${head}, titled "${r.short}": ${clean(r.goal, 120)}`;
    const msgs = r.messages ?? [];
    const files = [
      ...new Set(
        [...r.parts.flatMap((p) => p.files), ...r.looseFiles].map(
          (f) => f.path,
        ),
      ),
    ].slice(0, 5);
    const helpers = r.agents.slice(0, 3).map((a) => a.description);
    return [
      head,
      `  Asked: ${clean(r.prompt, 300) || "(nothing)"}`,
      msgs.length > 1
        ? `  Claude first said: ${clean(msgs[0]?.text ?? "", 200)}`
        : "",
      msgs.length
        ? `  Claude ended with: ${clean(msgs.at(-1)?.text ?? "", 400)}`
        : "  Claude wrote nothing.",
      files.length ? `  Changed: ${files.join(", ")}` : "",
      helpers.length ? `  Helpers: ${helpers.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    INSTRUCTIONS,
    threads.length
      ? `\n## Storylines so far\nKeep these ids for the same work; you may rename one or add others.\n${threads.map(([id, t]) => `${id}: ${t}`).join("\n")}`
      : "",
    `\n## Requests\n${lines.join("\n\n")}`,
  ].join("\n");
}

type Titled = { ok: true; answer: TitlesInput } | { ok: false; why: string };

/**
 * Asks once and validates the answer: a `TitlesInput` naming only the labels asked
 * about, turned into `keys` (by label position). Never throws.
 */
export async function askTitles(
  input: string,
  keys: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = TITLES_TIMEOUT_MS,
): Promise<Titled & { ask: Ask }> {
  const r = await ask(input, env, timeoutMs);
  if (!r.ok) return { ok: false, why: r.why, ask: r };
  const parsed = TitlesInput.safeParse(r.json);
  if (!parsed.success)
    return { ok: false, why: refused("titles", parsed), ask: r };
  const key = (label: string) => keys[Number(/^r(\d+)$/.exec(label)?.[1]) - 1];
  const ids = parsed.data.requests.flatMap((x) => [
    x.id,
    ...(x.follows ? [x.follows] : []),
  ]);
  if (ids.some((id) => key(id) === undefined))
    return {
      ok: false,
      why: "it names a request it was not asked about",
      ask: r,
    };
  const answer: TitlesInput = {
    ...parsed.data,
    requests: parsed.data.requests.map(({ follows, ...x }) => ({
      ...x,
      id: key(x.id) as string,
      ...(follows ? { follows: key(follows) as string } : {}),
    })),
  };
  return { ok: true, answer, ask: r };
}

export interface TitlesOptions {
  env?: NodeJS.ProcessEnv;
  /** The time it runs at, for the 10-minute spacing. */
  now?: Date;
  timeoutMs?: number;
  /** The import started inside the last request: leave it to live narration. */
  lastOpen?: boolean;
  log?: (line: string) => void;
}

const off = (env: NodeJS.ProcessEnv) =>
  env.MURMUR_RECAP === "0" || env.MURMUR_RECAP_RUN === "1" || isHeadless(env);

/** Names and groups the requests of `events` when something new is uncovered. Returns whether it asked and whether the answer was queued. */
export async function runTitles(
  sessionId: string,
  events: MurmurEvent[],
  {
    env = process.env,
    now = new Date(),
    timeoutMs = TITLES_TIMEOUT_MS,
    lastOpen = false,
    log = (l) => process.stderr.write(`${l}\n`),
  }: TitlesOptions = {},
): Promise<{ ran: number; ok: number }> {
  const none = { ran: 0, ok: 0 };
  if (off(env)) return none;
  const view = reduce(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const starts = view.requests.map((r) => byId.get(r.id) as MurmurEvent);
  const allKeys = requestKeys(starts);
  const upTo = view.requests.length - (lastOpen ? 1 : 0);
  const from = Math.max(0, upTo - MAX_REQUESTS);
  const reqs = view.requests.slice(from, upTo);
  const keys = allKeys.slice(from, upTo);
  const st = readTitles(sessionId);
  const uncovered = keys.filter((k) => !st.covered?.[k]);
  const tried = new Set(st.tried ?? []);
  if (
    !uncovered.some((k) => !tried.has(k)) ||
    (st.at && now.getTime() - Date.parse(st.at) < EVERY_MS) ||
    !sending(sessionId, view.cwd)
  )
    return none;
  const token = readCredentials()?.token;
  // Marked before it is asked: whatever comes back, not again until something new.
  // ponytail: two Stop children reading at the same moment can both ask once; mark
  // before the transcript read (as the refresh's `checked`) if that ever costs much.
  writeTitles(sessionId, { ...st, at: now.toISOString(), tried: uncovered });
  const r = await askTitles(titlesInput(reqs, keys, st), keys, env, timeoutMs);
  const secs = (r.ask.ms / 1000).toFixed(1);
  // Paused, off or logged out while it was asked: the answer is not sent.
  const why = !r.ok
    ? r.why
    : !stillSending(sessionId, view.cwd, token)
      ? "Murmur stopped sending"
      : undefined;
  if (why || !r.ok) {
    log(`murmur titles: ${sessionId} kept its titles: ${why} (${secs} s)`);
    return { ran: 1, ok: 0 };
  }
  const last = events.reduce((a, e) => Math.max(a, Date.parse(e.ts)), 0);
  const { out, add } = emitter(
    starts[0] as MurmurEvent,
    `murmur-titles:${new Date(last).toISOString()}`,
    last,
    { titles: true },
  );
  add(TITLES_TOOL, r.answer);
  for (const e of out) enqueue(e);
  const after = readTitles(sessionId);
  writeTitles(sessionId, {
    ...after,
    covered: {
      ...after.covered,
      ...Object.fromEntries(
        r.answer.requests.map((x) => [
          x.id,
          { short: x.short, goal: x.goal, thread: x.thread },
        ]),
      ),
    },
    threads: {
      ...after.threads,
      ...Object.fromEntries(r.answer.threads.map((t) => [t.id, t.title])),
    },
  });
  log(`murmur titles: ${sessionId} ok (${secs} s${costOf(r.ask)})`);
  return { ran: 1, ok: 1 };
}

/**
 * In the detached child after a Stop: reads the transcript (never in the hook) and runs
 * `runTitles`, unless the session was asked about in the last 10 minutes.
 */
export async function runTitlesLive(
  sessionId: string,
  opts: TitlesOptions = {},
): Promise<{ ran: number; ok: number }> {
  const none = { ran: 0, ok: 0 };
  const { env = process.env, now = new Date() } = opts;
  if (off(env)) return none;
  const s = readSession(sessionId);
  const creds = readCredentials();
  const at = readTitles(sessionId).at;
  if (
    s.backfill !== "done" ||
    !s.transcriptPath ||
    !s.cwd ||
    !creds ||
    (at && now.getTime() - Date.parse(at) < EVERY_MS) ||
    !sending(sessionId, s.cwd)
  )
    return none;
  const events = readBackfill({
    sessionId,
    machineId: creds.machineId,
    cwd: s.cwd,
    transcriptPath: s.transcriptPath,
    cutoff: now.toISOString(),
  });
  return runTitles(sessionId, events, { ...opts, env, now });
}
