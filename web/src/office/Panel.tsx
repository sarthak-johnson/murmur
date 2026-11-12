// The office's panel: everything about the session and the request on the floor, and a
// close-up of whatever was clicked in the room. Its header says where you are and climbs
// back up; its two rows of tabs are the session's views and the request's. What it shows
// is the URL's `?open=`, so every change is a step Back undoes.
import type {
  AgentView,
  MurmurEvent,
  RequestView,
  SessionView,
} from "@murmur/core";
import { memo, useEffect, useRef } from "react";
import { PathText } from "../files";
import { FlowBoard } from "../flow/FlowBoard";
import { dayLabel } from "../format";
import { Assumptions } from "../live/Assumptions";
import { RequestBrief } from "../live/Brief";
import { Journey, SessionHead } from "../live/Journey";
import { Story } from "../live/Story";
import { FilesTab, HelpersTab, helperPart } from "../live/Tabs";
import { TasksTab } from "../live/Tasks";
import { PhaseTrack } from "../live/Track";
import { Markdown } from "../markdown";
import { StateMark } from "../marks";
import { PartDetail } from "../part/PartDetail";
import { floorPath, follow, navigate } from "../router";
import {
  askOf,
  cleanPrompt,
  KIND,
  type Mark,
  placeOf,
  type RequestState,
  requestShort,
  taskTitle,
  type Waiting,
} from "../session";
import { SessionFlow } from "../sflow/SessionFlow";
import {
  coreState,
  helperNow,
  type RequestNow,
  type SessionNow,
  type State,
  WORD,
  workState,
} from "../state";
import {
  clock,
  duration,
  fixRoundCount,
  helperLine,
  nOf,
  sentBack,
  thousands,
  verdictOf,
} from "../story";
import { RequestList } from "./Bar";
import {
  isSessionTab,
  isTab,
  isWideView,
  REQUEST_VIEWS,
  SESSION_VIEWS,
  toolWords,
} from "./panelState";
import type { MainEntry } from "./scene";

export interface PanelProps {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
  request: RequestView;
  state: RequestState;
  /** How the request stands at the moment shown (state.ts), word, clock and all. */
  stands: RequestNow;
  /** The session at the moment shown (state.ts), for the Requests list's states. */
  ses: SessionNow;
  waiting: Waiting | null;
  lastLooked: string | null;
  mainLog: MainEntry[];
  /** The time shown, for durations of helpers still at work. */
  t: string;
  /** Following the newest moment; else a replay's moment, where clocks stop at `t`. */
  following: boolean;
  models: Map<string, string>;
  /** What it shows: a tab or a close-up, as `?open=` says it. */
  open: string;
  /** The floor's own address: the pinned request, or none when following. */
  floorId: string | undefined;
  activeId: string | undefined;
  /** On the Tasks tab: the phase a click on the board asked for, and that click's count. */
  phase?: { id: string; n: number } | undefined;
  wide: boolean;
  /** The wide toggle, where the window has room for it. */
  onWide?: (() => void) | undefined;
  /** Shows a request's floor in the office. */
  onPickRequest(requestId: string): void;
  onClose(): void;
  /** Bumped each time a click in the room opens it: focus then moves into it. */
  focusKey: number;
}

/** Redrawn only when what it shows changes: the room repaints far more often. */
export const Panel = memo(PanelBody);

/** A close-up's `task:<id>`: a plan task's id, else a part's (then its first task). */
const closeUpPlace = (req: RequestView, id: string) => {
  const own = placeOf(req, { task: id });
  return own?.task ? own : (placeOf(req, { part: id }) ?? own);
};

/** A task's place in its request's plan, as its breadcrumb says it: its one number and title. */
function taskLabel(req: RequestView, id: string): string {
  const place = closeUpPlace(req, id);
  if (!place) return "Task";
  return place.task ? `Task ${place.n} · ${place.title}` : place.title;
}

