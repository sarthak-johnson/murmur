/*
 * Files counted once. Core files each change under the part it belongs to (or the
 * request's loose files), so one path can sit under several tasks of a request and under
 * several requests; totals count it once and add its lines up.
 */
import type { FileTouch, RequestView, SessionView } from "@murmur/core";
import { placeOf, taskTitle } from "./session";

/** One request's (or task's) change to a file. */
export interface FileChange {
  requestId: string;
  /** The request's number in the session, 1-based. */
  n: number;
  /** The part it is under; unset for the request's loose files. */
  part?: string;
  /** What the panel opens it by (`Place.key`), and its title; unset when loose. */
  key?: string;
  title?: string;
  added: number;
  removed: number;
  isNew: boolean;
  /** The edit events, for its diff. */
  eventIds: string[];
}

export interface IndexedFile {
  path: string;
  /** Lines added and removed over every change. */
  added: number;
  removed: number;
  /** Some change created it. */
  isNew: boolean;
  changes: FileChange[];
  /** The requests that changed it, in session order, each once. */
  requests: string[];
}

function changesOf(req: RequestView, n: number): [string, FileChange][] {
  const own = (f: FileTouch) => ({
    added: f.added,
    removed: f.removed,
    isNew: f.isNew,
    eventIds: f.eventIds,
  });
  return [
    ...req.parts.flatMap((p) => {
      const place = placeOf(req, { part: p.id });
      return p.files.map((f): [string, FileChange] => [
        f.path,
        {
          requestId: req.id,
          n,
          part: p.id,
          key: place?.key ?? `task:${p.id}`,
          title: place?.title ?? taskTitle(p),
          ...own(f),
        },
      ]);
    }),
    ...req.looseFiles.map((f): [string, FileChange] => [
      f.path,
      { requestId: req.id, n, ...own(f) },
    ]),
  ];
}

function gather(changes: [string, FileChange][]): IndexedFile[] {
  const by = new Map<string, IndexedFile>();
  for (const [path, c] of changes) {
    const f = by.get(path) ?? {
      path,
      added: 0,
      removed: 0,
      isNew: false,
      changes: [],
      requests: [],
    };
    f.added += c.added;
    f.removed += c.removed;
    f.isNew ||= c.isNew;
    f.changes.push(c);
    if (!f.requests.includes(c.requestId)) f.requests.push(c.requestId);
    by.set(path, f);
  }
  return [...by.values()];
}

/** A request's files, each once, with the tasks that changed it. */
export function requestFiles(req: RequestView, n = 0): IndexedFile[] {
  return gather(changesOf(req, n));
}

/**
 * Every file the session changed, each once: which requests and tasks changed it and by
 * how much each time, most changed first (then by path).
 */
export function fileIndex(view: SessionView): IndexedFile[] {
  return gather(view.requests.flatMap((r, i) => changesOf(r, i + 1))).sort(
    (a, b) =>
      b.changes.length - a.changes.length || a.path.localeCompare(b.path),
  );
}
