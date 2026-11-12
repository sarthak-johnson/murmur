import { useEffect, useState } from "react";
import { api, type SessionRow } from "../api";
import { ago } from "../format";
import { follow, sessionPath } from "../router";

const LIVE_MS = 2 * 60 * 1000;

function folder(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

/** What the list can tell of a session: live (an event in the last two minutes), quiet, or ended. */
function stateOf(s: SessionRow, now: number): "live" | "quiet" | "ended" {
  if (s.ended) return "ended";
  return now - new Date(s.lastEventAt).getTime() < LIVE_MS ? "live" : "quiet";
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function Sessions() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.sessions().then(
      (r) => setRows(r.sessions),
      () => setFailed(true),
    );
  }, []);

  if (failed)
    return (
      <main className="page">
        <p className="error" role="alert">
          Could not load sessions.
        </p>
      </main>
    );
  if (!rows)
    return (
      <main className="page" aria-busy="true">
        <h1>Sessions</h1>
        <ul className="lobby" aria-hidden="true">
          <li className="sk lobby-sk" />
          <li className="sk lobby-sk" />
          <li className="sk lobby-sk" />
        </ul>
        <p className="sr-only">Loading</p>
      </main>
    );
  if (rows.length === 0) {
    return (
      <main className="page">
        <h1>Sessions</h1>
        <p className="panel muted">
          No sessions yet. In Claude Code run{" "}
          <code>/plugin install murmur@murmur</code>, then{" "}
          <code>/murmur:login</code>.
        </p>
      </main>
    );
  }
  const now = Date.now();
  return (
    <main className="page">
      <h1>Sessions</h1>
      <ul className="lobby">
        {rows.map((s) => {
          const state = stateOf(s, now);
          const path = sessionPath(s.sessionId);
          return (
            <li key={s.sessionId}>
              <a
                className={`lobby-card ${state}`}
                href={path}
                onClick={follow(path)}
              >
                <span className="lobby-title">
                  {s.title || "Untitled session"}
                </span>
                <span className={`lobby-state ${state}`}>{state}</span>
                <span className="lobby-meta">
                  <span className="lobby-dir" title={s.cwd}>
                    {folder(s.cwd)}
                  </span>
                  <span>{s.machineName}</span>
                  <span>
                    started{" "}
                    <time dateTime={s.startedAt}>
                      {DAY.format(new Date(s.startedAt)).replace(",", "")}
                    </time>
                  </span>
                  <span>
                    last activity{" "}
                    <time dateTime={s.lastEventAt}>
                      {ago(s.lastEventAt, now)}
                    </time>
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