/** The close-up's own level of the breadcrumb. */
function closeUpLabel(view: SessionView, req: RequestView, open: string) {
  const [kind, id = ""] = open.split(/:(.*)/s);
  if (kind === "task") return taskLabel(req, id);
  if (kind === "helper") {
    const a = view.requests.flatMap((r) => r.agents).find((x) => x.id === id);
    return `Helper · ${a?.description || "a helper"}`;
  }
  return (
    (
      { door: "Your door", terminal: "Terminal", claude: "Claude" } as Record<
        string,
        string
      >
    )[kind ?? ""] ?? ""
  );
}

function PanelBody(props: PanelProps) {
  const { sessionId, view, events, request: req, open } = props;
  const { state, waiting, floorId } = props;
  const done = state === "done";
  const n = view.requests.indexOf(req) + 1;
  const body = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  // A task's close-up names its request: task ids repeat across requests.
  const at = (o: string) =>
    floorPath(sessionId, o.startsWith("task:") ? req.id : floorId, o);
  const sessionScope = isSessionTab(open);
  const closeUp = !isTab(open);

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
  // A new view starts at the message or phase its link names, else the story (oldest
  // first) at its newest row, else at its top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on what is shown changing
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    const named = id ? document.getElementById(id) : null;
    const el =
      named && body.current?.contains(named)
        ? named
        : open === "story"
          ? body.current?.querySelector("[data-newest]")
          : null;
    if (el) el.scrollIntoView?.({ block: named ? "start" : "center" });
    else body.current?.scrollTo?.({ top: 0 });
  }, [open, req.id]);
  // A phase header opens Tasks at that phase, marked for a moment: once per click, not on
  // every update of the request while it stays open.
  const phaseTitle = req.phases.find((p) => p.id === props.phase?.id)?.title;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new click on the same phase scrolls again
  useEffect(() => {
    if (!phaseTitle || open !== "tasks") return;
    const head = [...(body.current?.querySelectorAll("h2") ?? [])].find(
      (h) => h.textContent?.trim() === phaseTitle,
    );
    const group = head?.closest("section") ?? head;
    group?.scrollIntoView?.({ block: "start" });
    group?.classList.add("of-flash");
    const t = setTimeout(() => group?.classList.remove("of-flash"), 1600);
    return () => {
      clearTimeout(t);
      group?.classList.remove("of-flash");
    };
  }, [phaseTitle, open, props.phase?.n]);
  const openPart = (p: string) => navigate(at(`task:${p}`));
  const sessionTitle = view.title ? cleanPrompt(view.title) : "Session";

  const tab = (t: string, label: string) => (
    <a
      key={t}
      href={at(t)}
      aria-current={t === open ? "page" : undefined}
      onClick={follow(at(t))}
    >
      {label}
    </a>
  );

  return (
    <aside
      ref={aside}
      tabIndex={-1}
      className={props.wide ? "of-panel wide" : "of-panel"}
      aria-label="Details"
      id="panel"
    >
      <div className="of-ph">
        <div className="of-ph-row">
          <nav className="of-crumbs" aria-label="Where you are">
            <ol>
              <li>
                {sessionScope ? (
                  <span aria-current="page" title={sessionTitle}>
                    Session · {sessionTitle}
                  </span>
                ) : (
                  <a
                    href={at("journey")}
                    onClick={follow(at("journey"))}
                    title={sessionTitle}
                  >
                    Session
                  </a>
                )}
              </li>
              {!sessionScope && (
                <li>
                  {closeUp ? (
                    <a
                      href={at("story")}
                      onClick={follow(at("story"))}
                      title={askOf(req)}
                    >
                      Request {n}
                    </a>
                  ) : (
                    <span aria-current="page" title={askOf(req)}>
                      Request {n} · {requestShort(req)}
                    </span>
                  )}
                </li>
              )}
              {closeUp && (
                <li>
                  <span aria-current="page">
                    {closeUpLabel(view, req, open)}
                  </span>
                </li>
              )}
            </ol>
          </nav>
          {props.onWide && isWideView(open) && (
            <button
              type="button"
              className="of-ph-btn"
              aria-pressed={props.wide}
              onClick={props.onWide}
              title={props.wide ? "Back to the docked width" : "Make it wide"}
            >
              {props.wide ? "Dock" : "Wide"}
            </button>
          )}
          <button
            type="button"
            className="of-ph-btn of-close"
            aria-label="Close details"
            title="Close (Esc)"
            onClick={props.onClose}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2h1v1H2zM3 3h1v1H3zM4 4h2v2H4zM6 3h1v1H6zM7 2h1v1H7zM3 6h1v1H3zM2 7h1v1H2zM6 6h1v1H6zM7 7h1v1H7z" />
            </svg>
          </button>
        </div>
        <div className={sessionScope ? "of-scope on" : "of-scope"}>
          <span className="of-scope-k">Session</span>
          <nav className="of-tabs" aria-label="This session">
            {SESSION_VIEWS.map(([t, label]) => tab(t, label))}
          </nav>
        </div>
        <div className={sessionScope ? "of-scope" : "of-scope on"}>
          <span className="of-scope-k">Request {n}</span>
          <nav className="of-tabs" aria-label="This request">
            {REQUEST_VIEWS.map(([t, label]) => tab(t, label))}
          </nav>
        </div>
      </div>
      <div className="of-db" ref={body}>
        {closeUp ? (
          <CloseUp {...props} onOpenPart={openPart} />
        ) : open === "journey" ? (
          <>
            <SessionHead view={view} events={events} ses={props.ses} />
            <Journey
              sessionId={sessionId}
              view={view}
              events={events}
              ses={props.ses}
            />
          </>
        ) : open === "timeline" ? (
          <SessionFlow
            sessionId={sessionId}
            view={view}
            events={events}
            ses={props.ses}
          />
        ) : open === "requests" ? (
          <RequestList
            sessionId={sessionId}
            view={view}
            events={events}
            ses={props.ses}
            currentId={req.id}
            activeId={props.activeId}
            keep="story"
            onPick={props.onPickRequest}
            label="Every request"
          />
        ) : open === "tasks" ? (
          <TasksTab
            sessionId={sessionId}
            request={req}
            done={done}
            state={props.stands.state}
          />
        ) : open === "flow" ? (
          <FlowBoard
            sessionId={sessionId}
            request={req}
            state={props.stands.state}
          />
        ) : open === "files" ? (
          <FilesTab request={req} events={events} cwd={view.cwd} />
        ) : open === "helpers" ? (
          <HelpersTab
            sessionId={sessionId}
            request={req}
            events={events}
            now={props.t}
            state={props.stands.state}
          />
        ) : (
          <>
            <RequestHead view={view} request={req} />
            <RequestBrief
              request={req}
              done={done}
              stopped
              end={props.stands.to}
              waiting={waiting}
              lastLooked={props.lastLooked}
            />
            <PhaseTrack
              sessionId={sessionId}
              request={req}
              done={done}
              stopped
              end={props.stands.to}
            />
            <Assumptions sessionId={sessionId} assumptions={req.assumptions} />
            <Story
              request={req}
              done={done}
              state={props.stands.state}
              at={props.t}
              onOpenPart={openPart}
            />
            <Checked request={req} />
          </>
        )}
      </div>
    </aside>
  );
}

