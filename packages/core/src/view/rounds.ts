/*
 * Helper roles, subjects and rounds, read from each helper's description, and what they
 * add up to per task, part and request. See `AgentView.role`, `subject` and `round`.
 * Rounds run across the session in start order, so a re-review in a later request
 * continues the count of the request that built the task.
 */
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

/** Sets role, subject and round on every helper, in start order across the session. */
export function applyRounds(
  reqs: RequestView[],
  agents: Map<string, AgentView>,
): void {
  const latest = new Map<string, number>(); // subject -> highest round so far
  const last = new Map<string, AgentRole>(); // subject -> role of its latest helper
  const reviewed = new Set<string>();
  const ordered = [...agents.values()].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  );
  for (const a of ordered) {
    a.role = roleOf(a.description);
    const s = subjectOf(a.description);
    if (!s) continue;
    a.subject = s;
    const prev = Math.max(latest.get(s) ?? 0, 1);
    const n = ROUND.exec(a.description);
    const named = n ? Number(n[2] ?? n[1]) + 1 : undefined;
    const again = /\bround/i.test(a.description);
    a.round =
      named ??
      (a.role === "recheck"
        ? last.get(s) === "fix"
          ? prev
          : prev + 1
        : a.role === "fix" && (reviewed.has(s) || again)
          ? prev + 1
          : prev);
    latest.set(s, Math.max(latest.get(s) ?? 0, a.round));
    last.set(s, a.role);
    if (a.role === "review" || a.role === "recheck") reviewed.add(s);
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
    req.helperCounts = counts;
    req.sentBack = [...back];
    const tasks = req.phases.flatMap((ph) => ph.tasks);
    for (const t of tasks) {
      const n = roundsOf(helpersOf(req, t));
      if (n !== undefined) t.rounds = n;
    }
    for (const p of req.parts) {
      const n = roundsOf(helpersOf(req, undefined, p));
      if (n !== undefined) p.rounds = n;
    }
  }
}

const roundsOf = (helpers: AgentView[]) => {
  const rounds = helpers.flatMap((a) => (a.round ? [a.round] : []));
  return rounds.length ? Math.max(...rounds) - 1 : undefined;
};

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
