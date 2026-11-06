import type { SessionView, TaskView } from "./types.js";

/** The "since you last looked" line for one request, or null when nothing changed. */
export function catchUp(
  before: SessionView,
  after: SessionView,
  requestId: string,
): string | null {
  const a = after.requests.find((r) => r.id === requestId);
  const b = before.requests.find((r) => r.id === requestId);
  if (!a || !b) return null;
  const tasks = (r: typeof a) => r.phases.flatMap((ph) => ph.tasks);
  const old = new Map(tasks(b).map((t) => [t.id, t.status]));
  const titles = (status: TaskView["status"]) =>
    tasks(a)
      .filter((t) => t.status === status && old.get(t.id) !== status)
      .map((t) => t.title)
      .join(" and ");
  const checks = (r: typeof a) =>
    new Set(
      r.parts.flatMap((p) =>
        p.checks
          .filter((c) => c.status === "fail")
          .map((c) => `c${p.id}\0${c.check}`),
      ),
    );
  const steps = (r: typeof a) =>
    r.parts.flatMap((p) =>
      p.steps
        .filter((s) => s.status === "failed")
        .map((s) => `s${p.id}\0${s.ts}\0${s.text}`),
    );
  const seen = new Set([...checks(b), ...steps(b)]);
  const failing = new Set([...checks(a), ...steps(a)]);
  const n = [...failing].filter((k) => !seen.has(k)).length;
  const known = new Set(b.agents.map((x) => x.id));
  const parts = [
    ...[
      ["finished", "done"],
      ["started", "now"],
    ].flatMap(([word, st]) => {
      const t = titles(st as TaskView["status"]);
      return t ? [`${word} ${t}`] : [];
    }),
    ...(n ? [`${n} ${n === 1 ? "check" : "checks"} failing`] : []),
    ...a.agents.flatMap((x, i) =>
      known.has(x.id) ? [] : [`Agent ${i + 1} started`],
    ),
  ];
  return parts.length ? parts.join(", ") : null;
}
