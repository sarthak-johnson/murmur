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
import { Glyph, PlanSource } from "../live/PlanColumn";
import { Fold, inline, Markdown } from "../markdown";
import { Pill } from "../Pill";
import { helperKind, rounds as roundsWord, shortTitle } from "../session";
import {
  aboutWork,
  clock,
  commitsIn,
  concernsIn,
  fixRounds,
  partAgents,
  recapRounds,
  reportLine,
  type Tone,
  verdictOf,
} from "../story";
import { DiffView, hunksOf } from "./Diff";
import { EventData, EventView } from "./EventView";
import { helperLanes, Timeline } from "./Timeline";

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
  result?: Tone | undefined;
}) {
  const { n, step, request, agent, events, byId, cwd } = props;
  const { timed = true, fallback, label = `step ${n}`, lead } = props;
  const { details = true, result } = props;
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
    ? request.messages?.find((m) => m.agent === agent.id)?.text
    : undefined;
  // Never the prompt: Claude's word, else the report's, else a brief about the work.
  const text = said || reportLine(report) || aboutWork(fallback) || "";
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
      <span
        className={`sdot ${step.status}`}
        data-tone={result && result !== "plain" ? result : verdict?.tone}
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="step-hd">
        <span className="step-title">{step.text}</span>
        {who && <span className="step-who">{who}</span>}
        {verdict && <Pill tone={verdict.tone}>{verdict.label}</Pill>}
      </div>
      {lead && <p className="step-lead">{lead}</p>}
      {text && <Fold text={text} className="step-text" />}
      <div className="step-acts">
        {report && toggle("report", "Helper's full report")}
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
  request: RequestView;
  part: PartView;
  events: MurmurEvent[];
}) {
  const { cwd = "", request, part, events } = props;
  const byId = new Map(events.map((e) => [e.id, e]));
  const problem = request.phases
    .flatMap((p) => p.tasks)
    .find((t) => t.part === part.id && t.problem)?.problem;
  const helpers = partAgents(request, part);
  const lanes = helperLanes(part, helpers, events);
  const judged = new Map(
    lanes.map((l) => {
      const tone = l.runs.at(-1)?.tone;
      return [l.a.id, tone === "good" ? ("done" as const) : tone];
    }),
  );
  const rounds = fixRounds(part, helpers);
  const [label, tone]: [string, Tone] =
    part.failures >= 3
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
  const times = [
    ...(request.recap ? [] : part.steps.map((s) => s.ts)),
    ...helpers.flatMap((a) => [a.startedAt, a.endedAt, a.report?.ts]),
    // A helper sent back works on past its first stop.
    ...lanes.flatMap((l) => l.runs.flatMap((r) => (r.running ? [] : [r.to]))),
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
  const commits = commitsIn(reports.map((r) => r.text));
  const added = part.files.reduce((n, f) => n + f.added, 0);
  const removed = part.files.reduce((n, f) => n + f.removed, 0);
  const facts: ReactNode[] = [
    ...(span
      ? [
          <span key="t" className="fact num">
            <b>{span}</b>
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
  const briefed = helpers.find((a) => aboutWork(a.brief));
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
    if (st.agentId && !named.has(st.agentId)) named.set(st.agentId, st.text);
  const recapped =
    request.recap && (part.steps.length > 0 || others.length > 0);
  const how = recapped || part.steps.length > 0;
  const margin =
    concerns.length > 0 ||
    assumed.length > 0 ||
    part.checks.length > 0 ||
    part.words.length > 0 ||
    !!part.io;

  return (
    <div className="pd">
      {/* Where the task sits; the way back is the breadcrumb in the top bar. */}
      {(task || phase) && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around two chips
        <div className="pd-over" role="group" aria-label="Where it sits">
          {task && (
            <span className="label-chip">
              Task {tasks.indexOf(task) + 1} of {tasks.length}
            </span>
          )}
          {phase && <span className="label-chip">{phase.title}</span>}
        </div>
      )}
      <header className="tt">
        <h1 className="pd-title">
          {shortTitle(part.title)}
          <PlanSource request={request} />
        </h1>
        <span className={`verdict ${tone}`}>
          <Glyph
            status={
              tone === "bad"
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
      {purpose && (
        <section className="deck" aria-label="What it was for">
          <p className="deck-text">
            {inline(purpose.text)}{" "}
            <span className="source">{purpose.source}</span>
          </p>
          {purpose.doneWhen && (
            <p className="done-when">
              <span className="lbl-inline">Done when</span> {purpose.doneWhen}
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
      {!described && (
        <p className="muted">Claude has not described this part yet.</p>
      )}
      {timeline && (
        <div className="how">
          <h2 className="hh">How it went</h2>
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
                {recapRounds(part.steps, others).map(({ step, helper }, i) =>
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
                    {part.steps.map((s, i) => (
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
          {chosen.length > 0 && (
            <Section name="Choices it made">
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
        </div>
        {margin && (
          <aside className="margin">
            {(concerns.length > 0 || assumed.length > 0) && (
              <Section name="Left open" small>
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
    if (TEST.test(f.path)) tests.push(f);
    else if (f.role) add(f.role, f);
    else rest.push(f);
  const fresh = (fs: FileTouch[]) =>
    fs.every((f) => f.isNew) ? (fs.length > 1 ? "All new" : "New") : undefined;
  return [
    ...[...groups].map(([title, fs]) => ({ title, files: fs, why: undefined })),
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
