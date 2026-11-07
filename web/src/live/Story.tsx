import type { MessageView, RequestView } from "@murmur/core";
import type { ReactNode } from "react";
import { Fold } from "../markdown";
import { Pill } from "../Pill";
import { clock, duration, MOMENT, moment, sentBack } from "../story";

const count = (n: number, one: string, many = `${one}s`) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

export type RequestStatus = "running" | "done" | "needs";
const STATUS = {
  running: { label: "Running", tone: "now" },
  done: { label: "Done", tone: "done" },
  needs: { label: "Needs you", tone: "warn" },
} as const;

/** Claude's opening line, then the summary band: status, tasks, rounds, helpers, time. */
export function RequestHead(props: {
  request: RequestView;
  status: RequestStatus;
  /** The request's last activity, for its duration. */
  end: string;
  /** The notice row, kept on the band's line so the page below never moves. */
  children?: ReactNode;
}) {
  const { request, status, end, children } = props;
  const opening = request.messages?.[0];
  const tasks = request.phases.flatMap((p) => p.tasks).length;
  const facts = [
    ...count(tasks, "task"),
    ...count(
      sentBack(request),
      "sent back after review",
      "sent back after review",
    ),
    ...count(request.tally.helpers, "helper"),
  ];
  const s = STATUS[status];
  return (
    <>
      {opening && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around a line of text
        <div
          className="opening"
          role="group"
          aria-label="Claude's opening line"
        >
          <Fold
            text={opening.text}
            lines={3}
            className="opening-text"
            aside={<span className="byline">Claude, {clock(opening.ts)}</span>}
          />
        </div>
      )}
      <div className="head-row">
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the facts */}
        <div className="band" role="group" aria-label="Summary">
          <Pill tone={s.tone}>{s.label}</Pill>
          {facts.map((f) => {
            const [n, ...rest] = f.split(" ");
            return (
              <span key={f} className="fact">
                <b>{n}</b> {rest.join(" ")}
              </span>
            );
          })}
          <span className="fact">
            <b>{duration(request.startedAt, end)}</b>
          </span>
        </div>
        {children}
      </div>
    </>
  );
}

function Moment({
  m,
  request,
  onOpenPart,
}: {
  m: MessageView;
  request: RequestView;
  onOpenPart(partId: string): void;
}) {
  const kind = moment(m.text);
  const task = m.task
    ? request.phases.flatMap((p) => p.tasks).find((t) => t.id === m.task)
    : undefined;
  const part = task?.part;
  return (
    <li className="moment">
      <time className="moment-t" dateTime={m.ts}>
        {clock(m.ts)}
      </time>
      <div className="moment-body">
        {(task || kind) && (
          <div className="moment-hd">
            {task &&
              (part ? (
                <button
                  type="button"
                  className="task-chip"
                  onClick={() => onOpenPart(part)}
                >
                  {task.title}
                </button>
              ) : (
                <span className="task-chip">{task.title}</span>
              ))}
            {kind && <Pill tone={MOMENT[kind].tone}>{MOMENT[kind].label}</Pill>}
          </div>
        )}
        <Fold text={m.text} className="story-text" />
      </div>
    </li>
  );
}

/** Claude's messages after its opening line: newest first while running, oldest first once done. */
export function Story(props: {
  request: RequestView;
  onOpenPart(partId: string): void;
}) {
  const { request, onOpenPart } = props;
  const rest = (request.messages ?? []).slice(1);
  const ordered = request.finished ? rest : [...rest].reverse();
  return (
    <section className="story" aria-label="What happened">
      <h2 className="lbl">
        What happened
        <span className="lbl-note">
          {request.finished ? "oldest first" : "newest first"}
        </span>
      </h2>
      <ol className="moments">
        {ordered.map((m) => (
          <Moment key={m.id} m={m} request={request} onOpenPart={onOpenPart} />
        ))}
      </ol>
    </section>
  );
}
