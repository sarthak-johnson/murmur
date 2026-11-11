// The office's detail drawer: everything the rest of the app shows about the request on the
// floor (its story, tasks, flow, files, helpers, the session's journey), plus a close-up of
// whatever was clicked in the room. The office is the map; this is where the detail lives.
import type {
  AgentView,
  MurmurEvent,
  RequestView,
  SessionView,
} from "@murmur/core";
import { memo, useEffect, useRef } from "react";
import { PathText } from "../files";
import { FlowBoard } from "../flow/FlowBoard";
import { Assumptions } from "../live/Assumptions";
import { RequestBrief } from "../live/Brief";
import { Story } from "../live/Story";
import { FilesTab, HelpersTab, helperPart } from "../live/Tabs";
import { TasksTab } from "../live/Tasks";
import { Markdown } from "../markdown";
import { PartDetail } from "../part/PartDetail";
import { follow, requestPath, sessionPath } from "../router";
import {
  askOf,
  type RequestState,
  requestShort,
  type Waiting,
} from "../session";
import { clock, duration, helperLine, verdictOf } from "../story";
import type { MainEntry } from "./scene";

export const DRAWER_TABS = [
  ["story", "Story"],
  ["tasks", "Tasks"],
  ["flow", "Flow"],
  ["files", "Files"],
  ["helpers", "Helpers"],
  ["requests", "Requests"],
] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number][0];

/** What the drawer shows: a tab, or a close-up of a thing in the room (`agent:id`, `task:id`, ...). */
export interface DrawerState {
  tab: DrawerTab;
  item?: string | undefined;
  /** On the Tasks tab: the phase to bring into view. */
  phase?: string | undefined;
}

/** A thing in the room as the tab that tells its story; the rest open a close-up. */
export function drawerFor(key: string): DrawerState {
  const [kind] = key.split(":");
  if (kind === "phase")
    return { tab: "tasks", item: undefined, phase: key.slice(6) };
  if (kind === "archive") return { tab: "files" };
  if (kind === "jobs") return { tab: "requests" };
  if (kind === "claude") return { tab: "story" };
  return { tab: "story", item: key };
}

/** Redrawn only when what it shows changes: the room repaints far more often. */
export const Drawer = memo(DrawerBody);

function DrawerBody(props: {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
  request: RequestView;
  state: RequestState;
  end: string;
  waiting: Waiting | null;
  mainLog: MainEntry[];
  /** The time shown, for durations of helpers still at work. */
  t: string;
  /** Following the newest moment; else a replay's moment, where clocks stop at `t`. */
  following: boolean;
  models: Map<string, string>;
  drawer: DrawerState;
  docked: boolean;
  /** Shows a request's floor in the office. */
  onPickRequest(requestId: string): void;
  /** Bumped each time a click opens it: focus then moves into it. */
  focusKey: number;
  onChange(d: DrawerState | null): void;
}) {
  const { sessionId, view, events, request: req, drawer, onChange } = props;
  const { state, end, waiting } = props;
  const done = state === "done";
  const n = view.requests.indexOf(req) + 1;
  const body = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!props.focusKey) return;
    if (!aside.current?.contains(document.activeElement))
      opener.current = document.activeElement;
    aside.current?.focus({ preventScroll: true });
  }, [props.focusKey]);
  // Closed: focus goes back to what opened it, if it is still there.
  useEffect(
    () => () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    },
    [],
  );
  // A new thing or tab starts at its top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on what is shown changing
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
  }, [drawer.tab, drawer.item]);
  // A phase header opens Tasks at that phase, marked for a moment.
  useEffect(() => {
    const title = req.phases.find((p) => p.id === drawer.phase)?.title;
    if (!title || drawer.tab !== "tasks" || drawer.item) return;
    const head = [...(body.current?.querySelectorAll("h2") ?? [])].find(
      (h) => h.textContent?.trim() === title,
    );
    const group = head?.closest("section") ?? head;
    group?.scrollIntoView?.({ block: "start" });
    group?.classList.add("of-flash");
    const t = setTimeout(() => group?.classList.remove("of-flash"), 1600);
    return () => clearTimeout(t);
  }, [drawer.phase, drawer.tab, drawer.item, req]);
  const openPart = (p: string) =>
    onChange({ tab: drawer.tab, item: `part:${p}` });

  return (
    <aside
      ref={aside}
      tabIndex={-1}
      className={props.docked ? "of-drawer docked" : "of-drawer"}
      aria-label="Details"
    >
      <header className="of-dh">
        <div className="of-dh-row">
          <a
            className="of-dh-req"
            href={requestPath(sessionId, req.id)}
            onClick={follow(requestPath(sessionId, req.id))}
            title="Open the request's page"
          >
            <span className="muted">Request {n}</span> {askOf(req)}
          </a>
          <button
            type="button"
            className="of-close"
            aria-label="Close details"
            onClick={() => onChange(null)}
          >
            Close
          </button>
        </div>
        <nav className="of-tabs" aria-label="Details of this request">
          {DRAWER_TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              aria-current={
                t === drawer.tab && !drawer.item ? "page" : undefined
              }
              onClick={() => onChange({ tab: t })}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="of-db" ref={body}>
        {drawer.item ? (
          <>
            <button
              type="button"
              className="link of-back"
              onClick={() => onChange({ tab: drawer.tab })}
            >
              ‹ {DRAWER_TABS.find(([t]) => t === drawer.tab)?.[1]}
            </button>
            <CloseUp {...props} item={drawer.item} onOpenPart={openPart} />
          </>
        ) : drawer.tab === "tasks" ? (
          <TasksTab sessionId={sessionId} request={req} done={done} />
        ) : drawer.tab === "flow" ? (
          <FlowBoard sessionId={sessionId} request={req} />
        ) : drawer.tab === "files" ? (
          <FilesTab request={req} events={events} cwd={view.cwd} />
        ) : drawer.tab === "helpers" ? (
          <HelpersTab
            sessionId={sessionId}
            request={req}
            events={events}
            now={props.t}
          />
        ) : drawer.tab === "requests" ? (
          <Requests
            sessionId={sessionId}
            view={view}
            current={req.id}
            onPick={props.onPickRequest}
          />
        ) : (
          <>
            <RequestBrief
              request={req}
              done={done}
              stopped={state !== "running" || !props.following}
              end={props.following ? end : props.t}
              waiting={waiting}
              lastLooked={null}
            />
            <Assumptions sessionId={sessionId} assumptions={req.assumptions} />
            <Story request={req} done={done} onOpenPart={openPart} />
          </>
        )}
      </div>
    </aside>
  );
}