const n_ = (n: number, one: string, many = `${one}s`) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

/** Where the plan came from, said once in the line over the title. */
const source = (req: RequestView) =>
  req.recap
    ? "recap by Claude"
    : req.planInferred
      ? "plan inferred"
      : req.phases.length
        ? "narrated live"
        : "";

/** The request's head, said once at the top of its story: what was asked and its facts. */
function RequestHead(props: { view: SessionView; request: RequestView }) {
  const { view, request: req } = props;
  const tasks = req.phases.flatMap((p) => p.tasks);
  const rounds = fixRoundCount(req);
  const back = req.sentBack?.length ?? sentBack(req);
  const facts = [
    ...n_(tasks.length, "task"),
    ...n_(req.tally.helpers, "helper"),
    ...n_(req.tally.files, "file"),
    ...(rounds
      ? n_(rounds, "fix round")
      : n_(back, "sent back after review", "sent back after review")),
    ...n_(req.tally.commands, "command"),
  ];
  const from = source(req);
  return (
    <div className="of-rh">
      <div className="over">
        {/* A kind Murmur guessed is not worth a chip: "yes" is no feature. */}
        {!req.kindInferred && (
          <span className="label-chip">{KIND[req.kind]}</span>
        )}
        <span className="num">
          Request {view.requests.indexOf(req) + 1} of {view.requests.length} ·
          asked {dayLabel(req.startedAt)}, {clock(req.startedAt)}
          {from && ` · ${from}`}
        </span>
      </div>
      <h1 className="ask live-title" title={cleanPrompt(req.prompt)}>
        {askOf(req)}
      </h1>
      {facts.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the facts
        <div className="asked" role="group" aria-label="Summary">
          {facts.map((f) => {
            const [num, ...rest] = f.split(" ");
            return (
              <span key={f}>
                <b className="num">{thousands(Number(num))}</b> {rest.join(" ")}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CHECK: Record<"pass" | "fail" | "untried", { mark: Mark; word: string }> =
  {
    pass: { mark: "done", word: "passed" },
    fail: { mark: "failed", word: "failed" },
    untried: { mark: "open", word: "not yet checked" },
  };

/** What the request's tasks checked, and how each check came out. */
function Checked({ request: req }: { request: RequestView }) {
  const checks = req.parts.flatMap((p) =>
    p.checks.map((c) => ({ ...c, key: `${p.id}:${c.check}` })),
  );
  if (!checks.length) return null;
  return (
    <section className="side-card of-checked" aria-label="Checked">
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

/** A close-up of one thing in the room. */
function CloseUp(props: PanelProps & { onOpenPart(partId: string): void }) {
  const { sessionId, view, events, request: req, open } = props;
  const [kind, id = ""] = open.split(/:(.*)/s);
  const running = props.state === "running";
  if (kind === "helper") {
    const a = view.requests.flatMap((r) => r.agents).find((x) => x.id === id);
    if (a)
      return (
        <HelperCloseUp
          view={view}
          agent={a}
          t={props.t}
          model={props.models.get(a.id)}
          floor={{ request: req, state: props.stands.state }}
          onOpenPart={props.onOpenPart}
        />
      );
  }
  if (kind === "task") {
    // A plan task's id, else a part's: one number and title, as the board gives them.
    const place = closeUpPlace(req, id);
    const task = place?.task;
    const part = place?.part;
    if (part)
      return (
        <PartDetail
          cwd={view.cwd}
          sessionId={sessionId}
          request={req}
          running={running}
          state={props.stands.state}
          task={task?.id}
          at={props.t}
          part={part}
          events={events}
        />
      );
    if (task)
      return (
        <section className="of-card">
          <p className="of-kicker">Task</p>
          <h2>{taskTitle(task)}</h2>
          <p className="muted">
            {WORD[workState(task.status, props.stands.state)]}.
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
              {w.said && (
                <p>
                  <span className="muted">Claude's last words: </span>
                  {w.said}
                </p>
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
          stopped
          end={props.stands.to}
          waiting={props.waiting}
          lastLooked={props.lastLooked}
        />
      </>
    );
  }
  if (kind === "terminal") return <Terminal {...props} />;
  if (kind === "claude") return <ClaudeSteps {...props} />;
  return (
    <p className="muted">
      This is not in the request yet.{" "}
      <a
        href={floorPath(sessionId, props.floorId, "story")}
        onClick={follow(floorPath(sessionId, props.floorId, "story"))}
      >
        Back to its story
      </a>
    </p>
  );
}

/** A helper at its desk: who briefed it for what, what it is on, and what it said back. */
function HelperCloseUp(props: {
  view: SessionView;
  agent: AgentView;
  t: string;
  model: string | undefined;
  /** The floor's request and its state: its helpers stand as it does. */
  floor: { request: RequestView; state: State };
  onOpenPart(partId: string): void;
}) {
  const { view, agent: a, t, model } = props;
  const req = view.requests.find((r) => r.agents.includes(a));
  const part = req ? helperPart(req, a) : undefined;
  // As the room seats it: one silent for an hour is not at work.
  const at = helperNow(
    a,
    t,
    req === props.floor.request ? props.floor.state : req && coreState(req),
  );
  const runningNow = at.state === "running";
  const took = duration(at.from, at.to);
  const verdict = verdictOf(a.report);

  return (
    <section className="of-card">
      <p className="of-kicker">
        {a.role && a.role !== "other" ? `Helper · ${ROLE[a.role]}` : "Helper"}
        {model && ` · ${model}`}
      </p>
      <h2>{a.description || "A helper"}</h2>
      <p className="of-chips">
        <span className={runningNow ? "of-chip now" : "of-chip done"}>
          {runningNow ? `${at.word} · ${took}` : `${at.word} · took ${took}`}
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
            className="of-link"
            onClick={() => props.onOpenPart(part)}
          >
            Open its task ›
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
          <h3>
            {a.report.interim
              ? "Its last word (no final report)"
              : "Its report"}
          </h3>
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
function Terminal(props: PanelProps) {
  const { request: req, view, mainLog, t } = props;
  const next = view.requests[view.requests.indexOf(req) + 1]?.startedAt;
  const runs = mainLog
    .filter(
      (e) =>
        e.k === "tool" &&
        (e.tool === "Bash" || e.tool === "Monitor") &&
        e.t >= req.startedAt &&
        // Live, the newest command shows at once; a replay stops at its moment.
        (props.following || e.t <= t) &&
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
              <span>{e.label ?? toolWords(e.tool ?? "Bash")}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No commands yet in this request.</p>
      )}
    </section>
  );
}

/** What a main-log entry did, in words. */
function stepWords(e: MainEntry): string {
  if (e.k === "prompt") return "Read your message";
  if (e.k === "report") return "Read a helper's report";
  if (e.k === "stop") return "Ended its turn";
  if (e.tool === "Agent")
    return `Briefed a helper: ${e.desc ?? e.label ?? ""}`.trim();
  if (e.tool === "SendMessage")
    return `Wrote to a helper: ${e.label ?? ""}`.trim();
  if (e.tool === "murmur:narrate")
    return `Noted on the board: ${e.label ?? ""}`.trim();
  if (e.tool === "murmur:map") return "Drew up the plan";
  // A file tool's label is the file alone: say what it did to it.
  const verb = {
    Read: "Read",
    Edit: "Edited",
    Write: "Wrote",
    MultiEdit: "Edited",
  }[e.tool ?? ""];
  if (verb && e.label) return `${verb} ${e.label}`;
  // A command's description is an order ("Find where X was used"): said as one it ran.
  if ((e.tool === "Bash" || e.tool === "Monitor") && e.label)
    return `Ran “${e.label}”`;
  return e.label ?? (e.tool ? toolWords(e.tool) : "A step");
}

/** Claude itself: each of its own steps on this request, newest first. */
function ClaudeSteps(props: PanelProps) {
  const { request: req, view, mainLog, t, following } = props;
  const next = view.requests[view.requests.indexOf(req) + 1]?.startedAt;
  const steps = mainLog
    .filter(
      (e) =>
        e.t >= req.startedAt &&
        (following || e.t <= t) &&
        (!next || e.t < next),
    )
    .reverse();
  return (
    <section className="of-card">
      <p className="of-kicker">Claude</p>
      <h2>What Claude did on this request</h2>
      {steps.length ? (
        <ol className="of-runs">
          {steps.slice(0, 80).map((e) => (
            <li key={`${e.t}|${e.k}|${e.tool ?? ""}|${e.label ?? ""}`}>
              <span className="of-when">{clock(e.t)}</span>
              <span>{stepWords(e)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing yet on this request.</p>
      )}
      {steps.length > 80 && (
        <p className="muted">And {steps.length - 80} earlier steps.</p>
      )}
    </section>
  );
}
