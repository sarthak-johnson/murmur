import type {
  AgentView,
  FileTouch,
  MurmurEvent,
  RequestView,
} from "@murmur/core";
import { requestFiles } from "../fileIndex";
import { FileList, PathText } from "../files";
import { StateMark } from "../marks";
import { Pill } from "../Pill";
import { follow, helperPath } from "../router";
import { helperName, modelOf, taskTitle } from "../session";
import { coreState, helperNow, type State } from "../state";
import {
  clock,
  duration,
  helperLine,
  nOf,
  thousands,
  verdictOf,
} from "../story";

const MINUS = "−";

/** One changed file: its readable path, lines added and removed, and its role. */
export function fileRow(cwd: string) {
  return (f: FileTouch) => (
    <li key={f.path}>
      <PathText path={f.path} cwd={cwd} />
      <span className={f.added ? "pd-add" : "pd-add zero"}>+{f.added}</span>
      <span className={f.removed ? "pd-del" : "pd-del zero"}>
        {MINUS}
        {f.removed}
      </span>
      {f.role && <span className="muted">{f.role}</span>}
    </li>
  );
}

/** The request's files, grouped by the part that changed them, then the rest. */
export function FilesTab(props: {
  request: RequestView;
  events: MurmurEvent[];
  cwd: string;
}) {
  const { request, events, cwd } = props;
  const groups = [
    ...request.parts
      .filter((p) => p.files.length > 0)
      .map((p) => ({ key: p.id, title: taskTitle(p), files: p.files })),
    ...(request.looseFiles.length
      ? [{ key: "", title: "Outside any task", files: request.looseFiles }]
      : []),
  ];
  if (!groups.length)
    return <p className="tab-empty">No files changed in this request yet.</p>;
  // A file several tasks changed shows under each, and counts once in the total.
  const all = requestFiles(request);
  const shared = new Set(
    all.filter((f) => f.changes.length > 1).map((f) => f.path),
  );
  const added = all.reduce((n, f) => n + f.added, 0);
  const removed = all.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="tab-files">
      <p className="files-total num">
        {nOf(all.length, "file")} changed, +{thousands(added)} {MINUS}
        {thousands(removed)}
        {shared.size > 0 &&
          ` · ${nOf(shared.size, "file")} changed by more than one task`}
      </p>
      {groups.map((g) => {
        const also = g.files.filter((f) => shared.has(f.path)).length;
        return (
          <section key={g.key} className="file-group" aria-label={g.title}>
            <div className="sect">
              <h2>{g.title}</h2>
              <span className="num">
                {nOf(g.files.length, "file")}
                {also > 0 && `, ${also} also under another task`}
              </span>
            </div>
            <FileList
              files={g.files}
              events={events}
              label={g.title}
              className="loose-files"
              row={fileRow(cwd)}
            />
          </section>
        );
      })}
    </div>
  );
}

/** The part a helper worked on: its own, else the task that lists it. */
export function helperPart(req: RequestView, a: AgentView): string | undefined {
  return (
    a.part ??
    req.phases.flatMap((p) => p.tasks).find((t) => t.agents.includes(a.id))
      ?.part
  );
}

/** Every helper of the request in one list, each linking to its task's page. */
export function HelpersTab(props: {
  sessionId: string;
  request: RequestView;
  events: MurmurEvent[];
  /** The time shown (a replay's moment), for how long running helpers have been at it. */
  now?: string;
  /** The request's state at that moment (state.ts): its helpers stand as it does. */
  state?: State | undefined;
}) {
  const { sessionId, request, events } = props;
  const now = props.now ?? new Date().toISOString();
  const reqState = props.state ?? coreState(request);
  if (!request.agents.length)
    return <p className="tab-empty">No helpers ran in this request.</p>;
  return (
    <ol className="helpers" aria-label="Helpers">
      {request.agents.map((a, i) => {
        // As the room seats it: one silent for an hour is not at work.
        const h = helperNow(a, now, reqState);
        const mark = h.mark;
        const word = h.state === "failed" ? "Stopped" : h.word;
        const model = modelOf(a, events);
        const verdict = verdictOf(a.report);
        const path = helperPath(sessionId, request.id, a.id);
        const time = duration(h.from, h.to);
        const line = helperLine(a, h.state === "running", request);
        // Its one name, as its desk says it; its brief's own words under it.
        const name = helperName(a);
        const said = a.description.trim();
        const body = (
          <>
            <StateMark mark={mark} />
            <span className="h-main">
              <span className="h-name">{name}</span>
              <span className="h-meta">
                <span>{said && said !== name ? said : `Agent ${i + 1}`}</span>
                {model && <span>{model}</span>}
                <span>{word}</span>
                <span className="num">
                  {clock(a.startedAt)},{" "}
                  {time === "under a minute" ? "<1 m" : time}
                </span>
              </span>
              {line && <span className="h-line">{line}</span>}
            </span>
            {/* A verdict that only repeats the state word is not said twice. */}
            {verdict && verdict.label !== word && (
              <Pill tone={verdict.tone}>{verdict.label}</Pill>
            )}
          </>
        );
        return (
          <li key={a.id}>
            <a className="helper" href={path} onClick={follow(path)}>
              {body}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
