import type {
  AgentView,
  FileTouch,
  MurmurEvent,
  PartView,
  RequestView,
  StepView,
} from "@murmur/core";
import { type ReactNode, useState } from "react";
import { FileList, PathText } from "../files";
import { PlanSource } from "../live/PlanPanel";
import { Fold, inline, Markdown } from "../markdown";
import { Pill } from "../Pill";
import { LiveSkeleton } from "../pages/Session";
import { navigate } from "../router";
import {
  clock,
  commitsIn,
  concernsIn,
  fixRounds,
  partAgents,
  reportLead,
  type Tone,
  verdictOf,
} from "../story";
import { useSession } from "../useSession";
import { DiffView, hunksOf } from "./Diff";
import { EventData, EventView } from "./EventView";

const enc = encodeURIComponent;
const MINUS = "−";

const STATUS: Record<PartView["status"], [string, Tone]> = {
  now: ["In progress", "now"],
  done: ["Done", "done"],
  todo: ["Not started", "plain"],
};

const DOT: Record<PartView["status"], string> = {
  now: "running",
  done: "done",
  todo: "",
};

const valid = (ts: string | undefined): ts is string =>
  !!ts && !Number.isNaN(Date.parse(ts));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n === 1 ? one : many}`;
const model = (e: MurmurEvent | undefined) => {
  const m = str(
    (e?.payload.tool_input as { model?: unknown } | undefined)?.model,
  );
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "";
};

function Section(props: {
  name: string;
  count?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={props.className} aria-label={props.name}>
      <h2 className="lbl">
        {props.name}
        {props.count !== undefined && (
          <>
            {" "}
            <span className="lbl-count">{props.count}</span>
          </>
        )}
      </h2>
      {props.children}
    </section>
  );
}

/** A step of the part: a helper's round (model, verdict, Claude's word, report) or a narrated step. */
function StepCard(props: {
  n: number;
  step: StepView;
  request: RequestView;
  agent?: AgentView | undefined;
  events: MurmurEvent[];
  byId: Map<string, MurmurEvent>;
  cwd: string;
  /** Recap steps carry made-up times, so they show none. */
  timed?: boolean;
  label?: string;
  /** Text to show when Claude said nothing and no report came. */
  fallback?: string | undefined;
}) {
  const { n, step, request, agent, events, byId, cwd } = props;
  const { timed = true, fallback, label = `step ${n}` } = props;
  const [open, setOpen] = useState<"report" | "brief" | "details" | null>(null);
  const call = step.eventIds.map((id) => byId.get(id)).find(Boolean);
  const helper = !!agent || call?.payload.tool_name === "Agent";
  const report = agent?.report;
  const verdict = report
    ? verdictOf(report)
    : step.status === "failed"
      ? { label: "Failed", tone: "bad" as const }
      : agent?.status === "running" || (helper && step.status === "running")
        ? { label: "Running", tone: "now" as const }
        : undefined;
  const said = agent
    ? request.messages?.findLast((m) => m.agent === agent.id)?.text
    : undefined;
  const text = said ?? (report ? reportLead(report.text) : (fallback ?? ""));
  const who = [model(call), timed && valid(step.ts) ? clock(step.ts) : ""]
    .filter(Boolean)
    .join(", ");
  const prompt =
    str(
      (call?.payload.tool_input as { prompt?: unknown } | undefined)?.prompt,
    ) || agent?.prompt;
  const toggle = (what: NonNullable<typeof open>, label: string) => (
    <button
      type="button"
      className="link step-act"
      aria-expanded={open === what}
      onClick={() => setOpen(open === what ? null : what)}
    >
      {label}
    </button>
  );
  return (
    <li
      className={helper ? "step-card helper" : "step-card"}
      aria-label={label}
    >
      <div className="step-hd">
        <span className={`sdot ${step.status}`} aria-hidden="true" />
        <span className="step-title">{step.text}</span>
        {who && <span className="step-who">{who}</span>}
        {verdict && <Pill tone={verdict.tone}>{verdict.label}</Pill>}
      </div>
      {text && <Fold text={text} className="step-text" />}
      <div className="step-acts">
        {report && toggle("report", "Helper's full report")}
        {helper && prompt && toggle("brief", "Brief")}
        {!helper && step.eventIds.length > 0 && toggle("details", "Details")}
      </div>
      {open === "report" && report && (
        <div className="report-panel">
          <Markdown text={report.text} className="reading" />
        </div>
      )}
      {open === "brief" && prompt && (
        <div className="report-panel">
          <Markdown text={prompt} className="reading" />
          {call && <EventData events={[call]} />}
        </div>
      )}
      {open === "details" && (
        <div className="report-panel details">
          {step.eventIds.map((id) => (
            <EventView
              key={id}
              eventId={id}
              events={events}
              cwd={cwd}
              agents={request.agents}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function FileRow(props: {
  file: FileTouch;
  cwd: string;
  byId: Map<string, MurmurEvent>;
}) {
  const { file, cwd, byId } = props;
  const [open, setOpen] = useState(false);
  return (
    <li className={open ? "file-row open" : "file-row"}>
      <button
        type="button"
        className="pd-file"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <PathText path={file.path} cwd={cwd} />
        <span className={file.added ? "pd-add" : "pd-add zero"}>
          +{file.added}
        </span>
        <span className={file.removed ? "pd-del" : "pd-del zero"}>
          {MINUS}
          {file.removed}
        </span>
        <span className="pd-tag">{file.isNew ? "new" : "edited"}</span>
        {file.role && <span className="muted">{file.role}</span>}
      </button>
      {open && <DiffView hunks={hunksOf(file, byId)} />}
    </li>
  );
}

/** Keyed by part, so open panels never carry over to another part. */
export function PartDetail(props: Parameters<typeof PartBody>[0]) {
  return <PartBody key={props.part.id} {...props} />;
}

function PartBody(props: {
  sessionId: string;
  cwd?: string;
  request: RequestView;
  part: PartView;
  events: MurmurEvent[];
  onBack(): void;
}) {
  const { sessionId, cwd = "", request, part, events, onBack } = props;
  const base = `/s/${enc(sessionId)}/r/${enc(request.id)}`;
  const byId = new Map(events.map((e) => [e.id, e]));
  const problem = request.phases
    .flatMap((p) => p.tasks)
    .find((t) => t.part === part.id && t.problem)?.problem;
  const [label, tone]: [string, Tone] =
    part.failures >= 3 ? ["Stuck", "bad"] : STATUS[part.status];
  const helpers = partAgents(request, part);
  const number = (a: AgentView) => request.agents.indexOf(a) + 1;
  const reports = helpers.flatMap((a) => (a.report ? [a.report] : []));

  // The band: time span, helpers, fix rounds, commits.
  const times = [
    ...(request.recap ? [] : part.steps.map((s) => s.ts)),
    ...helpers.flatMap((a) => [a.startedAt, a.endedAt, a.report?.ts]),
  ]
    .filter(valid)
    .sort();
  const from = times[0];
  const to = times.at(-1);
  const span =
    from && to
      ? clock(from) === clock(to)
        ? clock(from)
        : `${clock(from)} to ${clock(to)}`
      : "";
  const rounds = fixRounds(part);
  const commits = commitsIn(reports.map((r) => r.text));
  const facts: ReactNode[] = [
    ...(span
      ? [
          <span key="t" className="fact">
            {span}
          </span>,
        ]
      : []),
    ...(helpers.length
      ? [
          <span key="h" className="fact">
            <b>{helpers.length}</b> {plural(helpers.length, "helper")}
          </span>,
        ]
      : []),
    ...(rounds
      ? [
          <span key="f" className="fact">
            <b>{rounds}</b> {plural(rounds, "fix round")}
          </span>,
        ]
      : []),
    ...(commits.length
      ? [
          <span key="c" className="fact">
            {plural(commits.length, "commit")}{" "}
            {commits.map((c) => (
              <code key={c} className="hash" title={c}>
                {c.slice(0, 9)}
              </code>
            ))}
          </span>,
        ]
      : []),
  ];

  // What it was for: the recap's or narration's aim, else the first helper's brief.
  const briefed = helpers.find((a) => a.brief);
  const purpose = part.aim
    ? {
        text: part.aim.aim,
        doneWhen: part.aim.doneWhen,
        source: request.recap
          ? "From Claude's recap"
          : "From Claude's narration",
      }
    : briefed?.brief
      ? { text: briefed.brief, source: "From the helper's brief" }
      : undefined;

  const concerns = [...new Set(reports.flatMap((r) => concernsIn(r.text)))];
  const assumed = part.choices.filter((c) => c.assumption);
  const chosen = part.choices.filter((c) => !c.assumption);
  const carded = new Set(part.steps.map((s) => s.agentId));
  const others = helpers.filter((a) => !carded.has(a.id));
  const described =
    !!(part.aim || part.io || purpose) ||
    helpers.length > 0 ||
    [part.steps, part.files, part.choices, part.checks, part.words].some(
      (l) => l.length > 0,
    );

  return (
    <main className="pd">
      <div className="pd-bar">
        <nav className="pd-crumb" aria-label="Breadcrumb">
          <a
            href={base}
            onClick={(e) => {
              e.preventDefault();
              onBack();
            }}
          >
            {request.goal || request.prompt}
          </a>
          <span aria-hidden="true"> › </span>
          <span>{part.title}</span>
        </nav>
        <button type="button" className="link pd-back" onClick={onBack}>
          ‹ Back to the request
        </button>
      </div>
      <header className="pd-head">
        <h1 className="pd-title">
          {part.title}
          <PlanSource request={request} />
        </h1>
        <Pill tone={tone}>{label}</Pill>
        {problem && <Pill tone="bad">{problem}</Pill>}
      </header>
      {facts.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the facts
        <div className="band" role="group" aria-label="Summary">
          {facts}
        </div>
      )}
      {!described && (
        <p className="muted">Claude has not described this part yet.</p>
      )}
      <div className="pd-cols">
        <div className="pd-main">
          {purpose && (
            <Section name="What it was for" className="purpose">
              <p className="purpose-text">
                {purpose.text} <span className="source">{purpose.source}</span>
              </p>
              {purpose.doneWhen && (
                <p className="muted">Done when {purpose.doneWhen}</p>
              )}
            </Section>
          )}
          {part.steps.length > 0 && (
            <Section name="How it went">
              <ol className="steps">
                {part.steps.map((s, i) => (
                  <StepCard
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only
                    key={i}
                    n={i + 1}
                    step={s}
                    request={request}
                    agent={helpers.find((a) => a.id === s.agentId)}
                    events={events}
                    byId={byId}
                    cwd={cwd}
                    timed={!request.recap || !!s.agentId}
                  />
                ))}
              </ol>
            </Section>
          )}
          {others.length > 0 && (
            <Section name="Who's on it">
              <ol className="steps">
                {others.map((a) => {
                  const call = events.find(
                    (e) =>
                      e.hook === "PreToolUse" &&
                      e.payload.tool_name === "Agent" &&
                      (e.payload.tool_input as { prompt?: unknown } | undefined)
                        ?.prompt === a.prompt,
                  );
                  return (
                    <StepCard
                      key={a.id}
                      n={number(a)}
                      step={{
                        ts: a.startedAt,
                        text: `Agent ${number(a)}${a.description ? ` · ${a.description}` : ""}`,
                        status: a.status === "running" ? "running" : "done",
                        agentId: a.id,
                        eventIds: call ? [call.id] : [],
                      }}
                      request={request}
                      agent={a}
                      events={events}
                      byId={byId}
                      cwd={cwd}
                      fallback={a.brief}
                      label={`helper ${number(a)}`}
                    />
                  );
                })}
              </ol>
            </Section>
          )}
          {part.files.length > 0 && (
            <Section name="Files changed" count={part.files.length}>
              <FileList
                files={part.files}
                events={events}
                className="pd-files"
                row={(f) => (
                  <FileRow key={f.path} file={f} cwd={cwd} byId={byId} />
                )}
              />
            </Section>
          )}
          {chosen.length > 0 && (
            <Section name="Choices it made">
              <ul className="pd-list">
                {chosen.map((c) => (
                  <li key={c.choice}>
                    <b>{c.choice}</b> <span className="muted">{c.reason}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <aside className="pd-side">
          {(concerns.length > 0 || assumed.length > 0) && (
            <Section name="Left open">
              <ul className="open-list">
                {concerns.map((c) => (
                  <li key={c}>{inline(c)}</li>
                ))}
                {assumed.map((c) => (
                  <li key={c.choice}>
                    <b>{c.choice}</b> <span className="muted">{c.reason}</span>
                    <div className="pd-assume">
                      Claude's assumption. You never said this.
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {part.checks.length > 0 && (
            <Section name="Checked so far">
              <ul className="pd-list">
                {part.checks.map((c) => (
                  <li key={c.check} className={`pd-check ${c.status}`}>
                    <span aria-hidden="true">
                      {c.status === "pass"
                        ? "✓"
                        : c.status === "fail"
                          ? "✕"
                          : "○"}
                    </span>{" "}
                    {c.check}
                    <span className="sr-only">
                      {" "}
                      ({c.status === "untried" ? "not tried yet" : c.status})
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {part.words.length > 0 && (
            <Section name="Words used here">
              <ul className="pd-list">
                {part.words.map((w) => (
                  <li key={w.term}>
                    <b>{w.term}</b> <span className="muted">{w.meaning}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {part.io && (
            <Section name="What goes in and out">
              <p>
                <b>Gets:</b> {part.io.gets}
              </p>
              <p>
                <b>Gives:</b> {part.io.gives}
              </p>
            </Section>
          )}
          {request.parts.length > 1 && (
            <Section name="In this request">
              <ul className="siblings">
                {request.parts.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`${base}/p/${enc(p.id)}`}
                      className="sib"
                      aria-current={p.id === part.id ? "page" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`${base}/p/${enc(p.id)}`);
                      }}
                    >
                      <span
                        className={`sdot ${DOT[p.status]}`}
                        aria-hidden="true"
                      />
                      <span className="sib-title">{p.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>
    </main>
  );
}

/** Route wrapper: loads the session, finds the part, falls back politely. */
export function PartPage(props: {
  sessionId: string;
  requestId: string;
  partId: string;
}) {
  const { sessionId, requestId, partId } = props;
  const { view, events, status } = useSession(sessionId);
  if (!view) return <LiveSkeleton status={status} />;
  const back = () => navigate(`/s/${enc(sessionId)}/r/${enc(requestId)}`);
  const request = view.requests.find((r) => r.id === requestId);
  const part = request?.parts.find((p) => p.id === partId);
  if (!request || !part)
    return (
      <main className="pd">
        <p>This part is not in the map yet.</p>
        <button type="button" className="link" onClick={back}>
          ‹ Back to the request
        </button>
      </main>
    );
  return (
    <PartDetail
      sessionId={sessionId}
      cwd={view.cwd}
      request={request}
      part={part}
      events={events}
      onBack={back}
    />
  );
}
