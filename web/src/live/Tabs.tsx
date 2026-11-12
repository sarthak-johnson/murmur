import type {
  AgentView,
  FileTouch,
  MurmurEvent,
  RequestView,
  SessionView,
} from "@murmur/core";
import { displayPath } from "@murmur/core";
import { useMemo, useState } from "react";
import { asTouch, fileIndex, requestFiles } from "../fileIndex";
import { FileList, PathText } from "../files";
import { StateMark } from "../marks";
import { Pill } from "../Pill";
import { DiffRow } from "../part/Diff";
import { floorPath, follow, helperPath } from "../router";
import { modelOf, placeOf, taskTitle } from "../session";
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

/** A task's name as the board and the Tasks tab give it: "Task 2 · Lit plate". */
const partName = (req: RequestView, partId: string, fallback: string) => {
  const place = placeOf(req, { part: partId });
  if (!place) return fallback;
  return place.task ? `Task ${place.n} · ${place.title}` : place.title;
};

/** Events by id, for diffs. */
const useById = (events: MurmurEvent[]) =>
  useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

/** The request's files, grouped by the part that changed them, then the rest. */
export function FilesTab(props: {
  request: RequestView;
  events: MurmurEvent[];
  cwd: string;
}) {
  const { request, events, cwd } = props;
  const byId = useById(events);
  const groups = [
    ...request.parts
      .filter((p) => p.files.length > 0)
      .map((p) => ({
        key: p.id,
        title: partName(request, p.id, taskTitle(p)),
        files: p.files,
      })),
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
              className="pd-files diff-files"
              row={(f) => (
                <DiffRow
                  key={f.path}
                  file={f}
                  cwd={cwd}
                  byId={byId}
                  note={f.role && <span className="muted">{f.role}</span>}
                />
              )}
            />
          </section>
        );
      })}
    </div>
  );
}

/** Shown before "Show all": a long session changes hundreds of files. */
const FILES_SHOWN = 40;

/**
 * Every file the session changed, each once: which requests and tasks changed it and by
 * how much, its whole diff a click away. It answers "which request changed this file".
 */
export function SessionFilesTab(props: {
  sessionId: string;
  view: SessionView;
  events: MurmurEvent[];
}) {
  const { sessionId, view, events } = props;
  const files = useMemo(() => fileIndex(view), [view]);
  const byId = useById(events);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  if (!files.length)
    return <p className="tab-empty">No files changed in this session yet.</p>;
  const find = q.trim().toLowerCase();
  const found = find
    ? files.filter((f) =>
        displayPath(f.path, view.cwd).toLowerCase().includes(find),
      )
    : files;
  const shown = all || find ? found : found.slice(0, FILES_SHOWN);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const several = files.filter((f) => f.requests.length > 1).length;
  return (
    <div className="tab-files sfiles">
      <p className="files-total num">
        {nOf(files.length, "file")} changed, +{thousands(added)} {MINUS}
        {thousands(removed)}
        {several > 0 &&
          ` · ${nOf(several, "file")} changed in more than one request`}
      </p>
      <input
        type="search"
        className="sfiles-find"
        placeholder="Find a file"
        aria-label="Find a file"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {find && (
        <p className="muted small" aria-live="polite">
          {nOf(found.length, "file")} match
        </p>
      )}
      <ul className="pd-files diff-files" aria-label="Every file">
        {shown.map((f) => (
          <DiffRow key={f.path} file={asTouch(f)} cwd={view.cwd} byId={byId}>
            <ul className="sfiles-by" aria-label="Changed in">
              {f.changes.map((c) => {
                const to = floorPath(sessionId, c.requestId, c.key ?? "files");
                return (
                  <li key={`${c.requestId}|${c.key ?? ""}`}>
                    <a href={to} onClick={follow(to)}>
                      Request {c.n}
                      {c.title ? ` · ${c.title}` : ""}
                    </a>{" "}
                    <span className="num muted">
                      +{c.added} {MINUS}
                      {c.removed}
                    </span>
                  </li>
                );
              })}
            </ul>
          </DiffRow>
        ))}
      </ul>
      {!find && found.length > FILES_SHOWN && (
        <button
          type="button"
          className="link show-all"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${found.length}`}
        </button>
      )}
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
