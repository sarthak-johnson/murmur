/*
 * The side column: who helped (one line each, a mini bar on the request's clock), the
 * files by task (top five, the rest on the Files tab) and what was checked. A card with
 * nothing in it is not drawn.
 */
import {
  type AgentRole,
  type AgentView,
  displayPath,
  type FileTouch,
  type MurmurEvent,
  type RequestView,
} from "@murmur/core";
import { follow, requestPath } from "../router";
import { type Mark, modelOf } from "../session";
import {
  clock,
  duration,
  helperLine,
  nOf,
  thousands,
  verdictOf,
} from "../story";
import { StateMark } from "./Rail";

const MINUS = "−";
/** Over this many helpers the card counts them by role instead. */
const ONE_EACH = 8;
const TOP_FILES = 5;

function Link(props: { href: string; children: string }) {
  return (
    <a className="side-more" href={props.href} onClick={follow(props.href)}>
      {props.children}
    </a>
  );
}

const helperMark = (a: AgentView, over: boolean): Mark =>
  a.status === "running"
    ? over
      ? "open"
      : "running"
    : verdictOf(a.report)?.tone === "bad"
      ? "failed"
      : "done";

const ROLE: Record<AgentRole, string> = {
  build: "built",
  review: "reviewed",
  recheck: "rechecked",
  fix: "fixed",
  plan: "planned",
  research: "researched",
  other: "did other work",
};

/** A bar's place on the shared clock, as left and width in percent. */
function bar(from: string, to: string, t0: number, t1: number) {
  const total = Math.max(t1 - t0, 1);
  const left = Math.min(Math.max((Date.parse(from) - t0) / total, 0), 1);
  const width = Math.max((Date.parse(to) - Date.parse(from)) / total, 0.02);
  return {
    left: `${(left * 100).toFixed(1)}%`,
    width: `${(Math.min(width, 1 - left) * 100).toFixed(1)}%`,
  };
}

