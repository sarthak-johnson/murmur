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
import { cutWords } from "../format";
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

/** What a task's run did, in order: "built, review found X, fixed, passed"; "" when unclear. */
export function runSummary(ms: MessageView[]): string {
  const kinds = ms.map((m) => moment(m.text));
  const firsts = ms.map((m) => firstSentence(m.text));
  const problem = kinds.indexOf("problem");
  const problems = kinds.filter((k) => k === "problem").length;
  const lastDone = kinds.lastIndexOf("done");
  const before = problem < 0 ? firsts : firsts.slice(0, problem);
  const out: string[] = [];
  if (before.some((f) => /\b(?:buil[dt]|building|review)/i.test(f)))
    out.push("built");
  if (problem >= 0) {
    const first = firsts[problem] as string;
    const colon = first.indexOf(":");
    const what =
      (colon >= 0 && first.slice(colon + 1).trim()) ||
      /\bfound\s+(.+)$/i.exec(first)?.[1] ||
      "a problem";
    // "Bar still jumps" reads as "bar still jumps"; "CSS" stays as it is.
    const detail = cutWords(
      /^[A-Z][a-z]/.test(what)
        ? what.charAt(0).toLowerCase() + what.slice(1)
        : what,
      48,
    ).replace(/[.!?]$/, "");
    out.push(
      `review found ${detail}${problems > 1 ? `, then ${problems - 1} more` : ""}`,
    );
    if (
      ms
        .slice(problem + 1)
        .some(
          (m, i) =>
            kinds[problem + 1 + i] === "fixing" ||
            /\bfix/i.test(firstSentence(m.text)),
        ) ||
      lastDone > problem
    )
      out.push("fixed");
  }
  if (lastDone >= 0 && lastDone > kinds.lastIndexOf("problem"))
    out.push("passed");
  return out.join(", ");
}

