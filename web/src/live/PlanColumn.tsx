/*
 * The marks the task page still shares from the old plan column. The column itself is
 * gone (the phase track replaced it); these move once the task page imports them from
 * their own file.
 */
import type { RequestView, TaskView } from "@murmur/core";

/** Where the plan came from, when Claude did not lay it out live. */
export function PlanSource({ request }: { request: RequestView }) {
  if (request.recap) return <span className="inferred">Recap by Claude</span>;
  if (request.planInferred) return <span className="inferred">inferred</span>;
  return null;
}

type Shown = TaskView["status"] | "open";

/** A small mark per state: check, dot, ring, cross. Shape and colour say it together. */
export function Glyph({ status }: { status: Shown }) {
  return (
    <svg className={`glyph ${status}`} viewBox="0 0 16 16" aria-hidden="true">
      {status === "done" ? (
        <path
          d="m3.5 8.5 3 3 6-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : status === "failed" ? (
        <path
          d="m4.5 4.5 7 7m0-7-7 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : status === "now" ? (
        <circle cx="8" cy="8" r="3.5" fill="currentColor" />
      ) : (
        <circle
          cx="8"
          cy="8"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      )}
    </svg>
  );
}
