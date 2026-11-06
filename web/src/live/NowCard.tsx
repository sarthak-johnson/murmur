import type { RequestView } from "@murmur/core";
import { ago } from "../format";

const cut = (s: string, n: number) => {
  const cp = [...s];
  return cp.length > n ? `${cp.slice(0, n).join("").trimEnd()}…` : s;
};

export function NowCard({ request }: { request: RequestView }) {
  const { now, agents, parts } = request;
  const running = agents
    .map((a, i) => ({ a, k: i + 1 }))
    .filter(({ a }) => a.status === "running");
  return (
    <section className="now-col" aria-label="Now">
      <div className="now-card">
        <div className="lbl lbl-now">Now</div>
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
      {running.length > 0 && (
        <>
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
        </>
      )}
      <p className="started">
        <b>Started from:</b> "{cut(request.prompt, 120)}" ·{" "}
        {ago(request.startedAt)}
      </p>
    </section>
  );
}
