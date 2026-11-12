/*
 * The Tasks tab: every task of the request in one list, by phase in the plan's order, then
 * the work after the plan. A request with no plan lists its map's parts. Each row opens the
 * task's page, its title growing into the page's title.
 */
import type { PartView, RequestView, TaskView } from "@murmur/core";
import { cutWords } from "../format";
import { StateMark, Words } from "../marks";
import { follow, partPath } from "../router";
import {
  livePhase,
  ownAgents,
  phaseName,
  phaseSpan,
  taskTimes,
  taskTitle,
} from "../session";
import { coreState, type State, workState } from "../state";
import {
  clock,
  duration,
  firstSentence,
  nOf,
  outcome,
  verdictOf,
} from "../story";
import {
  agentShown,
  MARK,
  type Shown,
  shownOf,
  span,
  taskShown,
  WORD,
} from "./Track";

interface Row {
  key: string;
  /** Its number in the plan; "" for work after it. */
  n: string;
  shown: Shown;
  title: string;
  line?: string | undefined;
  facts: string[];
  part?: string | undefined;
  /** The plan task it is, when it is one: one part can carry several. */
  task?: string | undefined;
}

interface Group {
  key: string;
  title: string;
  meta: string;
  rows: Row[];
}

const took = (from?: string, to?: string) => {
  if (!from || !to) return [];
  const d = duration(from, to);
  return [`took ${d === "under a minute" ? "<1 m" : d}`];
};

/** Its helpers, files and time: how long it took, or when it started while it runs. */
function factsOf(
  shown: Shown,
  helpers: number,
  files: number,
  from?: string,
  to?: string,
): string[] {
  if (shown === "todo" || (shown === "open" && !from)) return [];
  return [
    ...(helpers ? [nOf(helpers, "helper")] : []),
    ...(files ? [nOf(files, "file")] : []),
    ...(shown === "now"
      ? from
        ? [`started ${clock(from)}`]
        : []
      : shown === "done"
        ? took(from, to)
        : []),
  ];
}

/** One quiet line: a sentence, cut at a word when it runs long; none that only repeats the title. */
function quiet(s: string | undefined, title: string) {
  if (!s) return undefined;
  const bare = (x: string) => x.toLowerCase().replace(/[.!?\s]+$/, "");
  return bare(s) === bare(title) ? undefined : cutWords(firstSentence(s), 160);
}

function taskRow(req: RequestView, t: TaskView, state: State): Row {
  const tasks = req.phases.flatMap((p) => p.tasks);
  const part = req.parts.find((p) => p.id === t.part);
  // A part shared by several tasks says nothing about any one of them.
  const own = part && tasks.filter((x) => x.part === part.id).length === 1;
  const shown = taskShown(t, state);
  const title = taskTitle(t);
  const times = taskTimes(req, t);
  const from = times[0] ?? (own ? part.span?.start : undefined);
  const to = times.at(-1) ?? (own ? part.span?.end : undefined);
  const aim = own ? part.aim?.aim : undefined;
  const last = own ? part.steps.at(-1)?.text : undefined;
  const line =
    shown === "blocked"
      ? (t.ask?.text ?? aim)
      : shown === "failed"
        ? (t.problem ?? outcome(req, t) ?? last)
        : shown === "done"
          ? (outcome(req, t) ?? last ?? aim)
          : aim;
  return {
    key: t.id,
    n: String(tasks.indexOf(t) + 1),
    shown,
    title,
    line: quiet(line, title),
    facts: factsOf(
      shown,
      ownAgents(req, t).length,
      own ? part.files.length : 0,
      from,
      to,
    ),
    part: t.part,
    task: t.id,
  };
}

function partShown(p: PartView, state: State): Shown {
  if (p.failures >= 3) return "failed";
  return shownOf(workState(p.status, state));
}

function partRow(req: RequestView, p: PartView, i: number, state: State): Row {
  const shown = partShown(p, state);
  const line =
    shown === "done" ? (p.steps.at(-1)?.text ?? p.aim?.aim) : p.aim?.aim;
  const title = taskTitle(p);
  return {
    key: p.id,
    n: String(i + 1),
    shown,
    title,
    line: quiet(line, title),
    facts: factsOf(
      shown,
      p.agents.filter((id) => req.agents.some((a) => a.id === id)).length,
      p.files.length,
      p.span?.start,
      p.span?.end,
    ),
    part: p.id,
  };
}

