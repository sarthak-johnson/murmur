/*
 * Helper roles, subjects and rounds, read from each helper's description, and what they
 * add up to per task, part and request. See `AgentView.role`, `subject` and `round`.
 * Rounds run across the session in start order, so a re-review in a later request
 * continues the count of the request that built the task, and a fix sent to a builder by
 * message counts in the request that sent it.
 */
import type { MurmurEvent } from "../events.js";
import type {
  AgentRole,
  AgentView,
  HelperCounts,
  PartView,
  RequestView,
  TaskView,
} from "./types.js";

// "Task 12", "Tasks 13-14", "Task 18a", "B7", "bug B1", "bug 1"; case ignored.
const ITEM =
  /\b(?:tasks?\s+(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)|(?:bug\s+b?|b)(\d+))\b/i;
const PHASE = /\bphase\s+(\d+)\b/i;

/** A task or bug id named in `text` ("Task 12", "Tasks 13-14", "B7"), unset when none. */
export function itemOf(text: string): string | undefined {
  const m = ITEM.exec(text);
  if (!m) return undefined;
  if (m[2]) return `B${m[2]}`;
  const id = (m[1] as string).replace(/\s*[-–]\s*/, "-").toLowerCase();
  return `${id.includes("-") ? "Tasks" : "Task"} ${id}`;
}

/** What a helper worked on: a task or bug id, else a phase ("Phase 2"). */
export function subjectOf(text: string): string | undefined {
  const phase = PHASE.exec(text)?.[1];
  return itemOf(text) ?? (phase ? `Phase ${phase}` : undefined);
}

export function roleOf(description: string): AgentRole {
  const d = description.trim();
  if (/\bre-?(?:review|check)/i.test(d)) return "recheck";
  if (/^fix\b|\bfix(?:es)? rounds?\b/i.test(d)) return "fix";
  if (/\breview/i.test(d)) return "review";
  if (/\bplan\b/i.test(d)) return "plan";
  if (/^(?:implement|build|write|add|draft|create|make|port)\b/i.test(d))
    return "build";
  if (
    /^(?:research|investigate|explore|find|inventory|audit|survey)\b/i.test(d)
  )
    return "research";
  return "other";
}

// "fix round 2", "round 3", "rounds 2-3" (the last counts).
const ROUND = /\brounds?\s+(\d+)(?:\s*[-–]\s*(\d+))?/i;

/**
 * Sets role, subject and round on every helper, in start order across the session.
 * A builder resumed with a message (SendMessage) after a review is a fix round too: it
 * counts in the request it was resumed in, though the helper belongs to an earlier one.
 */
