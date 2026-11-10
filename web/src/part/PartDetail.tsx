import type {
  AgentView,
  FileTouch,
  MurmurEvent,
  PartView,
  RequestView,
  StepView,
} from "@murmur/core";
import { type ReactNode, useState } from "react";
import { FileList, PathText, sharedFolder } from "../files";
import { NeedIcon } from "../live/TopBar";
import { Fold, inline, Markdown } from "../markdown";
import { Glyph, PlanSource } from "../marks";
import { Pill } from "../Pill";
import { follow, partPath, requestPath } from "../router";
import { helperKind, rounds as roundsWord, shortTitle } from "../session";
import {
  aboutWork,
  clock,
  commitsIn,
  concernsIn,
  duration,
  fixRounds,
  partAgents,
  recapRounds,
  reportLine,
  type Tone,
  verdictOf,
} from "../story";
import { DiffView, hunksOf } from "./Diff";
import { EventData, EventView } from "./EventView";
import { claudeSaid, helperLanes, MANY, Timeline } from "./Timeline";

const MINUS = "−";

const STATUS: Record<PartView["status"], [string, Tone]> = {
  now: ["In progress", "now"],
  done: ["Done", "done"],
  todo: ["Not started", "plain"],
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
  /** A note beside the heading. */
  note?: string | undefined;
  className?: string;
  /** The heading is drawn above, outside the section. */
  bare?: boolean;
  /** Margin sections use the smaller heading. */
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={props.className} aria-label={props.name}>
      {!props.bare && (
        <h2 className={props.small ? "mh" : "hh"}>
          {props.name}
          {props.count !== undefined && (
            <>
              {" "}
              <span className="lbl-count">{props.count}</span>
            </>
          )}
          {props.note && <span className="hh-note">{props.note}</span>}
        </h2>
      )}
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
  /** The recap's line for this round, shown above Claude's word. */
  lead?: string | undefined;
  /** A recap step's Details would only repeat its own title. */
  details?: boolean;
  /** How the helper's last run ended, as the timeline judged it. */
  result?: Judged | undefined;
  /** Claude's words to show on a step of its own (its closing message). */
  words?: string | undefined;
  /** The step that closed a done task: it carries the Done badge. */
  last?: boolean;
}) {
  const { n, step, request, agent, events, byId, cwd } = props;
  const { timed = true, fallback, label = `step ${n}`, words } = props;
  const { result, last } = props;
  const [open, setOpen] = useState<"report" | "brief" | "details" | null>(null);
  const call = step.eventIds.map((id) => byId.get(id)).find(Boolean);
  const helper = !!agent || call?.payload.tool_name === "Agent";
  const report = agent?.report;
  const verdict =
    (report && verdictOf(report)) ||
    (step.status === "failed"
      ? { label: "Failed", tone: "bad" as const }
      : step.status === "running" || agent?.status === "running"
        ? { label: "Running", tone: "now" as const }
        : result && (result.tone === "done" || result.tone === "bad")
          ? result
          : last
            ? { label: "Done", tone: "done" as const }
            : undefined);
  // A step drawn from one of Claude's messages shows the message, not its first line twice.
  const message = helper
    ? undefined
    : request.messages?.find((m) => m.id === step.eventIds[0]);
  // A message's own event is the message: its Details would only repeat it.
  const details = props.details !== false && !message;
  const said = agent
    ? request.messages?.find((m) => m.agent === agent.id)?.text
    : (message?.text ?? words);
  // Never the prompt: Claude's word, else the report's, else a brief about the work.
  const text = said || reportLine(report) || aboutWork(fallback) || "";
  const title = agent
    ? helperTitle(agent, request.agents.indexOf(agent) + 1)
    : helper
      ? step.text
      : "Claude";
  // The one-line fact: the plan's words for a helper's work, or Claude's own step.
  const lead = helper
    ? (props.lead ??
      (agent && !BARE.test(step.text) && step.text !== title
        ? step.text
        : undefined))
    : message
      ? undefined
      : step.text;
  const end = agent ? (agent.report?.ts ?? agent.endedAt) : undefined;
  const from = agent?.startedAt ?? step.ts;
  const when =
    !timed || !valid(from)
      ? ""
      : valid(end) && clock(end) !== clock(from)
        ? `${clock(from)} to ${clock(end)}`
        : clock(from);
  const who = [model(call), when].filter(Boolean).join(" · ");
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
      <span
        className={`sdot ${step.status}`}
        data-tone={
          result && result.tone !== "plain" ? result.tone : verdict?.tone
        }
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="step-hd">
        <span className="step-title">{title}</span>
        {who && <span className="step-who">{who}</span>}
        {verdict && <Pill tone={verdict.tone}>{verdict.label}</Pill>}
      </div>
      {lead && <p className="step-lead">{lead}</p>}
      {text && <Fold text={text} className="step-text" />}
      <div className="step-acts">
        {report && toggle("report", "Helper's report")}
        {helper && prompt && toggle("brief", "Brief")}
        {!helper &&
          details &&
          step.eventIds.length > 0 &&
          toggle("details", "Details")}
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
  strip: string;
  byId: Map<string, MurmurEvent>;
}) {
  const { file, cwd, strip, byId } = props;
  const [open, setOpen] = useState(false);
  return (
    <li className={open ? "file-row open" : "file-row"}>
      <button
        type="button"
        className="pd-file"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <PathText path={file.path} cwd={cwd} strip={strip} />
        <span className={file.added ? "pd-add" : "pd-add zero"}>
          +{file.added}
        </span>
        <span className={file.removed ? "pd-del" : "pd-del zero"}>
          {MINUS}
          {file.removed}
        </span>
        {file.isNew && <span className="pd-tag">new</span>}
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
  cwd?: string;
  /** For the links to the request, the flow board and the tasks either side. */
  sessionId?: string | undefined;
  /** The request's place in the session, for the way back. */
  requestNumber?: number | undefined;
  request: RequestView;
  part: PartView;
  events: MurmurEvent[];
}) {
  const { cwd = "", sessionId, requestNumber, request, part, events } = props;
  const byId = new Map(events.map((e) => [e.id, e]));
  const problem = request.phases
    .flatMap((p) => p.tasks)
    .find((t) => t.part === part.id && t.problem)?.problem;
  const helpers = partAgents(request, part);
  const lanes = helperLanes(part, helpers, events);
  const judged = new Map(
    lanes.flatMap((l) => {
      const run = l.runs.at(-1);
      if (!run) return [];
      const tone: Tone = run.tone === "good" ? "done" : run.tone;
      return [[l.a.id, { label: run.label, tone }] as const];
    }),
  );
  const rounds = part.rounds ?? fixRounds(part, helpers);
  const blocked = request.phases
    .flatMap((p) => p.tasks)
    .find((t) => t.part === part.id && t.status === "blocked");
  // A later prompt moved on from what it asked: the task was left, nothing waits now.
  const asking = !request.finished ? blocked : undefined;
  const [label, tone]: [string, Tone] = blocked
    ? [asking ? "Waiting on you" : "Left open", "plain"]
    : part.failures >= 3
      ? ["Stuck", "bad"]
      : part.status === "done" && rounds
        ? [`Done after ${roundsWord(rounds)}`, "done"]
        : STATUS[part.status];
  const tasks = request.phases.flatMap((p) => p.tasks);
  const task = tasks.find((t) => t.part === part.id);
  const phase = request.phases.find((p) => task && p.tasks.includes(task));
  const number = (a: AgentView) => request.agents.indexOf(a) + 1;
  const reports = helpers.flatMap((a) => (a.report ? [a.report] : []));

  // The band: time span, helpers, fix rounds, commits.
  const span = spanOf(part.span);
  const commits = commitsIn(reports.map((r) => r.text));
  const added = part.files.reduce((n, f) => n + f.added, 0);
  const removed = part.files.reduce((n, f) => n + f.removed, 0);
  const facts: ReactNode[] = [
    ...(span
      ? [
          <span key="t" className="fact num">
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
    ...(part.files.length
      ? [
          <span key="files" className="fact num">
            <b>{part.files.length}</b> {plural(part.files.length, "file")},{" "}
            <b className="pd-add">+{added}</b>{" "}
            <b className="pd-del">
              {MINUS}
              {removed}
            </b>
          </span>,
        ]
      : []),
    ...(commits.length
      ? [
          <span key="c" className="fact" title={commits.join(" ")}>
            {plural(commits.length, "commit")}
            {commits.slice(0, SHOWN).map((c) => (
              <span key={c}>
                {" "}
                <code className="hash">{c.slice(0, 9)}</code>
              </span>
            ))}
            {commits.length > SHOWN && ` and ${commits.length - SHOWN} more`}
          </span>,
        ]
      : []),
  ];

  // What it was for: the recap's or narration's aim, else the first helper's brief.
  const briefed = helpers.find((a) => aboutWork(a.brief));
  // Claude's own aim needs no source; one read from the record says where from.
  const purpose:
    | { text: string; doneWhen?: string; source?: string; ended?: boolean }
    | undefined = part.aim
    ? {
        text: part.aim.aim,
        doneWhen: part.aim.doneWhen,
        ...(part.aim.inferred
          ? { source: briefSource(part.aim.aim, request.agents), ended: true }
          : {}),
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

  /** A helper as a card: its name, model and start, verdict, word, report and brief. */
  const helperCard = (
    a: AgentView,
    n: number,
    label: string,
    lead?: string,
  ) => {
    const call = events.find(
      (e) =>
        e.hook === "PreToolUse" &&
        e.payload.tool_name === "Agent" &&
        (e.payload.tool_input as { prompt?: unknown } | undefined)?.prompt ===
          a.prompt,
    );
    return (
      <StepCard
        key={a.id}
        n={n}
        step={{
          ts: a.startedAt,
          text: helperTitle(a, number(a)),
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
        label={label}
        lead={lead}
        result={judged.get(a.id)}
      />
    );
  };

  const shared = sharedFolder(
    part.files.map((f) => f.path),
    cwd,
  );
  const groups = fileGroups(part.files);
  const timeline = helpers.length > 0;
  // The plan's words for each helper's work name its bar on the timeline.
  const named = new Map<string, string>();
  if (request.recap)
    for (const { step, helper } of recapRounds(part.steps, others))
      if (step && helper) named.set(helper.id, step.text);
  for (const st of part.steps)
    if (st.agentId && !named.has(st.agentId) && !BARE.test(st.text))
      named.set(st.agentId, st.text);
  const recapped =
    request.recap && (part.steps.length > 0 || others.length > 0);
  // A step drawn from a message a helper's card already shows would say it twice.
  const onCards = new Set(
    helpers.flatMap(
      (a) => request.messages?.find((m) => m.agent === a.id)?.id ?? [],
    ),
  );
  const steps = part.steps.filter(
    (s) => s.agentId || !onCards.has(s.eventIds[0] ?? ""),
  );
  const how = recapped || steps.length > 0;
  const margin =
    concerns.length > 0 ||
    assumed.length > 0 ||
    chosen.length > 0 ||
    part.checks.length > 0 ||
    part.words.length > 0 ||
    !!part.io;

  // The tasks either side, in the plan's order (else the map's), and the flow board.
  const order = [
    ...new Set(
      tasks.flatMap((t) =>
        t.part && request.parts.some((p) => p.id === t.part) ? [t.part] : [],
      ),
    ),
  ];
  const seq = order.includes(part.id) ? order : request.parts.map((p) => p.id);
  const here = seq.indexOf(part.id);
  const side = (id: string | undefined) => {
    const p = request.parts.find((x) => x.id === id);
    if (!p || !sessionId) return undefined;
    const t = tasks.find((x) => x.part === p.id);
    return {
      path: partPath(sessionId, request.id, p.id),
      text: `${t ? `Task ${tasks.indexOf(t) + 1} · ` : ""}${shortTitle(p.title)}${p.status === "now" ? " (running)" : ""}`,
    };
  };
  const prev = side(seq[here - 1]);
  const next = side(seq[here + 1]);
  const users = request.parts.filter(
    (p) => p.id !== part.id && p.links.some((l) => l.to === part.id),
  ).length;
  const uses = new Set(part.links.map((l) => l.to)).size;
  const flow = !sessionId
    ? undefined
    : users
      ? {
          text: `Flow: ${users} ${users === 1 ? "part uses" : "parts use"} this`,
          path: `${requestPath(sessionId, request.id, "flow")}?part=${encodeURIComponent(part.id)}`,
        }
      : uses
        ? {
            text: `Flow: uses ${uses} ${uses === 1 ? "part" : "parts"}`,
            path: `${requestPath(sessionId, request.id, "flow")}?part=${encodeURIComponent(part.id)}`,
          }
        : undefined;
  const back =
    sessionId && requestNumber ? requestPath(sessionId, request.id) : undefined;
  const link = (path: string, text: string, cls = "pd-btn") => (
    <a key={path} className={cls} href={path} onClick={follow(path)}>
      {text}
    </a>
  );
  const sides = (
    <span className="pd-nav-sides">
      {prev && link(prev.path, `← Previous: ${prev.text}`)}
      {next && link(next.path, `Next: ${next.text} →`)}
    </span>
  );
  // Claude's closing word on a done task, for its last step of its own when no card has it.
  const closingWords =
    part.status === "done"
      ? claudeSaid(request, part, helpers).findLast(
          (m) => !m.agent && !part.steps.some((s) => s.eventIds.includes(m.id)),
        )?.text
      : undefined;
  const closes = (i: number) =>
    part.status === "done" && i === steps.length - 1 && !steps[i]?.agentId;

  return (
    <div className="pd">
      {/* Where the task sits; the way back is the breadcrumb in the top bar. */}
      {(task || phase || request.recap || request.planInferred) && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around two chips
        <div className="pd-over" role="group" aria-label="Where it sits">
          {task && (
            <span className="label-chip">
              Task {tasks.indexOf(task) + 1} of {tasks.length}
            </span>
          )}
          {phase && <span className="label-chip">{phase.title}</span>}
          <PlanSource request={request} />
        </div>
      )}
      <header className="tt">
        <h1 className="pd-title">{shortTitle(part.title)}</h1>
        <span className={`verdict ${asking ? "need" : tone}`}>
          <Glyph
            status={
              asking
                ? "blocked"
                : tone === "bad"
                  ? "failed"
                  : tone === "plain"
                    ? "todo"
                    : part.status
            }
          />
          {label}
        </span>
        {problem && <Pill tone="bad">{problem}</Pill>}
      </header>
      {asking?.ask && (
        <section className="pd-ask" aria-label="Waiting on you">
          <h2 className="k">
            <NeedIcon />
            <span>
              Waiting on you{" "}
              <span className="num">· asked {clock(asking.ask.since)}</span>
            </span>
          </h2>
          <p>{asking.ask.text}</p>
          {asking.ask.message && sessionId && (
            <a
              href={`${requestPath(sessionId, request.id)}#m-${asking.ask.message}`}
              onClick={follow(
                `${requestPath(sessionId, request.id)}#m-${asking.ask.message}`,
              )}
            >
              Read Claude's message
            </a>
          )}
        </section>
      )}
      {purpose && (
        <section className="deck" aria-label="What it was for">
          <p className="deck-text">
            {inline(purpose.text)}
            {purpose.source && (
              <>
                {" "}
                <span className="source">{purpose.source}</span>
              </>
            )}
          </p>
          {purpose.doneWhen && (
            <p className="done-when">
              <span className="lbl-inline">Done when</span> {purpose.doneWhen}
              {purpose.ended && (
                <>
                  {" "}
                  <span className="source">read from how it ended</span>
                </>
              )}
            </p>
          )}
        </section>
      )}
      {facts.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the facts
        <div className="facts" role="group" aria-label="Summary">
          {facts}
        </div>
      )}
      {part.inferred && (
        <p className="pd-read">
          <Glyph status="todo" />
          Claude hasn't described this task itself. This page is read from its
          helpers, files and messages.
        </p>
      )}
      {!described && (
        <p className="muted">Claude has not described this part yet.</p>
      )}
      {(back || flow || prev || next) && (
        <nav className="pd-nav" aria-label="Tasks">
          {back && link(back, `← Request ${requestNumber}`)}
          {flow && link(flow.path, flow.text)}
          {sides}
        </nav>
      )}
      {timeline && (
        <div className="how">
          <h2 className="hh">
            How it went
            <span className="hh-note">
              one lane per {helpers.length > MANY ? "role" : "helper"}, Claude's
              messages at the bottom
            </span>
          </h2>
          <Timeline
            request={request}
            part={part}
            helpers={helpers}
            events={events}
            named={named}
          />
        </div>
      )}
      <div className={margin ? "split" : "split solo"}>
        <div className="split-main">
          {recapped ? (
            <Section name="How it went" bare={timeline}>
              <ol className="steps">
                {recapRounds(part.steps, others).map(
                  ({ step, helper }, i, all) =>
                    helper ? (
                      helperCard(helper, i + 1, `step ${i + 1}`, step?.text)
                    ) : step ? (
                      <StepCard
                        // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only
                        key={`s${i}`}
                        n={i + 1}
                        step={step}
                        request={request}
                        events={events}
                        byId={byId}
                        cwd={cwd}
                        timed={false}
                        details={false}
                        last={part.status === "done" && i === all.length - 1}
                        words={
                          part.status === "done" && i === all.length - 1
                            ? closingWords
                            : undefined
                        }
                      />
                    ) : null,
                )}
              </ol>
            </Section>
          ) : (
            <>
              {how && (
                <Section name="How it went" bare={timeline}>
                  <ol className="steps">
                    {steps.map((s, i) => (
                      <StepCard
                        // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only
                        key={i}
                        n={i + 1}
                        step={s}
                        request={request}
                        agent={helpers.find((a) => a.id === s.agentId)}
                        result={s.agentId ? judged.get(s.agentId) : undefined}
                        events={events}
                        byId={byId}
                        cwd={cwd}
                        last={closes(i)}
                        words={closes(i) ? closingWords : undefined}
                      />
                    ))}
                  </ol>
                </Section>
              )}
              {others.length > 0 && (
                <Section
                  name={
                    part.status === "done" ? "Who worked on it" : "Who's on it"
                  }
                >
                  <ol className="steps">
                    {others.map((a) =>
                      helperCard(a, number(a), `helper ${number(a)}`),
                    )}
                  </ol>
                </Section>
              )}
            </>
          )}
        </div>
        {margin && (
          <aside className="margin">
            {(concerns.length > 0 || assumed.length > 0) && (
              <Section
                name="Left open"
                small
                count={concerns.length + assumed.length}
              >
                <ul className="mn-list">
                  {concerns.map((c) => (
                    <li key={`c:${c}`} className="mn">
                      <Glyph status="todo" />
                      <span>{inline(c)}</span>
                    </li>
                  ))}
                  {assumed.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Claude may repeat a choice
                    <li key={`a:${i}`} className="mn">
                      <Glyph status="todo" />
                      <span>
                        <b>{c.choice}</b>{" "}
                        <span className="muted">{c.reason}</span>
                        <span className="pd-assume">
                          Claude's assumption. You never said this.
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {part.checks.length > 0 && (
              <Section name="Checked" small>
                <ul className="mn-list">
                  {part.checks.map((c) => (
                    <li key={c.check} className={`mn pd-check ${c.status}`}>
                      <Glyph
                        status={
                          c.status === "pass"
                            ? "done"
                            : c.status === "fail"
                              ? "failed"
                              : "todo"
                        }
                      />
                      <span>
                        {c.check}
                        <span className="sr-only">
                          {" "}
                          ({c.status === "untried" ? "not tried yet" : c.status}
                          )
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {chosen.length > 0 && (
              <Section name="Choices" small>
                <ul className="mn-list">
                  {chosen.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Claude may repeat a choice
                    <li key={i} className="mn plain">
                      <span>
                        <b>{c.choice}</b>{" "}
                        <span className="muted">{c.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {part.words.length > 0 && (
              <Section name="Words used here" small>
                <ul className="mn-list">
                  {part.words.map((w) => (
                    <li key={w.term} className="mn plain">
                      <span>
                        <b>{w.term}</b>{" "}
                        <span className="muted">{w.meaning}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {part.io && (
              <Section name="What goes in and out" small>
                <ul className="mn-list">
                  <li className="mn plain">
                    <span>
                      <b>Gets:</b> {part.io.gets}
                    </span>
                  </li>
                  <li className="mn plain">
                    <span>
                      <b>Gives:</b> {part.io.gives}
                    </span>
                  </li>
                </ul>
              </Section>
            )}
          </aside>
        )}
      </div>
      {part.files.length > 0 && (
        <Section
          name="Files, by what they do"
          count={part.files.length}
          note={shared ? `in ${shared}` : undefined}
          className="files"
        >
          <div className="fgrid">
            {groups.map((g) => (
              <div key={g.title} className="fcard">
                <h3>{g.title}</h3>
                {g.why && <p className="why">{g.why}</p>}
                <FileList
                  files={g.files}
                  events={events}
                  className="pd-files"
                  row={(f) => (
                    <FileRow
                      key={f.path}
                      file={f}
                      cwd={cwd}
                      strip={shared}
                      byId={byId}
                    />
                  )}
                />
              </div>
            ))}
          </div>
        </Section>
      )}
      {(prev || next) && (
        <nav className="pd-nav foot" aria-label="Tasks">
          {sides}
        </nav>
      )}
    </div>
  );
}

const TEST = /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[a-z]+$/i;

/** Files grouped by what they do: one card per role, tests on their own, the rest last. */
function fileGroups(files: FileTouch[]) {
  const groups = new Map<string, FileTouch[]>();
  const add = (k: string, f: FileTouch) =>
    groups.set(k, [...(groups.get(k) ?? []), f]);
  const tests: FileTouch[] = [];
  const rest: FileTouch[] = [];
  for (const f of files)
    if (TEST.test(f.path) || /^tests?\.?$/i.test(f.role ?? "")) tests.push(f);
    else if (f.role) add(roleTitle(f.role), f);
    else rest.push(f);
  const fresh = (fs: FileTouch[]) =>
    fs.every((f) => f.isNew) ? (fs.length > 1 ? "All new" : "New") : undefined;
  return [
    ...[...groups].map(([title, fs]) => ({
      title,
      files: fs,
      why: undefined,
    })),
    ...(tests.length
      ? [{ title: "Tests", files: tests, why: fresh(tests) }]
      : []),
    ...(rest.length
      ? [
          {
            title: groups.size || tests.length ? "Other files" : "Files",
            files: rest,
            why: undefined,
          },
        ]
      : []),
  ];
}

const DID = { build: "Built", review: "Reviewed", recheck: "Rechecked" };

/** "Built by Agent 1" when the helper's job is known, else its number and description. */
function helperTitle(a: AgentView, k: number): string {
  const kind = helperKind(a);
  if (kind)
    return `${/^fix\b/i.test(a.description) && kind === "build" ? "Fixed" : DID[kind]} by Agent ${k}`;
  return `Agent ${k}${a.description ? ` · ${a.description}` : ""}`;
}

/** A role as a card title: a capital first, no closing stop. */
function roleTitle(role: string): string {
  const t = role.trim().replace(/\.$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type Judged = { label: string; tone: Tone };

/** Commits named in the band; the rest are in its tooltip. */
const SHOWN = 3;

/** Step words that only restate a helper's role or verdict; its badge says them. */
const BARE =
  /^(?:built|reviewed|re-?reviewed|rechecked|sent back|fixed|passed)\.?$/i;

/** Where an aim read from the record came from: the brief of the helper that holds it. */
function briefSource(aim: string, helpers: AgentView[]): string {
  const core = aim.replace(/…$/, "").slice(1, 40).toLowerCase();
  const by = helpers.find((a) => a.brief?.toLowerCase().includes(core));
  const role = by && (by.role ?? helperKind(by));
  return role === "build" || role === "fix"
    ? "From the builder's brief"
    : role === "review" || role === "recheck"
      ? "From the reviewer's brief"
      : role === "plan"
        ? "From the planner's brief"
        : "From a helper's brief";
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** "15:38 to 15:44, 6 m"; with the day on both ends when it ran past midnight. */
function spanOf(span: PartView["span"]): ReactNode {
  if (!span || !valid(span.start)) return "";
  const { start, end } = span;
  if (!valid(end))
    return (
      <>
        since <b>{clock(start)}</b>
      </>
    );
  const multi = new Date(start).toDateString() !== new Date(end).toDateString();
  const when = (iso: string) =>
    multi ? `${DAY.format(new Date(iso))} ${clock(iso)}` : clock(iso);
  const [a, b] = [when(start), when(end)];
  return (
    <>
      <b>{a}</b>
      {a !== b && (
        <>
          {" "}
          to <b>{b}</b>
        </>
      )}
      , {duration(start, end)}
    </>
  );
}
