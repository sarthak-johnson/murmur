import type {
  FileTouch,
  MurmurEvent,
  PartView,
  RequestView,
} from "@murmur/core";
import { useState } from "react";
import { FileList, PathText } from "../files";
import { MapView } from "../map/MapView";
import { LiveSkeleton } from "../pages/Session";
import { navigate } from "../router";
import { useSession } from "../useSession";

const enc = encodeURIComponent;
const MINUS = "−";

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface DiffLine {
  kind: "head" | "add" | "del" | "ctx";
  text: string;
}

/** Diff lines for one file, built from its events' structuredPatch. */
function diffOf(file: FileTouch, byId: Map<string, MurmurEvent>): DiffLine[] {
  const out: DiffLine[] = [];
  for (const id of file.eventIds) {
    const resp = byId.get(id)?.payload.tool_response as
      | { type?: string; content?: string; structuredPatch?: Hunk[] }
      | undefined;
    const hunks = resp?.structuredPatch ?? [];
    if (hunks.length === 0 && resp?.type === "create" && resp.content) {
      for (const l of resp.content.split("\n"))
        out.push({ kind: "add", text: `+${l}` });
      continue;
    }
    for (const h of hunks) {
      out.push({
        kind: "head",
        text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      });
      for (const l of h.lines)
        out.push({
          kind: l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx",
          text: l,
        });
    }
  }
  return out;
}

const STATUS = {
  now: ["in progress", "now"],
  done: ["done", "done"],
  todo: ["not started", ""],
} as const;

function Step(props: {
  n: number;
  step: PartView["steps"][number];
  byId: Map<string, MurmurEvent>;
}) {
  const { n, step, byId } = props;
  const [open, setOpen] = useState(false);
  return (
    <li className="pd-step" aria-label={`step ${n}`}>
      <span className={`sdot ${step.status}`} aria-hidden="true" />
      <span className="pd-step-text">{step.text}</span>
      {step.eventIds.length > 0 && (
        <button
          type="button"
          className="link pd-raw"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          raw ›
        </button>
      )}
      {open && (
        <pre className="pd-code pd-raw-panel">
          {JSON.stringify(
            step.eventIds.map((id) => byId.get(id) ?? { id }),
            null,
            2,
          )}
        </pre>
      )}
    </li>
  );
}

const described = (p: PartView) =>
  !!(p.aim || p.io) ||
  [p.steps, p.files, p.choices, p.checks, p.words].some((l) => l.length > 0);

function FileRow(props: {
  file: FileTouch;
  cwd: string;
  byId: Map<string, MurmurEvent>;
}) {
  const { file, cwd, byId } = props;
  const [open, setOpen] = useState(false);
  return (
    <li>
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
      {open && (
        <pre className="pd-code pd-diff">
          {diffOf(file, byId).map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <div key={i} className={`dl ${l.kind}`}>
              {l.text}
            </div>
          ))}
        </pre>
      )}
    </li>
  );
}

/** Keyed by part, so open raw and diff panels never carry over to another part. */
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
  const [label, tone] =
    part.failures >= 3 ? (["stuck", "bad"] as const) : STATUS[part.status];
  const agents = part.agents.flatMap((id) => {
    const k = request.agents.findIndex((a) => a.id === id);
    const a = request.agents[k];
    return a ? [{ k: k + 1, a }] : [];
  });

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
        <span className={`pd-pill ${tone}`}>{label}</span>
        {problem && <span className="pd-pill bad">{problem}</span>}
        <button type="button" className="link pd-back" onClick={onBack}>
          ‹ back to whole map
        </button>
      </div>
      <div className="pd-cols">
        <div className="pd-centre">
          <h1 className="pd-title">
            {part.title}
            {request.planInferred && <span className="inferred">inferred</span>}
          </h1>
          {!described(part) && (
            <p className="muted">Claude has not described this part yet.</p>
          )}
          {part.aim && (
            <div className="pd-aim">
              <div>
                <b>Aim:</b> <span>{part.aim.aim}</span>
              </div>
              <div className="muted">Done when {part.aim.doneWhen}</div>
            </div>
          )}
          {part.steps.length > 0 && (
            <section>
              <h2 className="lbl">What it did, in order</h2>
              <ol className="pd-list">
                {part.steps.map((s, i) => (
                  <Step
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only
                    key={i}
                    n={i + 1}
                    step={s}
                    byId={byId}
                  />
                ))}
              </ol>
            </section>
          )}
          {part.files.length > 0 && (
            <section>
              <h2 className="lbl">Files touched · {part.files.length}</h2>
              <FileList
                files={part.files}
                events={events}
                className="pd-list"
                row={(f) => (
                  <FileRow key={f.path} file={f} cwd={cwd} byId={byId} />
                )}
              />
            </section>
          )}
          {part.choices.length > 0 && (
            <section>
              <h2 className="lbl">Choices it made</h2>
              <ul className="pd-list">
                {part.choices.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <li key={i}>
                    <b>{c.choice}</b> <span className="muted">{c.reason}</span>
                    {c.assumption && (
                      <div className="pd-assume">
                        Claude's assumption. You never said this.
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="pd-left">
          <div className="map-box">
            <MapView
              request={request}
              highlight={{ partId: part.id }}
              onOpenPart={(id) => navigate(`${base}/p/${enc(id)}`)}
            />
          </div>
          {part.io && (
            <section>
              <h2 className="lbl">What goes in and out</h2>
              <p>
                <b>Gets:</b> {part.io.gets}
              </p>
              <p>
                <b>Gives:</b> {part.io.gives}
              </p>
            </section>
          )}
          {agents.length > 0 && (
            <section>
              <h2 className="lbl">Who's on it</h2>
              {agents.map(({ k, a }) => (
                <div key={a.id} className="pd-agent">
                  <div>
                    Agent {k}
                    {a.description && ` · ${a.description}`}
                  </div>
                  <details>
                    <summary>See the brief</summary>
                    <pre className="pd-code pd-brief">{a.prompt}</pre>
                  </details>
                </div>
              ))}
            </section>
          )}
        </aside>
        <aside className="pd-right">
          {part.checks.length > 0 && (
            <section>
              <h2 className="lbl">Checked so far</h2>
              <ul className="pd-list">
                {part.checks.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <li key={i} className={`pd-check ${c.status}`}>
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
            </section>
          )}
          {part.words.length > 0 && (
            <section>
              <h2 className="lbl">Words used here</h2>
              <ul className="pd-list">
                {part.words.map((w) => (
                  <li key={w.term}>
                    <b>{w.term}</b> <span className="muted">{w.meaning}</span>
                  </li>
                ))}
              </ul>
            </section>
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
          ‹ back to whole map
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
