import type { MurmurEvent, RequestView } from "@murmur/core";
import { FileList, PathText } from "../files";
import { ago } from "../format";

const MINUS = "−";

const cut = (s: string, n: number) => {
  const cp = [...s];
  return cp.length > n ? `${cp.slice(0, n).join("").trimEnd()}…` : s;
};

const count = (n: number, one: string, many: string) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

/** What a finished request did, in one line. */
function doneLine({ helpers, files, commands }: RequestView["tally"]) {
  const bits = [
    ...count(helpers, "helper", "helpers"),
    ...count(files, "file changed", "files changed"),
    ...count(commands, "command run", "commands run"),
  ];
  return bits.length ? bits.join(", ") : "Nothing changed";
}

export function NowCard(props: {
  request: RequestView;
  cwd?: string;
  events?: MurmurEvent[];
}) {
  const { request, cwd = "", events = [] } = props;
  const { now, agents, parts, looseFiles } = request;
  // A request Claude never mapped, once over, says what it did instead of a stale now.
  const done = request.planInferred && request.finished;
  const live = agents
    .map((a, i) => ({ a, k: i + 1 }))
    .filter(({ a }) => a.status === "running");
  const running = done ? [] : live;
  // A background helper can outlive its request; the map still shows it running.
  const doneLbl = [
    "Done",
    ...count(live.length, "helper still running", "helpers still running"),
  ].join(", ");
  return (
    <section
      className={running.length ? "now-col has-helpers" : "now-col"}
      aria-label="Now"
    >
      <div className={done ? "now-card done" : "now-card"}>
        <div className={done ? "lbl lbl-done" : "lbl lbl-now"}>
          {done ? doneLbl : "Now"}
          {(done || now?.inferred) && (
            <span className="inferred">inferred</span>
          )}
        </div>
        {done ? (
          <p className="now-text">{doneLine(request.tally)}</p>
        ) : now ? (
          <>
            <p className="now-text">{now.text}</p>
            {now.why && (
              <p className="now-why">
                <b>Why now:</b> {now.why}
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            Waiting for Claude to say what it is working on.
          </p>
        )}
      </div>
      {looseFiles.length > 0 && (
        <div className="now-files">
          <div className="lbl">Files touched</div>
          <FileList
            files={looseFiles}
            events={events}
            label="Files touched"
            row={(f) => (
              <li key={f.path}>
                <PathText path={f.path} cwd={cwd} />
                <span className={f.added ? "pd-add" : "pd-add zero"}>
                  +{f.added}
                </span>
                <span className={f.removed ? "pd-del" : "pd-del zero"}>
                  {MINUS}
                  {f.removed}
                </span>
                {f.role && <span className="muted">{f.role}</span>}
              </li>
            )}
          />
        </div>
      )}
      {running.length > 0 && (
        <div className="helpers-block">
          <div className="lbl">Helpers running</div>
          <ul className="helpers">
            {running.map(({ a, k }) => {
              const part = parts.find((p) => p.id === a.part)?.title;
              return (
                <li key={a.id} className="helper fade-in">
                  <div>
                    <b>Agent {k}</b>
                    {a.description && ` · ${a.description}`}
                  </div>
                  {part && <div className="muted">{part}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="started">
        <b>Started from:</b> "{cut(request.prompt, 120)}" ·{" "}
        {ago(request.startedAt)}
      </p>
    </section>
  );
}
