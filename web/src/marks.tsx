/* Small marks shared by the office and its views. */
import type { RequestView, TaskView } from "@murmur/core";
import type { Mark } from "./session";

/** A state's word, said beside its mark so colour and shape never carry it alone. */
export const MARK_WORD: Record<Mark, string> = {
  done: "Done",
  running: "Running",
  waiting: "Waiting on you",
  open: "Left open",
  failed: "Failed",
  paused: "Paused",
  todo: "Not started",
};

/**
 * A request's mark: a check for done, a blue dot for running (it pulses only where
 * `pulse` is set, the one loop on screen), an amber question mark for waiting on you,
 * a grey dash for left open, grey bars for paused, plain grey for not started, a red
 * cross for failed.
 */
export function StateMark(props: { mark: Mark; pulse?: boolean }) {
  const { mark, pulse } = props;
  return (
    <span
      className={`mk ${mark}${pulse && mark === "running" ? " pulse" : ""}`}
      aria-hidden="true"
    >
      {mark === "done" ? (
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.4 4.1 7.5 8 3" />
        </svg>
      ) : mark === "failed" ? (
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="m3 3 4 4M7 3 3 7" />
        </svg>
      ) : mark === "waiting" ? (
        "?"
      ) : null}
    </span>
  );
}

/** The amber "needs you" mark: a ring with a dot. */
export function NeedIcon() {
  return (
    <svg className="g" viewBox="0 0 16 16" aria-hidden="true">
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
    </svg>
  );
}

// A run of letters up to and including a slash or hyphen, or up to a space: where a line may break.
export const PIECES = /[^\s/-]*[/-]|[^\s/-]+|\s+/g;

/**
 * Text whose lines and ellipsis break only between words: each word (and each part of a
 * path or a hyphenated word) is a box the browser keeps whole or leaves out whole.
 */
export function Words({ text }: { text: string }) {
  return (text.match(PIECES) ?? []).map((p, i) =>
    /^\s/.test(p) ? (
      p
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed string
      <span key={i} className="w">
        {p}
      </span>
    ),
  );
}

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
