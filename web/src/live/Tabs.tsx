import type {
  AgentView,
  FileTouch,
  MurmurEvent,
  RequestView,
} from "@murmur/core";
import { FileList, PathText } from "../files";
import { Pill } from "../Pill";
import {
  follow,
  partPath,
  requestPath,
  type SessionTab,
  sessionPath,
  type Tab,
} from "../router";
import { modelOf, shortTitle } from "../session";
import { clock, duration, verdictOf } from "../story";
import { StateMark } from "./Rail";

const MINUS = "−";

const LABEL: Record<Tab, string> = {
  story: "Story",
  flow: "Flow",
  files: "Files",
  helpers: "Helpers",
};

/** Story · Flow · Files · Helpers: each a link with its own URL, so back and forward work. */
export function RequestTabs(props: {
  sessionId: string;
  requestId: string;
  tab: Tab;
}) {
  const { sessionId, requestId, tab } = props;
  return (
    <nav className="tabs" aria-label="Views of this request">
      {(Object.keys(LABEL) as Tab[]).map((t) => {
        const path = requestPath(sessionId, requestId, t);
        return (
          <a
            key={t}
            href={path}
            aria-current={t === tab ? "page" : undefined}
            onClick={follow(path)}
          >
            {LABEL[t]}
          </a>
        );
      })}
    </nav>
  );
}

/** Journey · Flow under the session's title, styled as the request's tabs. */
export function SessionTabs(props: { sessionId: string; tab: SessionTab }) {
  const { sessionId, tab } = props;
  const tabs: [SessionTab, string][] = [
    ["journey", "Journey"],
    ["flow", "Flow"],
  ];
  return (
    <nav className="tabs sess-tabs" aria-label="Views of this session">
      {tabs.map(([t, label]) => {
        const path = sessionPath(sessionId, t);
        return (
          <a
            key={t}
            href={path}
            aria-current={t === tab ? "page" : undefined}
            onClick={follow(path)}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}

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
      .map((p) => ({ key: p.id, title: shortTitle(p.title), files: p.files })),
    ...(request.looseFiles.length
      ? [{ key: "", title: "Outside any task", files: request.looseFiles }]
      : []),
  ];
  if (!groups.length)
    return <p className="tab-empty">No files changed in this request yet.</p>;
  return (
    <div className="tab-files">
      {groups.map((g) => (
        <section key={g.key} className="file-group" aria-label={g.title}>
          <div className="sect">
            <h2>{g.title}</h2>
            <span className="num">
              {g.files.length} {g.files.length === 1 ? "file" : "files"}
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
      ))}
    </div>
  );
}

/** The part a helper worked on: its own, else the task that lists it. */
function helperPart(req: RequestView, a: AgentView): string | undefined {
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
}) {
  const { sessionId, request, events } = props;
  const now = new Date().toISOString();
  if (!request.agents.length)
    return <p className="tab-empty">No helpers ran in this request.</p>;
  return (
    <ol className="helpers" aria-label="Helpers">
      {request.agents.map((a, i) => {
        const failed = /fail|kill/i.test(a.report?.status ?? "");
        const mark =
          a.status === "running" ? "running" : failed ? "failed" : "done";
        const word =
          a.status === "running" ? "Running" : failed ? "Stopped" : "Done";
        const model = modelOf(a, events);
        const verdict = verdictOf(a.report);
        const part = helperPart(request, a);
        const path = part ? partPath(sessionId, request.id, part) : undefined;
        const time = duration(a.startedAt, a.endedAt ?? a.report?.ts ?? now);
        const body = (
          <>
            <StateMark mark={mark} />
            <span className="h-main">
              <span className="h-name">
                {a.description || `Agent ${i + 1}`}
              </span>
              <span className="h-meta">
                <span>Agent {i + 1}</span>
                {model && <span>{model}</span>}
                <span>{word}</span>
                <span className="num">
                  {clock(a.startedAt)},{" "}
                  {time === "under a minute" ? "<1 m" : time}
                </span>
              </span>
            </span>
            {/* A verdict that only repeats the state word is not said twice. */}
            {verdict && verdict.label !== word && (
              <Pill tone={verdict.tone}>{verdict.label}</Pill>
            )}
          </>
        );
        return (
          <li key={a.id}>
            {path ? (
              <a className="helper" href={path} onClick={follow(path)}>
                {body}
              </a>
            ) : (
              <div className="helper">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
