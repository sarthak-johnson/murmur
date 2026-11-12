/*
 * The flow of a request with no parts: a short line of steps instead of an empty board.
 * You asked, Claude looked, Claude did, Ended; only the steps that have something.
 */
import { cutWords, type FileTouch, type RequestView } from "@murmur/core";
import { StateMark } from "../marks";
import { cleanPrompt, type Mark } from "../session";

const many = (n: number, one: string, more = `${one}s`) =>
  n ? [`${n} ${n === 1 ? one : more}`] : [];
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
/** File names shown on the step; the rest are counted. */
const NAMES = 4;

const MARK: Partial<Record<NonNullable<RequestView["state"]>, Mark>> = {
  "left-open": "open",
  failed: "failed",
};

export function RequestSteps(props: { request: RequestView }) {
  const { request: r } = props;
  const a = r.activity;
  const looked = a
    ? [
        ...many(a.reads, "read"),
        ...many(a.searches, "search", "searches"),
        ...many(a.web, "web lookup"),
      ]
    : [];
  const files = [
    ...new Map(
      [...r.parts.flatMap((p) => p.files), ...r.looseFiles].map(
        (f): [string, FileTouch] => [f.path, f],
      ),
    ).values(),
  ];
  const ran = [
    ...many(a?.commands ?? r.tally.commands, "command"),
    ...many(r.tally.helpers, "helper"),
  ];
  const going =
    r.state === "running" || r.state === "waiting" || (!r.state && !r.finished);
  const end = going
    ? r.waiting?.join(" ") || r.outcome || "Still working."
    : r.outcome || "Claude wrote no reply.";
  const mark: Mark = going
    ? r.state === "waiting"
      ? "waiting"
      : "running"
    : (MARK[r.state ?? "done"] ?? "done");

  return (
    <section className="flow rs" aria-label="Flow">
      <ol className="rs-steps">
        <li className="rs-step">
          <span className="rs-k">You asked</span>
          <q className="rs-q">{cutWords(cleanPrompt(r.prompt), 280)}</q>
        </li>
        {looked.length > 0 && (
          <li className="rs-step">
            <span className="rs-k">Claude looked</span>
            <span className="rs-t num">{looked.join(" · ")}</span>
          </li>
        )}
        {(files.length > 0 || ran.length > 0) && (
          <li className="rs-step">
            <span className="rs-k">Claude did</span>
            {files.length > 0 && (
              <span className="rs-t">
                Changed{" "}
                {files.length === 1 ? "1 file" : `${files.length} files`}
                <span className="rs-files">
                  {files.slice(0, NAMES).map((f) => (
                    <code key={f.path} className="rs-file" title={f.path}>
                      {base(f.path)}
                    </code>
                  ))}
                  {files.length > NAMES && (
                    <span className="rs-more">
                      and {files.length - NAMES} more
                    </span>
                  )}
                </span>
              </span>
            )}
            {ran.map((t) => (
              <span key={t} className="rs-t">
                {t.endsWith("helper") || t.endsWith("helpers")
                  ? `Started ${t}`
                  : `Ran ${t}`}
              </span>
            ))}
          </li>
        )}
        <li className={`rs-step rs-end ${mark}`}>
          <span className="rs-k">
            <StateMark mark={mark} />
            {going ? "Now" : "Ended"}
          </span>
          <span className="rs-t">{end}</span>
        </li>
      </ol>
    </section>
  );
}
