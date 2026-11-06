import type { RequestView } from "@murmur/core";
import { ago } from "../format";

const MINUS = "−";

const cut = (s: string, n: number) => {
  const cp = [...s];
  return cp.length > n ? `${cp.slice(0, n).join("").trimEnd()}…` : s;
};

export function NowCard({ request }: { request: RequestView }) {
  const { now, agents, parts, looseFiles } = request;
  const running = agents
    .map((a, i) => ({ a, k: i + 1 }))
    .filter(({ a }) => a.status === "running");
  return (
    <section
      className={running.length ? "now-col has-helpers" : "now-col"}
      aria-label="Now"
    >
      <div className="now-card">
        <div className="lbl lbl-now">
          Now
          {now?.inferred && <span className="inferred">inferred</span>}
        </div>
        {now ? (
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
          <ul aria-label="Files touched">
            {looseFiles.map((f) => (
              <li key={f.path}>
                <span className="pd-path">{f.path}</span>
                <span className={f.added ? "pd-add" : "pd-add zero"}>
                  +{f.added}
                </span>
                <span className={f.removed ? "pd-del" : "pd-del zero"}>
                  {MINUS}
                  {f.removed}
                </span>
                {f.role && <span className="muted">{f.role}</span>}
              </li>
            ))}
          </ul>
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
                    <b>Agent {k}</b> · {a.description}
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