/** A task's run of messages as one row: name, what happened, time, helpers, count. Opens in place. */
function Run(props: {
  ms: MessageView[];
  subject: Subject;
  request: RequestView;
  /** In the live section, newest first. */
  live: boolean;
  /** The live section's newest run. */
  newest: boolean;
}) {
  const { ms, subject, request, live } = props;
  // The live section's newest run opens and stays open while the section is live, so
  // a newer run never folds the one under the reader; once over it folds. The reader's
  // own toggle always wins.
  const [auto] = useState(props.newest);
  const [mine, setMine] = useState<boolean>();
  const open = mine ?? (live && auto);
  const first = ms[0] as MessageView;
  const last = ms.at(-1) as MessageView;
  const [one] = subject.tasks;
  const num = one && subject.tasks.length === 1 && taskNumber(one.title);
  const title =
    subject.tasks.length === 1 && one
      ? num && num !== shortTitle(one.title)
        ? `${num} · ${shortTitle(one.title)}`
        : shortTitle(one.title)
      : subject.tasks.length > 1
        ? `${subject.label} · ${subject.tasks.map((t) => shortTitle(t.title)).join(", ")}`
        : subject.label;
  const helpers = new Set([
    ...subject.tasks.flatMap((t) => taskAgents(request, t).map((a) => a.id)),
    ...ms.flatMap((m) => (m.agent ? [m.agent] : [])),
  ]).size;
  const took = duration(first.ts, last.ts);
  const facts = [
    took === "under a minute" ? "<1 m" : took,
    ...(helpers ? [nOf(helpers, "helper")] : []),
    nOf(ms.length, "message"),
  ];
  const problem = ms.some((m) => moment(m.text) === "problem");
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
          onClick={() => setMine(!open)}
        >
          <span className="st-run-t">{title}</span>
          {problem && <span className="badge bad">Problem found</span>}
          <span className="st-run-r">
            {runSummary(ms) || firstSentence(last.text)}
          </span>
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

/** What a run of messages is about: one or more plan tasks, or a task named only in the text. */
type Subject = { key: string; label: string; tasks: TaskView[] };

/** A phase finished and a change of plan are about the request, not a task: they stand alone. */
function standsAlone(m: MessageView): boolean {
  const kind = moment(m.text);
  return (
    kind === "plan" ||
    (kind === "done" &&
      /\bphase(?:\s+[\w-]+)?\s+(?:is|was|has)\s+(?:now\s+)?(?:done|finished|complete)\b/i.test(
        firstSentence(m.text),
      ))
  );
}

// "Task 2", "Tasks 4 and 5", "Tasks 13, 14 and 15", "Bug B1", "Tasks 4-5".
const NAMED =
  /\b(tasks?|bugs?)\s+([A-Z]?\d+[a-z]?(?:\s*(?:,|&|-|–|and|to)\s*[A-Z]?\d+[a-z]?)*)/i;

/** The tasks the first sentence names, by their number, else as a label. */
function named(request: RequestView, m: MessageView): Subject | undefined {
  const hit = NAMED.exec(firstSentence(m.text));
  if (!hit) return undefined;
  const kind = (hit[1] as string).toLowerCase().startsWith("bug")
    ? "bug"
    : "task";
  const ids = (hit[2] as string).match(/[A-Z]?\d+[a-z]?/gi) ?? [];
  const tasks = request.phases.flatMap((p) => p.tasks);
  const mine = ids.flatMap((id) =>
    tasks.filter(
      (t) =>
        taskNumber(t.title)
          ?.toLowerCase()
          .replace(/^tasks?\s+/, "task ") === `${kind} ${id.toLowerCase()}`,
    ),
  );
  const label = hit[0].replace(/\s+/g, " ");
  const word = kind === "bug" ? "Bug" : "Task";
  return {
    key: `${kind}:${ids.join("+").toLowerCase()}`,
    label: `${ids.length > 1 ? `${word}s` : word}${label.slice(label.search(/\s/))}`,
    tasks: mine.length === ids.length ? mine : [],
  };
}

const ofTask = (t: TaskView): Subject => ({
  key: `id:${t.id}`,
  label: t.title,
  tasks: [t],
});

// A text-named single task and core's or a helper's tie to it are the same subject.
const keyOf = (s: Subject) =>
  s.tasks.length === 1 ? `id:${s.tasks[0]?.id}` : s.key;

/**
 * Rows of messages about the same subject. A message's subject is the task core tied it
 * to, else the tasks its first sentence names, else its helper's task; one about nothing
 * named carries on the subject before it. A phase finished or a plan change stands
 * alone. Live, a row is a run of consecutive messages, so a new one never moves an older
 * row; once over, each subject's messages gather in one row at its first message.
 */
function runs(request: RequestView, ms: MessageView[], gather: boolean) {
  const out: { subject?: Subject | undefined; ms: MessageView[] }[] = [];
  const rows = new Map<string, (typeof out)[number]>();
  let carry: Subject | undefined;
  for (const m of ms) {
    if (standsAlone(m)) {
      out.push({ ms: [m] });
      carry = undefined;
      continue;
    }
    const core = m.task
      ? request.phases.flatMap((p) => p.tasks).find((t) => t.id === m.task)
      : undefined;
    const helper = m.agent
      ? taskOfMessage(request, {
          id: m.id,
          ts: m.ts,
          text: m.text,
          agent: m.agent,
        })
      : undefined;
    const subject =
      (core && ofTask(core)) ??
      named(request, m) ??
      (helper && ofTask(helper)) ??
      carry;
    carry = subject;
    const last = out.at(-1);
    const row = subject
      ? gather
        ? rows.get(keyOf(subject))
        : last?.subject && keyOf(last.subject) === keyOf(subject)
          ? last
          : undefined
      : undefined;
    if (row) row.ms.push(m);
    else {
      const fresh = { subject, ms: [m] };
      out.push(fresh);
      if (subject) rows.set(keyOf(subject), fresh);
    }
  }
  return out;
}

/** One section's rows: runs fold, the rest stand alone; newest first when live. */
function Rows(props: {
  request: RequestView;
  ms: MessageView[];
  newestFirst: boolean;
  waiting: AgentView[];
  /** What Claude is on, for a live section with nothing else to say yet. */
  now?: string | undefined;
  onOpenPart(partId: string): void;
}) {
  const { request, ms, newestFirst, waiting, now: on, onOpenPart } = props;
  const groups = runs(request, ms, !newestFirst);
  if (newestFirst) groups.reverse();
  const now = new Date().toISOString();
  return (
    <ol className="st-rows">
      {on && (
        <li className="st-now">
          <span className="st-t">now</span>
          <span className="st-now-b">
            <StateMark mark="running" />
            <span>{on}</span>
          </span>
        </li>
      )}
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
      {groups.map((g, i) => {
        const head = g.ms[0] as MessageView;
        // Keyed by its oldest message, so a row stays put (and open) as newer ones join.
        return g.subject && g.ms.length > 1 ? (
          <Run
            key={head.id}
            ms={g.ms}
            subject={g.subject}
            request={request}
            live={newestFirst}
            newest={newestFirst && i === 0}
          />
        ) : (
          <Message
            key={head.id}
            m={head}
            task={g.subject?.tasks[0]}
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
  "done" | "now" | "part" | "todo" | "open",
  { mark: Mark; word: string }
> = {
  done: { mark: "done", word: "Done" },
  now: { mark: "running", word: "Running" },
  part: { mark: "open", word: "Partly done" },
  todo: { mark: "open", word: "Not started" },
  open: { mark: "open", word: "Left open" },
};

/**
 * What Claude is on, said while a running request has no word in its live section yet:
 * its last narration, else the task under way, else the next one in the plan.
 */
function onNow(request: RequestView, phase?: PhaseView): string {
  if (request.now?.text) return request.now.text;
  const doing = phase?.tasks.find((t) => t.status === "now");
  if (doing) return `Working on ${shortTitle(doing.title)}.`;
  const next = phase?.tasks.find((t) => t.status === "todo");
  if (next) return `Next in the plan: ${shortTitle(next.title)}.`;
  return "Claude has not written anything yet.";
}

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
          : ph.status === "todo" && ph.tasks.some((t) => t.status === "done")
            ? "part"
            : ph.status;
  // A running request always says something: at least what Claude is on now.
  const quiet = !waiting.length;

  if (!ms.length && (over || (!live && request.phases.length > 0))) return null;
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
            now={!over && !ms.length && quiet ? onNow(request) : undefined}
            onOpenPart={onOpenPart}
          />
        </Section>
      ) : (
        request.phases.map((ph) => {
          const mine = planned.filter((_, i) => of[i] === ph.id);
          const isLive = ph.id === live;
          if (!mine.length && !isLive) return null;
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
                now={
                  isLive && !mine.length && quiet
                    ? onNow(request, ph)
                    : undefined
                }
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
              now={
                live === "beyond" && !after.length && quiet
                  ? onNow(request)
                  : undefined
              }
              onOpenPart={onOpenPart}
            />
          </Section>
        )}
    </section>
  );
}
