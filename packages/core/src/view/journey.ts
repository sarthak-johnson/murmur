/*
 * The session as a journey: chapters of requests about the same work, the long pauses,
 * the decisions, and the totals. See `Journey` in types.ts.
 */
import type { MurmurEvent } from "../events.js";
import { cutWords, firstSentence, moment } from "./moments.js";
import { itemOf } from "./rounds.js";
import type {
  Chapter,
  Decision,
  Journey,
  Pause,
  RequestView,
} from "./types.js";
import { subjectsOf } from "./words.js";

const HOUR_MS = 3_600_000;
const PHASE = /\bphase\s+(\d+)\b/gi;
// A decision about how the work looks or goes.
const DECIDES = /\b(?:styles?|looks?|designs?|themes?|plans?|approv\w*)\b/i;
// A prompt that approves what Claude proposed.
const APPROVES =
  /\b(?:go ahead|let'?s (?:build|do|go|ship|start)\b|yes,? please|ship it|approved?|go for it|sounds good|lgtm)\b/i;

interface Keys {
  phases: Set<string>;
  items: Set<string>;
}

/** Phases named in the goal and plan, and task or item numbers in the plan's titles and helpers. */
function keysOf(req: RequestView): Keys {
  const plan = req.phases.flatMap((ph) => [
    ph.title,
    ...ph.tasks.map((t) => t.title),
  ]);
  const phases = new Set(
    [req.goal, ...plan].flatMap((t) =>
      [...t.matchAll(PHASE)].map((m) => m[1] as string),
    ),
  );
  const items = new Set<string>();
  for (const s of [...plan, ...req.parts.map((p) => p.title)].flatMap(
    subjectsOf,
  )) {
    if (s.kind === "item") items.add(`B${s.id}`);
    else
      for (let n = s.from; n <= Math.min(s.to, s.from + 50); n++)
        items.add(`T${n}`);
  }
  // Helpers name tasks too ("Build Task 35"), but not a phase: a fix of an older
  // phase's review would pull the request into that phase's chapter.
  for (const a of req.agents) {
    const id = itemOf(a.description);
    const n = /^Tasks? (\d+)/.exec(id ?? "")?.[1];
    if (id?.startsWith("B")) items.add(id);
    else if (n) items.add(`T${n}`);
  }
  return { phases, items };
}

const meets = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

function chaptersOf(reqs: RequestView[]): Chapter[] {
  const groups: { reqs: RequestView[]; keys: Keys }[] = [];
  for (const req of reqs) {
    const k = keysOf(req);
    const g = groups.at(-1);
    const keyless = !k.phases.size && !k.items.size;
    const joins =
      g &&
      (k.phases.size && g.keys.phases.size
        ? meets(k.phases, g.keys.phases)
        : meets(k.items, g.keys.items) ||
          (keyless &&
            !g.keys.phases.size &&
            !g.keys.items.size &&
            g.reqs.at(-1)?.kind === req.kind));
    if (g && joins) {
      g.reqs.push(req);
      for (const p of k.phases) g.keys.phases.add(p);
      for (const i of k.items) g.keys.items.add(i);
    } else groups.push({ reqs: [req], keys: k });
  }
  return groups.map(({ reqs: rs, keys }) => {
    const states = rs.map((r) => r.state ?? "done");
    return {
      title: titleOf(rs, keys),
      requestIds: rs.map((r) => r.id),
      state: states.includes("waiting")
        ? "waiting"
        : states.includes("running")
          ? "running"
          : (states.at(-1) ?? "done"),
    };
  });
}

function titleOf(rs: RequestView[], keys: Keys): string {
  const nums = [...keys.phases].map(Number).sort((a, b) => a - b);
  if (nums.length === 1) {
    const titles = rs.flatMap((r) => r.phases.map((ph) => ph.title));
    const own = titles.filter((t) =>
      new RegExp(`^phase\\s+${nums[0]}\\b`, "i").test(t),
    );
    return own.find((t) => t.includes(":")) ?? own[0] ?? `Phase ${nums[0]}`;
  }
  if (nums.length === 2) return `Phases ${nums[0]} and ${nums[1]}`;
  if (nums.length > 2) return `Phases ${nums[0]} to ${nums.at(-1)}`;
  return rs[0]?.short ?? "";
}

function pausesOf(reqs: RequestView[], lists: MurmurEvent[][]): Pause[] {
  const out: Pause[] = [];
  const gap = (from: string, to: string) =>
    Date.parse(to) - Date.parse(from) > HOUR_MS;
  lists.forEach((list, i) => {
    const after = reqs[i]?.id ?? "";
    // Each time parsed once: a session has tens of thousands of events.
    const ms = list.map((e) => Date.parse(e.ts));
    for (let k = 1; k < list.length; k++)
      if ((ms[k] as number) - (ms[k - 1] as number) > HOUR_MS)
        out.push({
          after,
          from: (list[k - 1] as MurmurEvent).ts,
          to: (list[k] as MurmurEvent).ts,
          inside: true,
        });
    const from = list.at(-1)?.ts;
    const to = lists[i + 1]?.[0]?.ts;
    if (from && to && gap(from, to))
      out.push({ after, from, to, inside: false });
  });
  return out;
}

function decisionsOf(reqs: RequestView[]): Decision[] {
  const out: Decision[] = [];
  for (const req of reqs) {
    if (APPROVES.test(req.prompt))
      out.push({
        ts: req.startedAt,
        requestId: req.id,
        text: cutWords(firstSentence(req.prompt), 120),
        by: "user",
      });
    for (const m of req.messages ?? []) {
      const first = firstSentence(m.text);
      if (moment(m.text) === "decision" && DECIDES.test(first))
        out.push({
          ts: m.ts,
          requestId: req.id,
          text: cutWords(first, 140),
          by: "claude",
        });
    }
  }
  return out;
}

export function journeyOf(
  reqs: RequestView[],
  lists: MurmurEvent[][],
): Journey {
  const pauses = pausesOf(reqs, lists);
  const files = new Set(
    reqs.flatMap((r) =>
      [...r.parts.flatMap((p) => p.files), ...r.looseFiles].map((f) => f.path),
    ),
  );
  const sum = (key: "helpers" | "commands") =>
    reqs.reduce((n, r) => n + r.tally[key], 0);
  return {
    chapters: chaptersOf(reqs),
    pauses,
    decisions: decisionsOf(reqs),
    totals: {
      helpers: sum("helpers"),
      files: files.size,
      commands: sum("commands"),
      sentBack: new Set(reqs.flatMap((r) => r.sentBack ?? [])).size,
      pauses: pauses.length,
    },
  };
}