/** The groups the list shows: the plan's phases and the work after it, else the parts. */
export function taskGroups(
  req: RequestView,
  done: boolean,
  /** The request's state at the moment shown (state.ts); else read from `done` and core. */
  reqState?: State,
  at = new Date().toISOString(),
): Group[] {
  const state = reqState ?? (done || req.finished ? "done" : coreState(req));
  // An inferred request's parts are folders (its helpers' work is a phase): no plan.
  if (!req.phases.length)
    return req.parts.length && !req.planInferred
      ? [
          {
            key: "parts",
            title: "Parts",
            meta: `${req.parts.filter((p) => p.status === "done").length} of ${req.parts.length} done`,
            rows: req.parts.map((p, i) => partRow(req, p, i, state)),
          },
        ]
      : [];
  const groups: Group[] = req.phases.map((ph) => {
    const { from, to } = phaseSpan(req, ph);
    const n = ph.tasks.filter((t) => t.status === "done").length;
    return {
      key: ph.id,
      title: phaseName(ph, state === "running"),
      meta: [`${n} of ${ph.tasks.length} done`, span(from, to)]
        .filter(Boolean)
        .join(" · "),
      rows: ph.tasks.map((t) => taskRow(req, t, state)),
    };
  });
  const beyond = req.beyond;
  if (beyond) {
    const helpers = req.agents
      .filter((a) => beyond.agents.includes(a.id))
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    // Work after the plan with no helper of its own has no row here (its story says it).
    if (helpers.length)
      groups.push({
        key: "beyond",
        title: "Beyond the plan",
        meta: `since ${clock(beyond.since)}`,
        rows: helpers.map((a) => {
          const shown = agentShown(a, state, at);
          return {
            key: a.id,
            n: "",
            shown,
            title: a.description || "A helper",
            line: verdictOf(a.report)?.label,
            facts: factsOf(shown, 0, 0, a.startedAt, a.endedAt ?? a.report?.ts),
            part: a.part,
          };
        }),
      });
  }
  return groups;
}

export function TasksTab(props: {
  sessionId: string;
  request: RequestView;
  done: boolean;
  /** The request's state at the moment shown (state.ts). */
  state?: State | undefined;
  /** The moment shown (a replay's), for which helpers are still at work. */
  at?: string | undefined;
}) {
  const { sessionId, request: req, done } = props;
  const groups = taskGroups(req, done, props.state, props.at);
  if (!groups.length)
    return (
      <p className="tab-empty">
        {req.parts.length || req.looseFiles.length
          ? "No plan on this request: Claude worked without one. What it changed is in Files."
          : "This request has no tasks."}
      </p>
    );
  // The live phase's running row first, else the first running row, pulses.
  const live = livePhase(req, done)?.id;
  const rows = groups.flatMap((g) => g.rows.map((r) => ({ g: g.key, r })));
  const pulse = (
    rows.find(({ g, r }) => g === live && r.shown === "now") ??
    rows.find(({ r }) => r.shown === "now")
  )?.r;
  return (
    <section className="tasks" aria-label="Tasks">
      {groups.map((g) => (
        <section key={g.key} className="tk-group" aria-label={g.title}>
          <div className="tk-h">
            <h2>{g.title}</h2>
            <span className="tk-meta num">{g.meta}</span>
          </div>
          <ol className="tk-rows">
            {g.rows.map((r) => {
              // A plan task opens as itself: several tasks can share one part.
              const path = r.part
                ? partPath(sessionId, req.id, r.task ?? r.part)
                : undefined;
              const body = (
                <>
                  <span className="tk-n num">{r.n}</span>
                  <StateMark mark={MARK[r.shown]} pulse={r === pulse} />
                  <span className="tk-main">
                    <span className="tk-t">
                      <Words text={r.title} />
                    </span>
                    <span className="sr-only">, {WORD[r.shown]}</span>
                    {r.line && (
                      <span className="tk-line">
                        <Words text={r.line} />
                      </span>
                    )}
                    {r.facts.length > 0 && (
                      <span className="tk-facts num">
                        {r.facts.join(" · ")}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                <li key={r.key} className={`tk ${r.shown}`}>
                  {path ? (
                    <a className="tk-row" href={path} onClick={follow(path)}>
                      {body}
                    </a>
                  ) : (
                    <div className="tk-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </section>
  );
}
