import { displayPath, type FileTouch, type MurmurEvent } from "@murmur/core";
import { Fragment, type ReactNode, useState } from "react";
import { eventsById } from "./format";

const SHOWN = 8;

/**
 * A path as a person reads it; the full path is its title. Breaks only after a `/`.
 * `strip` drops a folder already named around it (no trailing slash).
 */
export function PathText(props: { path: string; cwd: string; strip?: string }) {
  const { path, cwd, strip } = props;
  const full = path.startsWith("/") || !cwd ? path : `${cwd}/${path}`;
  const shown = displayPath(path, cwd);
  const parts = (
    strip && shown.startsWith(`${strip}/`)
      ? shown.slice(strip.length + 1)
      : shown
  ).split("/");
  return (
    <span className="pd-path" title={full}>
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments of one fixed path
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** Newest first by the latest event of each file; files with no known event keep their order. */
function newestFirst(files: FileTouch[], events: MurmurEvent[]) {
  const byId = eventsById(events);
  const last = (f: FileTouch) =>
    f.eventIds
      .map((id) => byId.get(id)?.ts ?? "")
      .sort()
      .at(-1) ?? "";
  return [...files].sort((a, b) => {
    const x = last(a);
    const y = last(b);
    return x > y ? -1 : x < y ? 1 : 0;
  });
}

/** A files-touched list: 8 newest first, then a "Show all N" toggle. */
export function FileList(props: {
  files: FileTouch[];
  events: MurmurEvent[];
  label?: string;
  className?: string;
  row(file: FileTouch): ReactNode;
}) {
  const { files, events, label, className, row } = props;
  const [all, setAll] = useState(false);
  const sorted = newestFirst(files, events);
  return (
    <>
      <ul aria-label={label} className={className}>
        {(all ? sorted : sorted.slice(0, SHOWN)).map(row)}
      </ul>
      {files.length > SHOWN && (
        <button
          type="button"
          className="link show-all"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${files.length}`}
        </button>
      )}
    </>
  );
}

/** The folder every path shares, as shown (no trailing slash), or "". */
export function sharedFolder(paths: string[], cwd: string): string {
  const dirs = paths.map((p) => displayPath(p, cwd).split("/").slice(0, -1));
  const first = dirs[0] ?? [];
  let n = 0;
  while (n < first.length && dirs.every((d) => d[n] === first[n])) n++;
  return first.slice(0, n).join("/");
}