export function applyRounds(
  reqs: RequestView[],
  agents: Map<string, AgentView>,
  lists: MurmurEvent[][],
): void {
  const latest = new Map<string, number>(); // subject -> highest round so far
  const last = new Map<string, AgentRole>(); // subject -> role of its latest helper
  const reviewed = new Set<string>(); // subjects reviewed since their last fix
  /** The round a step of `role` on `s` is in, given its words, and it moves the count. */
  const step = (s: string, role: AgentRole, text: string) => {
    // A new build starts the count over: a later plan reuses "Task 1", a stopped job restarts.
    if (role === "build") {
      latest.delete(s);
      last.delete(s);
      reviewed.delete(s);
    }
    const prev = Math.max(latest.get(s) ?? 0, 1);
    const n = ROUND.exec(text);
    const named = n ? Number(n[2] ?? n[1]) + 1 : undefined;
    const again = /\bround/i.test(text);
    const round =
      named ??
      (role === "recheck"
        ? last.get(s) === "fix"
          ? prev
          : prev + 1
        : role === "fix" && (reviewed.has(s) || again)
          ? prev + 1
          : prev);
    latest.set(s, Math.max(latest.get(s) ?? 0, round));
    last.set(s, role);
    if (role === "review" || role === "recheck") reviewed.add(s);
    if (role === "fix") reviewed.delete(s);
    return round;
  };
  // Helper starts and builder resumes, in time order.
  type Move =
    | { ts: string; a: AgentView }
    | { ts: string; a: AgentView; req: RequestView; text: string };
  const moves: Move[] = [...agents.values()].map((a) => ({
    ts: a.startedAt,
    a,
  }));
  reqs.forEach((req, i) => {
    for (const e of lists[i] ?? []) {
      if (e.hook !== "PreToolUse" || e.payload.tool_name !== "SendMessage")
        continue;
      const input = e.payload.tool_input as Record<string, unknown> | undefined;
      const a = agents.get(String(input?.to ?? ""));
      const text = typeof input?.message === "string" ? input.message : "";
      if (a && a.startedAt < e.ts) moves.push({ ts: e.ts, a, req, text });
    }
  });
  moves.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0));
  const resumed = new Map<RequestView, Map<string, number>>(); // highest round resumed in it
  for (const m of moves) {
    const { a } = m;
    if (!("req" in m)) {
      a.role = roleOf(a.description);
      const s = subjectOf(a.description);
      if (!s) continue;
      a.subject = s;
      a.round = step(s, a.role, a.description);
      continue;
    }
    // Only a builder's resume can be a fix; a reviewer resumed goes on with its review.
    // ponytail: a builder handed another task by message is skipped, not counted for it.
    const s = a.subject;
    const words = fixWords(m.text);
    const named = words === undefined ? undefined : itemOf(words);
    // "Tasks 13+14 fix round 1" reads as Task 13, the first of "Tasks 13-14".
    const first = (x: string) => x.replace(/^Tasks /, "Task ").split("-")[0];
    if (
      !s ||
      (a.role !== "build" && a.role !== "fix") ||
      words === undefined ||
      (named && first(named) !== first(s))
    )
      continue;
    const round = step(s, "fix", words);
    const own = resumed.get(m.req) ?? new Map<string, number>();
    own.set(s, Math.max(own.get(s) ?? 0, round));
    resumed.set(m.req, own);
  }
  for (const req of reqs) {
    const counts: HelperCounts = {
      build: 0,
      review: 0,
      recheck: 0,
      fix: 0,
      other: 0,
    };
    const back = new Set<string>();
    for (const a of req.agents) {
      const role = a.role ?? "other";
      if (role in counts) counts[role as keyof HelperCounts]++;
      else counts.other++;
      if (a.subject && (a.round ?? 0) > 1) back.add(a.subject);
    }
    const own = resumed.get(req);
    for (const [s, n] of own ?? []) if (n > 1) back.add(s);
    req.helperCounts = counts;
    req.sentBack = [...back];
    const tasks = req.phases.flatMap((ph) => ph.tasks);
    const roundsOf = (helpers: AgentView[], s: string | undefined) => {
      const rounds = helpers.flatMap((a) => (a.round ? [a.round] : []));
      const more = s ? own?.get(s) : undefined;
      if (more) rounds.push(more);
      return rounds.length ? Math.max(...rounds) - 1 : undefined;
    };
    for (const t of tasks) {
      const n = roundsOf(helpersOf(req, t), subjectOfWork(req, t));
      if (n !== undefined) t.rounds = n;
    }
    for (const p of req.parts) {
      const n = roundsOf(
        helpersOf(req, undefined, p),
        subjectOfWork(req, undefined, p),
      );
      if (n !== undefined) p.rounds = n;
    }
  }
}

/**
 * A message resuming a builder that sends it back to fix: its opening words, for the
 * round they name ("Task 39 fix round 2: read ...", "Task review found issues. Fix
 * these"). Unset for anything else: a follow-up, a note, a restart after a stop.
 */
function fixWords(text: string): string | undefined {
  const [first = "", second = ""] = (text.split("\n")[0] ?? "").split(
    /(?<=[.!?:])\s+/,
  );
  // "issues in round 1's fix" looks back at a round, it names none.
  const head = first.replace(/\brounds?\s+\d+['’]s\b/gi, "");
  return ROUND.test(head) || /\bfix (?:these|them|this|that|it)\b/i.test(second)
    ? `${head} ${second}`
    : undefined;
}

/** A task's subject, from its title or its part's; a part's, from its title or its one task's. */
export function subjectOfWork(
  req: RequestView,
  task?: TaskView,
  part?: PartView,
): string | undefined {
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  const p = part ?? req.parts.find((x) => x.id === task?.part);
  const own = part ? tasks.filter((t) => t.part === part.id) : [];
  return (
    (task && subjectOf(task.title)) ||
    (p && subjectOf(p.title)) ||
    (own.length === 1 ? subjectOf((own[0] as TaskView).title) : undefined)
  );
}

/**
 * This request's helpers on a task or part, in start order: those named for its subject,
 * else those tied to it (Claude was on it when they started, or they narrated on it)
 * when they share one subject or name none.
 */
export function helpersOf(
  req: RequestView,
  task?: TaskView,
  part?: PartView,
  /** Every helper on it: those named for its subject and all tied ones, of any subject. */
  every = false,
): AgentView[] {
  const s = subjectOfWork(req, task, part);
  if (s && !every) return req.agents.filter((a) => a.subject === s);
  const ids = new Set([
    ...(task?.agents ?? []),
    ...(part?.agents ?? []),
    ...(task && !part
      ? (req.parts.find((x) => x.id === task.part)?.agents ?? [])
      : []),
  ]);
  const tied = req.agents.filter(
    (a) => ids.has(a.id) || (s !== undefined && a.subject === s),
  );
  if (every) return tied;
  const subjects = new Set(tied.flatMap((a) => (a.subject ? [a.subject] : [])));
  return subjects.size <= 1 ? tied : [];
}