function Helpers(props: {
  sessionId: string;
  request: RequestView;
  events: MurmurEvent[];
  over: boolean;
  end: string;
}) {
  const { sessionId, request: req, events, over, end } = props;
  const agents = [...req.agents].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  );
  if (!agents.length) return null;
  const now = new Date().toISOString();
  const t0 = Date.parse(req.startedAt);
  const t1 = Date.parse(over ? end : now);
  const stop = (a: AgentView) =>
    a.status === "running" ? now : (a.endedAt ?? a.report?.ts ?? a.startedAt);
  const running = over
    ? 0
    : agents.filter((a) => a.status === "running").length;

  type Row = {
    key: string;
    name: string;
    sub: string;
    mark: Mark;
    from: string;
    to: string;
    line?: string;
  };
  let rows: Row[];
  if (agents.length <= ONE_EACH) {
    rows = agents.map((a) => {
      const mark = helperMark(a, over);
      const verdict = verdictOf(a.report)?.label;
      const sub =
        mark === "running"
          ? [
              modelOf(a, events),
              `running ${duration(a.startedAt, now)}`,
              a.report ? "reported" : "no report yet",
            ]
              .filter(Boolean)
              .join(" · ")
          : [`${clock(a.startedAt)} to ${clock(stop(a))}`, verdict]
              .filter(Boolean)
              .join(" · ");
      return {
        key: a.id,
        name: a.description || "A helper",
        sub,
        mark,
        from: a.startedAt,
        to: stop(a),
        line: helperLine(a, mark === "running"),
      };
    });
  } else {
    const byRole = new Map<AgentRole, AgentView[]>();
    for (const a of agents) {
      const r = a.role ?? "other";
      byRole.set(r, [...(byRole.get(r) ?? []), a]);
    }
    rows = [...byRole].map(([role, as]) => {
      const live = as.filter((a) => a.status === "running").length;
      const bad = as.filter((a) => helperMark(a, over) === "failed").length;
      const from = as[0]?.startedAt ?? req.startedAt;
      const to = as.map(stop).sort().at(-1) ?? from;
      const sub = [
        `${clock(from)} to ${clock(to)}`,
        ...(!over && live ? [`${live} running`] : []),
        ...(bad ? [`${bad} failed or sent back`] : []),
      ].join(" · ");
      return {
        key: role,
        name: `${as.length} ${ROLE[role]}`,
        sub,
        mark: !over && live ? "running" : bad ? "failed" : "done",
        from,
        to,
      };
    });
  }
  return (
    <section className="side-card" aria-label="Helpers">
      <h2 className="k">
        Helpers
        <span className="cnt num">
          {agents.length}
          {running
            ? ` · ${running} running`
            : over && !agents.some((a) => a.status === "running")
              ? " · all done"
              : ""}
        </span>
      </h2>
      <ul className="hl">
        {rows.map((r, i) => (
          <li key={r.key} className="hl-row">
            {/* Pulses only where the rail's mark is off screen (CSS), and only the first. */}
            <span
              className={
                r.mark === "running" &&
                i === rows.findIndex((x) => x.mark === "running")
                  ? "hl-m solo"
                  : "hl-m"
              }
            >
              <StateMark mark={r.mark} />
            </span>
            <div className="hl-b-wrap">
              <div className="hl-n">{r.name}</div>
              <div className="hl-s">{r.sub}</div>
              {r.line && <div className="hl-do">{r.line}</div>}
              <div className="hl-b" aria-hidden="true">
                <i className={r.mark} style={bar(r.from, r.to, t0, t1)} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {agents.length > ONE_EACH && (
        <Link href={requestPath(sessionId, req.id, "helpers")}>
          {`All ${agents.length} helpers`}
        </Link>
      )}
    </section>
  );
}

const lines = (f: FileTouch) => f.added + f.removed;

function Diff({ f }: { f: { added: number; removed: number } }) {
  return (
    <span className="d num">
      {f.added > 0 && <span className="add">+{thousands(f.added)}</span>}
      {f.added > 0 && f.removed > 0 && " "}
      {f.removed > 0 && (
        <span className="del">
          {MINUS}
          {thousands(f.removed)}
        </span>
      )}
    </span>
  );
}

function Files(props: {
  sessionId: string;
  request: RequestView;
  cwd: string;
}) {
  const { sessionId, request: req, cwd } = props;
  const groups = [
    ...req.parts.map((p) => ({ key: p.id, title: p.title, files: p.files })),
    { key: "loose", title: "Outside any task", files: req.looseFiles },
  ].filter((g) => g.files.length);
  const all = groups.flatMap((g) => g.files);
  if (!all.length) return null;
  const top = new Set(
    [...all].sort((a, b) => lines(b) - lines(a)).slice(0, TOP_FILES),
  );
  const sum = {
    added: all.reduce((n, f) => n + f.added, 0),
    removed: all.reduce((n, f) => n + f.removed, 0),
  };
  const count = req.tally.files || all.length;
  const rest = new Set(all.map((f) => f.path)).size - top.size;
  return (
    <section className="side-card" aria-label="Files">
      <h2 className="k">
        Files
        <span className="cnt num">
          {thousands(count)}
          {sum.added || sum.removed ? " · " : ""}
          <Diff f={sum} />
        </span>
      </h2>
      <div className="fl">
        {groups.map((g) => {
          const shown = g.files.filter((f) => top.has(f));
          if (!shown.length) return null;
          return (
            <div key={g.key} className="fl-grp">
              <div className="fl-g">
                {g.title} · {g.files.length}
              </div>
              <ul className="fl-list">
                {shown.map((f) => (
                  <li key={f.path} className="fl-f">
                    <span className="p" title={f.path}>
                      <bdi>{displayPath(f.path, cwd)}</bdi>
                    </span>
                    <Diff f={f} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {rest > 0 && (
        <Link
          href={requestPath(sessionId, req.id, "files")}
        >{`${rest} more`}</Link>
      )}
    </section>
  );
}

const CHECK: Record<"pass" | "fail" | "untried", { mark: Mark; word: string }> =
  {
    pass: { mark: "done", word: "passed" },
    fail: { mark: "failed", word: "failed" },
    untried: { mark: "open", word: "not yet checked" },
  };

function Checked({ request: req }: { request: RequestView }) {
  const checks = req.parts.flatMap((p) =>
    p.checks.map((c) => ({ ...c, key: `${p.id}:${c.check}` })),
  );
  if (!checks.length) return null;
  return (
    <section className="side-card" aria-label="Checked">
      <h2 className="k">
        Checked
        <span className="cnt num">
          {nOf(
            checks.filter((c) => c.status === "pass").length,
            "pass",
            "pass",
          )}
        </span>
      </h2>
      <ul className="ck">
        {checks.map((c) => (
          <li key={c.key} className="ck-row">
            <StateMark mark={CHECK[c.status].mark} />
            <span>
              {c.check}
              <span className="sr-only">, {CHECK[c.status].word}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Helpers, files and checks beside the story; not drawn when all three are empty. */
export function SideColumn(props: {
  sessionId: string;
  request: RequestView;
  events: MurmurEvent[];
  cwd: string;
  over: boolean;
  end: string;
}) {
  const { sessionId, request, events, cwd, over, end } = props;
  const has =
    request.agents.length > 0 ||
    request.looseFiles.length > 0 ||
    request.parts.some((p) => p.files.length || p.checks.length);
  if (!has) return null;
  return (
    <aside className="side" aria-label="Helpers, files and checks">
      <Helpers
        sessionId={sessionId}
        request={request}
        events={events}
        over={over}
        end={end}
      />
      <Files sessionId={sessionId} request={request} cwd={cwd} />
      <Checked request={request} />
    </aside>
  );
}
