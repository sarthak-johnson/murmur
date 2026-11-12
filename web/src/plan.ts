// The session as the web shows it: core's view, less what only looks like a plan.
import { type MurmurEvent, reduce, type SessionView } from "@murmur/core";

/**
 * With no plan of Claude's, core lists what it did as one "What Claude did" phase: a task
 * per helper's work, and one per folder its own edits fell in ("Changes in contracts").
 * A folder is where files changed, not a task: it stays a part (its files read under it
 * in Files) but leaves the plan, so the board, Tasks and the plan's count never show a
 * folder as work to do. A phase left empty goes: the request had no plan.
 */
export function withoutFolderTasks(view: SessionView): SessionView {
  let changed = false;
  const requests = view.requests.map((req) => {
    if (!req.planInferred) return req;
    const helpers = new Map(req.parts.map((p) => [p.id, p.agents.length > 0]));
    const phases = req.phases.flatMap((ph) => {
      if (ph.id !== "did") return [ph];
      const tasks = ph.tasks.filter(
        (t) => t.agents.length > 0 || (t.part && helpers.get(t.part)),
      );
      if (tasks.length === ph.tasks.length) return [ph];
      changed = true;
      return tasks.length ? [{ ...ph, tasks }] : [];
    });
    return phases.length === req.phases.length &&
      phases.every((p, i) => p === req.phases[i])
      ? req
      : { ...req, phases };
  });
  return changed ? { ...view, requests } : view;
}

/** Events to the view every part of the web reads. */
export const viewOf = (events: MurmurEvent[]) =>
  withoutFolderTasks(reduce(events));
