/* Small marks shared by the request and task pages. */
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
      ) : status === "blocked" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M8 4.6v4.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.2" r="1" fill="currentColor" />
        </>
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
