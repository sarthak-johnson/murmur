/*
 * The story: Claude's messages under the phase core puts them in, then "Beyond the plan".
 * A finished section reads oldest first; the live one newest first, under a now row for
 * helpers that have not reported yet. A task's run of messages folds into one row.
 */
import type {
  AgentView,
  MessageView,
  PhaseView,
  RequestView,
  TaskView,
} from "@murmur/core";
import { type ReactNode, useState } from "react";
import { Fold } from "../markdown";
import { livePhase, type Mark, shortTitle, taskAgents } from "../session";
import {
  clock,
  duration,
  firstSentence,
  MOMENT,
  moment,
  nOf,
  taskNumber,
} from "../story";
import { StateMark } from "./Rail";

/** Lines a message shows before "Show more"; one that fits is never folded. */
const FOLD_LINES = 8;

function TaskChip(props: { task: TaskView; onOpenPart(partId: string): void }) {
  const { task, onOpenPart } = props;
  const part = task.part;
  return part ? (
    <button
      type="button"
      className="chip task-chip"
      title={task.title}
      onClick={() => onOpenPart(part)}
    >
      {shortTitle(task.title)}
    </button>
  ) : (
    <span className="chip task-chip" title={task.title}>
      {shortTitle(task.title)}
    </span>
  );
}

function Badge({ text }: { text: string }) {
  const kind = moment(text);
  if (!kind) return null;
  return (
    <span className={`badge ${MOMENT[kind].tone}`}>{MOMENT[kind].label}</span>
  );
}

/** One message on its own: time, badge, task chip, the message. */
function Message(props: {
  m: MessageView;
  task?: TaskView | undefined;
  onOpenPart(partId: string): void;
}) {
  const { m, task, onOpenPart } = props;
  const kind = moment(m.text);
  return (
    <li className="st-msg st-in">
      <time className="st-t" dateTime={m.ts}>
        {clock(m.ts)}
      </time>
      <div className="st-body">
        {(task || kind) && (
          <div className="st-row">
            <Badge text={m.text} />
            {task && <TaskChip task={task} onOpenPart={onOpenPart} />}
          </div>
        )}
        <Fold text={m.text} lines={FOLD_LINES} className="story-text" />
      </div>
    </li>
  );
}

