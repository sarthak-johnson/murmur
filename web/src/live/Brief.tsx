/*
 * The request's brief, under its title: where it stands, its key moments, its numbers,
 * and (amber, only when real) what waits on you. Each cell is drawn only when it has
 * something to say.
 */
import {
  type Flag,
  type KeyMoment,
  keyMoments,
  type RequestView,
} from "@murmur/core";
import { few } from "../format";
import { shortTitle, type Waiting } from "../session";
import {
  clock,
  duration,
  fixRoundCount,
  nOf,
  taskNumber,
  thousands,
} from "../story";
import { StateMark } from "./Rail";
import { NeedIcon } from "./TopBar";

const MINUS = "−";

/** A key moment's mark: its own shape and colour, its word for screen readers. */
const MOMENT_MARK: Record<KeyMoment["mark"], { cls: string; word: string }> = {
  done: { cls: "done", word: "Done" },
  problem: { cls: "failed", word: "Problem found" },
  fixing: { cls: "waiting fix", word: "Fixing" },
  decision: { cls: "open", word: "Decision" },
  plan: { cls: "beyond", word: "Plan" },
};

export function MomentMark({ mark }: { mark: KeyMoment["mark"] }) {
  const { cls, word } = MOMENT_MARK[mark];
  return (
    <>
      {mark === "done" || mark === "problem" ? (
        <StateMark mark={mark === "done" ? "done" : "failed"} />
      ) : (
        <span className={`mk ${cls}`} aria-hidden="true">
          {mark === "fixing" ? "!" : null}
        </span>
      )}
      <span className="sr-only">{word}</span>
    </>
  );
}

/** A task as a chip: its plan number when its title has one, else its short name. */
export function chipLabel(title: string): string {
  return taskNumber(title) ?? shortTitle(title);
}

/** "17 min" or "3 h 06 m", the number large and its unit small. */
function Elapsed({ from, to }: { from: string; to: string }) {
  const d = duration(from, to);
  const m = /^(\d+) m$/.exec(d);
  const hm = /^(\d+) h (\d+) m$/.exec(d);
  if (m)
    return (
      <>
        {m[1]}
        <small> min</small>
      </>
    );
  if (hm)
    return (
      <>
        {hm[1]}
        <small> h </small>
        {hm[2]}
        <small> m</small>
      </>
    );
  return (
    <>
      {"<1"}
      <small> min</small>
    </>
  );
}

const ROLE_WORD: [keyof NonNullable<RequestView["helperCounts"]>, string][] = [
  ["build", "built"],
  ["review", "reviewed"],
  ["recheck", "rechecked"],
  ["fix", "fixed"],
];

