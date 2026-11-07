import type {
  AgentView,
  MurmurEvent,
  PhaseView,
  RequestView,
  TaskView,
} from "@murmur/core";
import type { ReactNode } from "react";
import {
  livePhase,
  modelOf,
  phaseSpan,
  shortTitle,
  taskAgents,
} from "../session";
import { clock, duration } from "../story";

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

const WORD: Record<Shown, string> = {
  done: "Done",
  now: "In progress",
  todo: "Not started",
  failed: "Failed",
  open: "Left open",
};

/** Helpers get identity hues as a 2px rail, never status colours. */
const HUES = ["#a29de8", "#d995be", "#c3a0dc", "#9fb0d8"];

/** "21 m", "<1 m", "2 h 05 m": short enough that a card's line never wraps. */
const minutes = (from: string, to: string) => {
  const d = duration(from, to);
  return d === "under a minute" ? "<1 m" : d;
};

const n_ = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function phaseSub(
  req: RequestView,
  ph: PhaseView,
  shown: Shown,
  live: boolean,
): string {
  const total = ph.tasks.length;
  const done = ph.tasks.filter((t) => t.status === "done").length;
  const { from, to } = phaseSpan(req, ph);
  const count = `${done} of ${total} done`;
  if (shown === "done")
    return from && to
      ? `${count}, ${clock(from) === clock(to) ? clock(from) : `${clock(from)} to ${clock(to)}`}`
      : count;
  if (shown === "open") return req.finished ? `${count}, left open` : count;
  if (live || shown === "now")
    return from ? `${count}, started ${clock(from)}` : count;
  return `${n_(total, "task")}, not started`;
}

export function PlanColumn(props: {
  request: RequestView;
  done: boolean;
  /** The request's last activity, for how long it ran. */
  end: string;
  events: MurmurEvent[];
  partId?: string | undefined;
  /** Phases with a part in the story on this page: their titles link to it. */
  storyPhases?: Set<string>;
  onOpen(partId: string): void;
  onHover(partId: string | undefined): void;
  footer?: ReactNode;
}) {
  const { request, done, end, events, partId, storyPhases } = props;
  const { onOpen, onHover, footer } = props;
  const live = livePhase(request, done);
  const now = new Date().toISOString();
  // Once over, work not finished was left open; once Claude stopped, nothing runs.
  const shownOf = (s: TaskView["status"]): Shown =>
    (request.finished && s === "todo") ||
    ((request.finished || done) && s === "now")
      ? "open"
      : s;
  const k = (a: AgentView) => request.agents.indexOf(a) + 1;
  const running = request.agents.filter((a) => a.status === "running");
  const placed = new Set<string>();

  /**
   * A live-phase task, or a helper on no task, as a card. Every task of the live phase
   * is a card, busy or not, so a helper starting or ending changes words, not boxes.
   */
  const card = (
    key: string,
    title: string,
    helpers: AgentView[],
    status: string,
    part?: string,
    problem?: string,
  ) => {
    for (const h of helpers) placed.add(h.id);
    const a = helpers[0];
    const model = a ? modelOf(a, events) : "";
    const body = (
      <>
        <b>{title}</b>
        <span>
          <span>
            {a
              ? `Agent ${k(a)}${model ? `, ${model}` : ""}${helpers.length > 1 ? ` +${helpers.length - 1}` : ""}`
              : status}
          </span>
          {a && <span className="num">{minutes(a.startedAt, now)}</span>}
        </span>
        {problem && <span className="task-problem">{problem}</span>}
      </>
    );
    const inner = a ? "lt-in busy" : "lt-in";
    return (
      <li
        key={key}
        className="lt fade-in"
        aria-label={a ? `Agent ${k(a)}` : undefined}
        style={
          a ? ({ "--hue": HUES[(k(a) - 1) % HUES.length] } as never) : undefined
        }
      >
        {part ? (
          <button
            type="button"
            className={inner}
            aria-current={partId === part ? "page" : undefined}
            onMouseEnter={() => onHover(part)}
            onMouseLeave={() => onHover(undefined)}
            onFocus={() => onHover(part)}
            onBlur={() => onHover(undefined)}
            onClick={() => onOpen(part)}
          >
            {body}
          </button>
        ) : (
          <div className={inner}>{body}</div>
        )}
      </li>
    );
  };

  const row = (t: TaskView) => {
    const part = t.part;
    const shown = shownOf(t.status);
    const title = shortTitle(t.title);
    const body = (
      <>
        <Glyph status={shown} />
        <span className="task-title">{title}</span>
        {shown === "open" && request.finished && (
          <span className="sr-only">, left open</span>
        )}
      </>
    );
    return (
      <li key={t.id} className="fade-in">
        {part ? (
          <button
            type="button"
            className={`task ${shown}`}
            aria-current={partId === part ? "page" : undefined}
            title={t.title}
            onMouseEnter={() => onHover(part)}
            onMouseLeave={() => onHover(undefined)}
            onFocus={() => onHover(part)}
            onBlur={() => onHover(undefined)}
            onClick={() => onOpen(part)}
          >
            {body}
          </button>
        ) : (
          <div className={`task ${shown}`} title={t.title}>
            {body}
          </div>
        )}
        {t.problem && <span className="task-problem">{t.problem}</span>}
      </li>
    );
  };

  const total = duration(request.startedAt, done ? end : now);
  return (
    <aside className="spine" id="plan" aria-label="Plan" tabIndex={-1}>
      <h2 className="spine-h">
        <span>
          The plan <PlanSource request={request} />
        </span>
        <span className="num">
          {done ? `${total} in all` : `${total} so far`}
        </span>
      </h2>
      {request.phases.length === 0 && (
        <p className="spine-empty">
          The plan appears when Claude lays out its steps.
        </p>
      )}
      <ol className="phases">
        {request.phases.map((ph) => {
          const here = ph === live;
          const shown: Shown =
            ph.status === "done"
              ? "done"
              : request.finished || (done && ph.status === "now")
                ? "open"
                : here
                  ? "now"
                  : ph.status;
          const rows = ph.tasks.map((t) =>
            here
              ? card(
                  t.id,
                  shortTitle(t.title),
                  taskAgents(request, t).filter((a) => a.status === "running"),
                  WORD[shownOf(t.status)],
                  t.part,
                  t.problem,
                )
              : row(t),
          );
          const loose = here
            ? running
                .filter((a) => !placed.has(a.id))
                .map((a) =>
                  card(a.id, a.description || `Agent ${k(a)}`, [a], ""),
                )
            : [];
          return (
            <li key={ph.id} className={`ph ${shown}`} aria-label={ph.title}>
              {here ? (
                <span className="here">
                  <span className="sr-only">You are here</span>
                </span>
              ) : (
                <span className="dot">
                  <Glyph status={shown} />
                </span>
              )}
              <h3>
                {storyPhases?.has(ph.id) ? (
                  <a href={`#phase-${ph.id}`}>{ph.title}</a>
                ) : (
                  ph.title
                )}
              </h3>
              <div className="sub num">
                {phaseSub(request, ph, shown, here)}
              </div>
              {(rows.length > 0 || loose.length > 0) && (
                <ul className="tl">
                  {rows}
                  {loose}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {footer}
    </aside>
  );
}
