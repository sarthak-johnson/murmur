/*
 * The Tasks tab: every task of the request in one list, by phase in the plan's order, then
 * the work after the plan. A request with no plan lists its map's parts. Each row opens the
 * task's page, its title growing into the page's title.
 */
import type { PartView, RequestView, TaskView } from "@murmur/core";
import { cutWords } from "../format";
import { follow, partPath } from "../router";
import { livePhase, shortTitle, taskAgents, taskTimes } from "../session";
import {
  clock,
  duration,
  firstSentence,
  nOf,
  outcome,
  verdictOf,
} from "../story";
import { StateMark } from "./Rail";
import { agentShown, MARK, type Shown, span, taskShown } from "./Track";

interface Row {
  key: string;
  /** Its number in the plan; "" for work after it. */
  n: string;
  shown: Shown;
  title: string;
  line?: string | undefined;
  facts: string[];
  part?: string | undefined;
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

function taskRow(req: RequestView, t: TaskView, over: boolean): Row {
  const tasks = req.phases.flatMap((p) => p.tasks);
  const part = req.parts.find((p) => p.id === t.part);
  // A part shared by several tasks says nothing about any one of them.
  const own = part && tasks.filter((x) => x.part === part.id).length === 1;
  const shown = taskShown(t, over);
  const times = taskTimes(req, t);
  const from = times[0] ?? (own ? part.span?.start : undefined);
  const to = times.at(-1) ?? (own ? part.span?.end : undefined);
  const aim = own ? part.aim?.aim : undefined;
  const last = own ? part.steps.at(-1)?.text : undefined;
  const line =
    shown === "failed"
      ? (t.problem ?? outcome(req, t) ?? last)
      : shown === "done"
        ? (outcome(req, t) ?? last ?? aim)
        : aim;
  return {
    key: t.id,
    n: String(tasks.indexOf(t) + 1),
    shown,
    title: shortTitle(t.title),
    line: quiet(line, shortTitle(t.title)),
    facts: factsOf(
      shown,
      taskAgents(req, t).length,
      own ? part.files.length : 0,
      from,
      to,
    ),
    part: t.part,
  };
}

function partShown(p: PartView, over: boolean): Shown {
  if (p.failures >= 3) return "failed";
  if (p.status === "done") return "done";
  return over ? "open" : p.status;
}

function partRow(req: RequestView, p: PartView, i: number, over: boolean): Row {
  const shown = partShown(p, over);
  const line =
    shown === "done" ? (p.steps.at(-1)?.text ?? p.aim?.aim) : p.aim?.aim;
  return {
    key: p.id,
    n: String(i + 1),
    shown,
    title: shortTitle(p.title),
    line: quiet(line, shortTitle(p.title)),
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
export function taskGroups(req: RequestView, done: boolean): Group[] {
  const over = done || req.finished;
  if (!req.phases.length)
    return req.parts.length
      ? [
          {
            key: "parts",
            title: "Parts",
            meta: `${req.parts.filter((p) => p.status === "done").length} of ${req.parts.length} done`,
            rows: req.parts.map((p, i) => partRow(req, p, i, over)),
          },
        ]
      : [];
  const groups: Group[] = req.phases.map((ph) => {
    const times = ph.tasks.flatMap((t) => taskTimes(req, t)).sort();
    const n = ph.tasks.filter((t) => t.status === "done").length;
    return {
      key: ph.id,
      title: ph.title,
      meta: [`${n} of ${ph.tasks.length} done`, span(times[0], times.at(-1))]
        .filter(Boolean)
        .join(" · "),
      rows: ph.tasks.map((t) => taskRow(req, t, over)),
    };
  });
  const beyond = req.beyond;
  if (beyond) {
    const helpers = req.agents
      .filter((a) => beyond.agents.includes(a.id))
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    groups.push({
      key: "beyond",
      title: "Beyond the plan",
      meta: `since ${clock(beyond.since)}`,
      rows: helpers.map((a) => {
        const shown = agentShown(a, over);
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

/** Whether the list has a running row, which then carries the page's one pulse. */
export const tasksPulse = (req: RequestView, done: boolean) =>
  taskGroups(req, done).some((g) => g.rows.some((r) => r.shown === "now"));

export function TasksTab(props: {
  sessionId: string;
  request: RequestView;
  done: boolean;
}) {
  const { sessionId, request: req, done } = props;
  const groups = taskGroups(req, done);
  if (!groups.length)
    return <p className="tab-empty">This request has no tasks.</p>;
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
              const path = r.part
                ? partPath(sessionId, req.id, r.part)
                : undefined;
              const body = (
                <>
                  <span className="tk-n num">{r.n}</span>
                  <StateMark mark={MARK[r.shown]} pulse={r === pulse} />
                  <span className="tk-main">
                    <span className="tk-t" data-morph={path}>
                      {r.title}
                    </span>
                    {r.line && <span className="tk-line">{r.line}</span>}
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