function Numbers(props: { request: RequestView; end: string; done: boolean }) {
  const { request: req, end, done } = props;
  const files = [...req.parts.flatMap((p) => p.files), ...req.looseFiles];
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const running = req.agents.filter((a) => a.status === "running").length;
  const rounds = fixRoundCount(req);
  const back = req.sentBack?.length ?? 0;
  const counts = req.helperCounts;
  const roles = counts
    ? ROLE_WORD.filter(([k]) => counts[k] > 0).map(
        ([k, w]) => `${counts[k]} ${w}`,
      )
    : [];
  const helpers = req.tally.helpers || req.agents.length;
  return (
    <section className="rb-cell rb-nums" aria-label="By the numbers">
      <h2 className="k">By the numbers</h2>
      <div className="figs">
        <div className="fig">
          <div className="v num">
            <Elapsed from={req.startedAt} to={end} />
          </div>
          <div className="l">{done ? "from ask to last word" : "elapsed"}</div>
        </div>
        {helpers > 0 && (
          <div className="fig">
            <div className="v num">{helpers}</div>
            <div className="l">
              {running
                ? `helpers, ${running} running`
                : roles.length > 1
                  ? `helpers: ${roles.join(", ")}`
                  : helpers === 1
                    ? "helper"
                    : "helpers"}
            </div>
          </div>
        )}
        {req.tally.files > 0 && (
          <div className="fig">
            <div className="v num">{thousands(req.tally.files)}</div>
            <div className="l">
              {req.tally.files === 1 ? "file" : "files"}
              {added || removed ? ", " : ""}
              {added > 0 && <span className="add">+{thousands(added)}</span>}
              {added > 0 && removed > 0 && " "}
              {removed > 0 && (
                <span className="del">
                  {MINUS}
                  {thousands(removed)}
                </span>
              )}
            </div>
          </div>
        )}
        {rounds > 0 && (
          <div className="fig">
            <div className="v num">{rounds}</div>
            <div className="l">
              {rounds === 1 ? "fix round" : "fix rounds"}
              {back > 0 && ` on ${nOf(back, "task")}`}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The second sentence: what is still running, or what was left open. */
function edgeOf(req: RequestView, done: boolean): string {
  const running = req.agents.filter((a) => a.status === "running");
  if (!done && running.length)
    return `Still running: ${few(running.map((a) => a.description || "a helper"))}.`;
  const open = req.phases
    .flatMap((p) => p.tasks)
    .filter((t) => t.status !== "done");
  if ((done || req.finished) && open.length) {
    return `Left open: ${few(open.map((t) => shortTitle(t.title)))}.`;
  }
  return "";
}

function Waits(props: {
  request: RequestView;
  waiting: Waiting;
  risky: Flag[];
}) {
  const { request, waiting, risky } = props;
  const now = new Date().toISOString();
  const items = waiting.questions.length
    ? waiting.questions.map((q) => ({ text: q.question, detail: q.detail }))
    : (request.waiting ?? []).map((text) => ({ text, detail: undefined }));
  return (
    <section className="rb-need" id="needs" aria-label="Waiting on you">
      <h2 className="k">
        <NeedIcon />
        <span>
          Waiting on you{" "}
          <span className="num">
            · since {clock(waiting.since)}, {duration(waiting.since, now)}
          </span>
        </span>
      </h2>
      {!items.length && waiting.text && <p className="rb-q">{waiting.text}</p>}
      {(items.length > 0 || risky.length > 0) && (
        <ul className="rb-qs">
          {items.map((q) => (
            <li key={q.text}>
              {q.text}
              {q.detail && <span className="rb-d"> {q.detail}</span>}
            </li>
          ))}
          {risky.map((f) => (
            <li key={`${f.ts}:${f.text}`}>{f.text}</li>
          ))}
        </ul>
      )}
      <p className="rb-where">Answer in the terminal</p>
    </section>
  );
}

/** The brief: a card of typed facts, each cell only when it has something. */
export function RequestBrief(props: {
  request: RequestView;
  done: boolean;
  /** Claude stopped (done, or waiting on you with no helper at work): the clock stops at `end`. */
  stopped: boolean;
  end: string;
  waiting: Waiting | null;
  lastLooked: string | null;
}) {
  const { request: req, done, stopped, end, waiting, lastLooked } = props;
  const now = new Date().toISOString();
  const outcome = req.outcome;
  const edge = edgeOf(req, done);
  const moments = keyMoments(req, lastLooked ?? undefined);
  const fresh = moments.filter((m) => m.new).length;
  const tasks = new Map(
    req.phases.flatMap((p) => p.tasks).map((t) => [t.id, t]),
  );
  const risky = req.flags.filter((f) => f.kind === "risky" && f.pending);
  const stands = done ? "What came out of it" : "Where it stands";
  return (
    <section className="rb" aria-label="The brief">
      {(outcome || edge) && (
        <section className="rb-cell rb-stands" aria-label={stands}>
          <h2 className="k">{stands}</h2>
          {outcome && <p className="rb-out">{outcome}</p>}
          {edge && <p className="rb-edge">{edge}</p>}
        </section>
      )}
      {moments.length > 0 && (
        <section className="rb-cell rb-moments" aria-label="Key moments">
          <h2 className="k">
            Key moments
            {fresh > 0 && lastLooked && (
              <span className="badge new">
                {fresh} new since {clock(lastLooked)}
              </span>
            )}
          </h2>
          <ol className="km">
            {moments.map((m) => {
              const t = m.task ? tasks.get(m.task) : undefined;
              return (
                <li
                  key={`${m.ts}:${m.text}`}
                  className={m.new ? "km-row new" : "km-row"}
                >
                  <MomentMark mark={m.mark} />
                  <time className="num" dateTime={m.ts}>
                    {clock(m.ts)}
                  </time>
                  <span className="km-t">
                    {m.text}
                    {m.new && (
                      <>
                        <i className="nw" aria-hidden="true" />
                        <span className="sr-only">, new</span>
                      </>
                    )}
                    {t && (
                      <span className="chip" title={t.title}>
                        {chipLabel(t.title)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <Numbers request={req} end={stopped ? end : now} done={done} />
      {waiting && <Waits request={req} waiting={waiting} risky={risky} />}
    </section>
  );
}