/** A task's run of messages as one row: name, how it ended, time, helpers, count. Opens in place. */
function Run(props: {
  ms: MessageView[];
  task: TaskView;
  request: RequestView;
}) {
  const { ms, task, request } = props;
  const [open, setOpen] = useState(false);
  const first = ms[0] as MessageView;
  const last = ms.at(-1) as MessageView;
  const num = taskNumber(task.title);
  const name = shortTitle(task.title);
  const helpers = taskAgents(request, task).length;
  const facts = [
    duration(first.ts, last.ts) === "under a minute"
      ? "<1 m"
      : duration(first.ts, last.ts),
    ...(helpers ? [nOf(helpers, "helper")] : []),
    nOf(ms.length, "message"),
  ];
  return (
    <li className="st-run st-in">
      <time className="st-t" dateTime={first.ts}>
        {clock(first.ts)}
      </time>
      <div className="st-body">
        <button
          type="button"
          className="st-run-box"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="st-run-t">
            {num && num !== name ? `${num} · ${name}` : name}
          </span>
          <span className="st-run-r">{firstSentence(last.text)}</span>
          <span className="st-run-c num">{facts.join(" · ")}</span>
          <svg className="st-chev" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3.5 2 6.5 5l-3 3" />
          </svg>
        </button>
        {open && (
          <ol className="st-run-msgs">
            {ms.map((m) => (
              <li key={m.id}>
                <div className="st-row">
                  <time className="st-t" dateTime={m.ts}>
                    {clock(m.ts)}
                  </time>
                  <Badge text={m.text} />
                </div>
                <Fold text={m.text} lines={FOLD_LINES} className="story-text" />
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
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

/** Decisions, problems found and a phase finished stand alone, never folded into a run. */
function standsAlone(m: MessageView): boolean {
  const kind = moment(m.text);
  return (
    kind === "decision" ||
    kind === "problem" ||
    (kind === "done" && /\bphase\b/i.test(firstSentence(m.text)))
  );
}

/** Runs of consecutive messages about the same task, in time order. */
function runs(request: RequestView, ms: MessageView[]) {
  const out: { task?: TaskView | undefined; ms: MessageView[] }[] = [];
  for (const m of ms) {
    const task = standsAlone(m) ? undefined : taskOfMessage(request, m);
    const last = out.at(-1);
    if (last && task && last.task === task) last.ms.push(m);
    else out.push({ task, ms: [m] });
  }
  return out;
}

/** One section's rows: runs fold, the rest stand alone; newest first when live. */
function Rows(props: {
  request: RequestView;
  ms: MessageView[];
  newestFirst: boolean;
  waiting: AgentView[];
  onOpenPart(partId: string): void;
}) {
  const { request, ms, newestFirst, waiting, onOpenPart } = props;
  const groups = runs(request, ms);
  if (newestFirst) groups.reverse();
  const now = new Date().toISOString();
  return (
    <ol className="st-rows">
      {newestFirst &&
        waiting.map((a) => (
          <li key={`now:${a.id}`} className="st-now">
            <span className="st-t">now</span>
            <span className="st-now-b">
              <StateMark mark="running" />
              <span>
                {a.description || "A helper"}, running for{" "}
                <span className="num">{duration(a.startedAt, now)}</span>. No
                report yet.
              </span>
            </span>
          </li>
        ))}
      {groups.map((g) => {
        const head = g.ms[0] as MessageView;
        // Keyed by its oldest message, so a row stays put (and open) as newer ones join.
        return g.task && g.ms.length > 1 ? (
          <Run key={head.id} ms={g.ms} task={g.task} request={request} />
        ) : (
          <Message
            key={head.id}
            m={head}
            task={g.task ?? taskOfMessage(request, head)}
            onOpenPart={onOpenPart}
          />
        );
      })}
    </ol>
  );
}

/**
 * Each message's phase: core's `phase`, else (views built before core had it) its
 * task's, else the phase of the message before it.
 */
function phaseOf(request: RequestView, ms: MessageView[]) {
  const byTask = (m: MessageView) =>
    request.phases.find((p) =>
      p.tasks.includes(taskOfMessage(request, m) as TaskView),
    )?.id;
  let carry: string | undefined;
  const out = ms.map((m) => {
    carry = m.phase ?? byTask(m) ?? carry;
    return carry;
  });
  const first = out.find(Boolean) ?? request.phases[0]?.id;
  return out.map((p) => p ?? first);
}

const STATE: Record<
  "done" | "now" | "todo" | "open",
  { mark: Mark; word: string }
> = {
  done: { mark: "done", word: "Done" },
  now: { mark: "running", word: "Running" },
  todo: { mark: "open", word: "Not started" },
  open: { mark: "open", word: "Left open" },
};

function Section(props: {
  id: string;
  title: string;
  shown: keyof typeof STATE;
  meta: string;
  children: ReactNode;
}) {
  const { id, title, shown, meta, children } = props;
  const { mark, word } = STATE[shown];
  return (
    <section id={id} className="st-phase" aria-label={title}>
      <div className="st-h">
        <h2>{title}</h2>
        <span className={`st-word ${shown}`}>
          <StateMark mark={mark} />
          {word}
        </span>
        <span className="st-meta num">{meta}</span>
      </div>
      {children}
    </section>
  );
}

const when = (ms: MessageView[]) => {
  const a = ms[0]?.ts;
  const b = ms.at(-1)?.ts;
  if (!a || !b) return "";
  return clock(a) === clock(b) ? clock(a) : `${clock(a)} to ${clock(b)}`;
};

/** Claude's messages, by phase, then beyond the plan. */
export function Story(props: {
  request: RequestView;
  /** Over or stopped: every section reads oldest first. */
  done: boolean;
  onOpenPart(partId: string): void;
}) {
  const { request, done, onOpenPart } = props;
  const ms = request.messages ?? [];
  const beyond = request.beyond;
  const beyondIds = new Set(beyond?.messages ?? []);
  const planned = ms.filter((m) => !beyondIds.has(m.id));
  const after = ms.filter((m) => beyondIds.has(m.id));
  const over = done || request.finished;
  const waiting = request.agents.filter(
    (a) => a.status === "running" && !a.report,
  );
  // The live section: beyond the plan when there is one, else the live phase.
  const live = over
    ? undefined
    : beyond
      ? "beyond"
      : livePhase(request, done)?.id;
  const of = phaseOf(request, planned);
  const shownOf = (ph: PhaseView): keyof typeof STATE =>
    ph.status === "done"
      ? "done"
      : over
        ? "open"
        : ph.id === live
          ? "now"
          : ph.status;

  if (!ms.length && (!live || !waiting.length)) return null;
  return (
    <section className="story" aria-label="What happened">
      {request.phases.length === 0 ? (
        <Section
          id="story-all"
          title="What happened"
          shown={over ? "done" : "now"}
          meta={over ? "oldest first" : "newest first"}
        >
          <Rows
            request={request}
            ms={ms}
            newestFirst={!over}
            waiting={over ? [] : waiting}
            onOpenPart={onOpenPart}
          />
        </Section>
      ) : (
        request.phases.map((ph) => {
          const mine = planned.filter((_, i) => of[i] === ph.id);
          const isLive = ph.id === live;
          if (!mine.length && !(isLive && waiting.length)) return null;
          const n = ph.tasks.filter((t) => t.status === "done").length;
          const meta = [
            isLive ? "newest first" : when(mine),
            `${n} of ${ph.tasks.length}`,
            ...(mine.length > 3 ? [nOf(mine.length, "message")] : []),
          ].filter(Boolean);
          return (
            <Section
              key={ph.id}
              id={`phase-${ph.id}`}
              title={ph.title}
              shown={shownOf(ph)}
              meta={meta.join(" · ")}
            >
              <Rows
                request={request}
                ms={mine}
                newestFirst={isLive}
                waiting={isLive ? waiting : []}
                onOpenPart={onOpenPart}
              />
            </Section>
          );
        })
      )}
      {beyond &&
        request.phases.length > 0 &&
        (after.length > 0 || live === "beyond") && (
          <Section
            id="phase-beyond"
            title="Beyond the plan"
            shown={live === "beyond" ? "now" : "done"}
            meta={`since ${clock(beyond.since)}${live === "beyond" ? " · newest first" : ""}`}
          >
            <Rows
              request={request}
              ms={after}
              newestFirst={live === "beyond"}
              waiting={live === "beyond" ? waiting : []}
              onOpenPart={onOpenPart}
            />
          </Section>
        )}
    </section>
  );
}