/** A close-up of one thing in the room. */
function CloseUp(
  props: Parameters<typeof DrawerBody>[0] & {
    item: string;
    onOpenPart(partId: string): void;
  },
) {
  const { sessionId, view, events, request: req, item } = props;
  const [kind, id = ""] = item.split(/:(.*)/s);
  const n = view.requests.indexOf(req) + 1;
  const running = props.state === "running";
  if (kind === "agent") {
    const a = view.requests.flatMap((r) => r.agents).find((x) => x.id === id);
    if (a)
      return (
        <HelperCloseUp
          view={view}
          agent={a}
          t={props.t}
          model={props.models.get(a.id)}
          onOpenPart={props.onOpenPart}
        />
      );
  }
  if (kind === "task" || kind === "part") {
    const task = req.phases.flatMap((p) => p.tasks).find((x) => x.id === id);
    const partId = kind === "part" ? id : task?.part;
    const part = req.parts.find((p) => p.id === partId);
    if (part)
      return (
        <PartDetail
          cwd={view.cwd}
          sessionId={sessionId}
          requestNumber={n}
          request={req}
          running={running}
          part={part}
          events={events}
        />
      );
    if (task)
      return (
        <section className="of-card">
          <p className="of-kicker">Task</p>
          <h2>{task.title}</h2>
          <p className="muted">
            {task.status === "done"
              ? "Done."
              : task.status === "now"
                ? "Under way."
                : "Not started yet."}
          </p>
        </section>
      );
  }
  if (kind === "door") {
    const w = props.waiting;
    return (
      <>
        <section className="of-card">
          <p className="of-kicker">Your door</p>
          {w ? (
            <>
              <h2>
                {w.permission
                  ? "Claude needs your permission"
                  : "Claude is waiting on you"}
              </h2>
              {w.questions.length ? (
                <ol className="of-asks">
                  {w.questions.map((q) => (
                    <li key={q.question}>
                      <b>{q.question}</b>
                      {q.detail && <span className="muted"> {q.detail}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                w.text && <p>{w.text}</p>
              )}
              <p className="muted">
                Since {clock(w.since)}. Reply in Claude Code.
              </p>
            </>
          ) : (
            <>
              <h2>Nothing waiting on you</h2>
              <p className="muted">
                Claude has not asked you anything on this request yet. When it
                does, Claude walks to this door and the question shows here.
              </p>
            </>
          )}
        </section>
        <RequestBrief
          request={req}
          done={props.state === "done"}
          stopped={props.state !== "running" || !props.following}
          end={props.following ? props.end : props.t}
          waiting={props.waiting}
          lastLooked={null}
        />
      </>
    );
  }
  if (kind === "terminal") return <Terminal {...props} />;
  return <p className="muted">Nothing to show for this yet.</p>;
}

/** A helper at its desk: who briefed it for what, what it is on, and what it said back. */
function HelperCloseUp(props: {
  view: SessionView;
  agent: AgentView;
  t: string;
  model: string | undefined;
  onOpenPart(partId: string): void;
}) {
  const { view, agent: a, t, model } = props;
  const req = view.requests.find((r) => r.agents.includes(a)) as RequestView;
  const part = helperPart(req, a);
  const runningNow = a.status === "running";
  const took = duration(a.startedAt, a.endedAt ?? a.report?.ts ?? t);
  const verdict = verdictOf(a.report);

  return (
    <section className="of-card">
      <p className="of-kicker">
        Helper · {a.role ? ROLE[a.role] : "Helper"}
        {model && ` · ${model}`}
      </p>
      <h2>{a.description || "A helper"}</h2>
      <p className="of-chips">
        <span className={runningNow ? "of-chip now" : "of-chip done"}>
          {runningNow ? `Running · ${took}` : `Done · took ${took}`}
        </span>
        {verdict && !/^done$/i.test(verdict.label) && (
          <span className={`of-chip ${verdict.tone}`}>{verdict.label}</span>
        )}
        <span className="muted">started {clock(a.startedAt)}</span>
      </p>
      <p>{helperLine(a, runningNow)}</p>
      {part && (
        <p>
          <button
            type="button"
            className="link"
            onClick={() => props.onOpenPart(part)}
          >
            Open its task
          </button>
        </p>
      )}
      {a.brief && (
        <>
          <h3>Its brief</h3>
          <Markdown text={a.brief} className="of-md" />
        </>
      )}
      {a.report?.text && (
        <>
          <h3>{a.report.interim ? "Its latest word" : "Its report"}</h3>
          <Markdown text={a.report.text} className="of-md" />
        </>
      )}
      {!!a.files?.length && (
        <>
          <h3>Files it changed</h3>
          <ul className="of-files">
            {a.files.map((f) => (
              <li key={f}>
                <PathText path={f} cwd={view.cwd} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const ROLE: Record<NonNullable<AgentView["role"]>, string> = {
  build: "Builder",
  review: "Reviewer",
  recheck: "Re-reviewer",
  fix: "Fixer",
  plan: "Planner",
  research: "Researcher",
  other: "Helper",
};

/** The terminal: the commands Claude itself ran for this request, newest first. */
function Terminal(props: Parameters<typeof DrawerBody>[0]) {
  const { request: req, view, mainLog, t } = props;
  const next = view.requests[view.requests.indexOf(req) + 1]?.startedAt;
  const runs = mainLog
    .filter(
      (e) =>
        e.k === "tool" &&
        (e.tool === "Bash" || e.tool === "Monitor") &&
        e.t >= req.startedAt &&
        e.t <= t &&
        (!next || e.t < next),
    )
    .reverse();
  return (
    <section className="of-card">
      <p className="of-kicker">Terminal</p>
      <h2>Commands Claude ran</h2>
      {runs.length ? (
        <ol className="of-runs">
          {runs.slice(0, 60).map((e) => (
            <li key={e.t + (e.label ?? "")}>
              <span className="of-when">{clock(e.t)}</span>
              <span>{e.label ?? e.tool}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No commands yet in this request.</p>
      )}
    </section>
  );
}

/** Every request of the session at the moment shown: pick one to see its floor. */
function Requests(props: {
  sessionId: string;
  view: SessionView;
  current: string;
  onPick(requestId: string): void;
}) {
  const { sessionId, view, current, onPick } = props;
  const path = sessionPath(sessionId);
  return (
    <section className="of-card">
      <p className="of-kicker">
        {view.requests.length} request{view.requests.length === 1 ? "" : "s"} in
        this session
      </p>
      <ol className="of-reqs">
        {view.requests.map((r, i) => {
          const word = STATE_WORD[r.state ?? "done"] ?? "Done";
          return (
            <li key={r.id}>
              <button
                type="button"
                className={r.id === current ? "of-req-row cur" : "of-req-row"}
                aria-current={r.id === current ? "true" : undefined}
                onClick={() => onPick(r.id)}
              >
                <span className="of-req-num">{i + 1}</span>
                <span className="of-req-main">
                  <span className="of-req-t">{requestShort(r)}</span>
                  <span className="muted">
                    {clock(r.startedAt)}
                    {r.agents.length
                      ? ` · ${r.agents.length} helper${r.agents.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </span>
                <span className={`of-chip ${word[0]}`}>{word[1]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p>
        <a className="link" href={path} onClick={follow(path)}>
          The session's journey, on its own page
        </a>
      </p>
    </section>
  );
}

const STATE_WORD: Partial<Record<string, [string, string]>> = {
  running: ["now", "Running"],
  waiting: ["warn", "Waiting on you"],
  done: ["done", "Done"],
  "left-open": ["plain", "Left open"],
  failed: ["bad", "Failed"],
};
