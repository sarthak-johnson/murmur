import type {
  MessageView,
  PhaseView,
  RequestView,
  TaskView,
} from "@murmur/core";
import { useState } from "react";
import { Fold, plainText } from "../markdown";
import { Pill } from "../Pill";
import { shortTitle } from "../session";
import { clock, MOMENT, moment, outcome } from "../story";

function TaskChip(props: { task: TaskView; onOpenPart(partId: string): void }) {
  const { task, onOpenPart } = props;
  const part = task.part;
  return part ? (
    <button
      type="button"
      className="task-chip"
      title={task.title}
      onClick={() => onOpenPart(part)}
    >
      {shortTitle(task.title)}
    </button>
  ) : (
    <span className="task-chip" title={task.title}>
      {shortTitle(task.title)}
    </span>
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
            <Badge text={m.text} />
            {task && <TaskChip task={task} onOpenPart={onOpenPart} />}
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

/**
 * Each message's phase: its task's, else the phase of the message before it (the work
 * it was written during); messages before any task is named go with the first phase named.
 */
export function phaseOfMessages(
  request: RequestView,
  ms: MessageView[],
): (PhaseView | undefined)[] {
  const phaseOf = (t: TaskView | undefined) =>
    t && request.phases.find((p) => p.tasks.includes(t));
  let carry: PhaseView | undefined;
  const out = ms.map((m) => {
    carry = phaseOf(taskOfMessage(request, m)) ?? carry;
    return carry;
  });
  const first = out.find(Boolean);
  return out.map((p) => p ?? first);
}

/** One part of the story: its messages as moments and blocks, in the order given. */
function Moments(props: {
  request: RequestView;
  ms: MessageView[];
  newestFirst: boolean;
  onOpenPart(partId: string): void;
}) {
  const { request, ms, newestFirst, onOpenPart } = props;
  const ordered = newestFirst ? [...ms].reverse() : ms;
  const taskOf = (m: MessageView | undefined) =>
    m ? taskOfMessage(request, m) : undefined;
  return (
    <ol className="moments">
      {runs(ordered, taskOf).map((run) => {
        const task = taskOf(run[0]);
        const head = run[0] as MessageView;
        // Keyed by its oldest message, so a block stays open as newer ones arrive.
        const oldest = (newestFirst ? run.at(-1) : head) as MessageView;
        return task && run.length > 1 ? (
          <Group
            key={oldest.id}
            ms={run}
            task={task}
            request={request}
            onOpenPart={onOpenPart}
          />
        ) : (
          <Moment key={head.id} m={head} task={task} onOpenPart={onOpenPart} />
        );
      })}
    </ol>
  );
}

/** The phases the story has a part for, in the order the story shows them. */
export function storyPhases(request: RequestView) {
  const ms = request.messages ?? [];
  const of = phaseOfMessages(request, ms);
  const groups = request.phases
    .map((phase) => ({ phase, ms: ms.filter((_, i) => of[i] === phase) }))
    .filter((g) => g.ms.length > 0);
  // While it runs the newest work leads; once over the story reads in plan order.
  return request.finished ? groups : groups.reverse();
}

/**
 * Claude's messages, under the phase they belong to: the live phase newest first, a
 * finished one oldest first. A request with no plan is one list.
 */
export function Story(props: {
  request: RequestView;
  /** The phase where the work is now, if the request is still going. */
  live: PhaseView | undefined;
  onOpenPart(partId: string): void;
}) {
  const { request, live, onOpenPart } = props;
  const ms = request.messages ?? [];
  const groups = storyPhases(request);
  // The phase the work is in: the live one, else the latest one talked about.
  const current = request.finished ? undefined : (live ?? groups[0]?.phase);
  return (
    <section className="story" aria-label="What happened">
      <a className="skip" href="#plan">
        Skip to the plan
      </a>
      {groups.length === 0 ? (
        <>
          <div className="sect">
            <h2>What happened</h2>
            <span>{request.finished ? "oldest first" : "newest first"}</span>
          </div>
          <Moments
            request={request}
            ms={ms}
            newestFirst={!request.finished}
            onOpenPart={onOpenPart}
          />
        </>
      ) : (
        groups.map(({ phase, ms }) => {
          const newest = phase === current;
          return (
            <section
              key={phase.id}
              id={`phase-${phase.id}`}
              className="story-phase"
              aria-label={phase.title}
            >
              <div className="sect">
                <h2>{phase.title}</h2>
                <span>
                  what happened, {newest ? "newest first" : "oldest first"}
                </span>
              </div>
              <Moments
                request={request}
                ms={ms}
                newestFirst={newest}
                onOpenPart={onOpenPart}
              />
            </section>
          );
        })
      )}
    </section>
  );
}
