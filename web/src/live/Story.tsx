import type { MessageView, RequestView, TaskView } from "@murmur/core";
import { type ReactNode, useState } from "react";
import { Fold, plainText } from "../markdown";
import { Pill } from "../Pill";
import { clock, duration, MOMENT, moment, outcome, sentBack } from "../story";

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

function TaskChip(props: { task: TaskView; onOpenPart(partId: string): void }) {
  const { task, onOpenPart } = props;
  const part = task.part;
  return part ? (
    <button
      type="button"
      className="task-chip"
      onClick={() => onOpenPart(part)}
    >
      {task.title}
    </button>
  ) : (
    <span className="task-chip">{task.title}</span>
  );
}

function Badge({ text }: { text: string }) {
  const kind = moment(text);
  return kind ? (
    <Pill tone={MOMENT[kind].tone}>{MOMENT[kind].label}</Pill>
  ) : null;
}

/** One message on its own: time, task chip, badge, the message. */
function Moment(props: {
  m: MessageView;
  task?: TaskView | undefined;
  onOpenPart(partId: string): void;
}) {
  const { m, task, onOpenPart } = props;
  const kind = moment(m.text);
  return (
    <li className="moment">
      <time className="moment-t" dateTime={m.ts}>
        {clock(m.ts)}
      </time>
      <div className="moment-body">
        {(task || kind) && (
          <div className="moment-hd">
            {task && <TaskChip task={task} onOpenPart={onOpenPart} />}
            <Badge text={m.text} />
          </div>
        )}
        <Fold text={m.text} className="story-text" />
      </div>
    </li>
  );
}

function GroupMessage({ m }: { m: MessageView }) {
  return (
    <div className="group-msg">
      <div className="moment-hd">
        <time className="msg-t" dateTime={m.ts}>
          {clock(m.ts)}
        </time>
        <Badge text={m.text} />
      </div>
      <Fold text={m.text} className="story-text" />
    </div>
  );
}

/** A run of messages about one task: its title and outcome, the first and last message, "N more". */
function Group(props: {
  ms: MessageView[];
  task: TaskView;
  request: RequestView;
  onOpenPart(partId: string): void;
}) {
  const { ms, task, request, onOpenPart } = props;
  const [open, setOpen] = useState(false);
  const first = ms[0] as MessageView;
  const last = ms.at(-1) as MessageView;
  const middle = ms.slice(1, -1);
  // The outcome line, unless it only repeats a message shown in full right here.
  const shown = new Set(
    [first, last].map((m) => plainText(m.text.split(/\n\s*\n/)[0] ?? m.text)),
  );
  const out = outcome(request, task);
  const ended = out && !shown.has(out) ? out : undefined;
  return (
    <li className="moment group">
      <time className="moment-t" dateTime={first.ts}>
        {clock(first.ts)}
      </time>
      <div className="moment-body">
        <div className="moment-hd">
          <TaskChip task={task} onOpenPart={onOpenPart} />
          <span className="group-n">{ms.length} messages</span>
        </div>
        {ended && <p className="group-out">{ended}</p>}
        <div className="group-msgs">
          <GroupMessage m={first} />
          {middle.length > 0 && (
            // One button that stays put, so focus stays on it as it opens and closes.
            <button
              type="button"
              className="link group-more"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Show fewer" : `${middle.length} more`}
            </button>
          )}
          {open && middle.map((m) => <GroupMessage key={m.id} m={m} />)}
          <GroupMessage m={last} />
        </div>
      </div>
    </li>
  );
}

/** Consecutive messages about the same task, as runs; a message about no task stands alone. */
function runs<T>(
  ms: MessageView[],
  taskOf: (m: MessageView) => T | undefined,
): MessageView[][] {
  const out: MessageView[][] = [];
  let last: T | undefined;
  for (const m of ms) {
    const task = taskOf(m);
    const run = out.at(-1);
    if (run && task && task === last) run.push(m);
    else out.push([m]);
    last = task;
  }
  return out;
}

/**
 * The task a message is about: the one core linked it to, else the one task whose
 * helper's report it follows (the helper is on that task's part).
 */
export function taskOfMessage(
  request: RequestView,
  m: MessageView,
): TaskView | undefined {
  const tasks = request.phases.flatMap((p) => p.tasks);
  if (m.task) return tasks.find((t) => t.id === m.task);
  const agent = m.agent;
  if (!agent) return undefined;
  const parts = new Set(
    request.parts.filter((p) => p.agents.includes(agent)).map((p) => p.id),
  );
  const mine = tasks.filter(
    (t) =>
      t.agents.includes(agent) || (t.part !== undefined && parts.has(t.part)),
  );
  return mine.length === 1 ? mine[0] : undefined;
}

/** Claude's messages after its opening line: newest first while running, oldest first once done. */
export function Story(props: {
  request: RequestView;
  onOpenPart(partId: string): void;
}) {
  const { request, onOpenPart } = props;
  const rest = (request.messages ?? []).slice(1);
  const ordered = request.finished ? rest : [...rest].reverse();
  const taskOf = (m: MessageView | undefined) =>
    m ? taskOfMessage(request, m) : undefined;
  return (
    <section className="story" aria-label="What happened">
      <a className="skip" href="#plan">
        Skip to the plan
      </a>
      <h2 className="lbl">
        What happened
        <span className="lbl-note">
          {request.finished ? "oldest first" : "newest first"}
        </span>
      </h2>
      <ol className="moments">
        {runs(ordered, taskOf).map((run) => {
          const task = taskOf(run[0]);
          const head = run[0] as MessageView;
          // Keyed by its oldest message, so a block stays open as newer ones arrive.
          const oldest = (request.finished ? head : run.at(-1)) as MessageView;
          return task && run.length > 1 ? (
            <Group
              key={oldest.id}
              ms={run}
              task={task}
              request={request}
              onOpenPart={onOpenPart}
            />
          ) : (
            <Moment
              key={head.id}
              m={head}
              task={task}
              onOpenPart={onOpenPart}
            />
          );
        })}
      </ol>
    </section>
  );
}
