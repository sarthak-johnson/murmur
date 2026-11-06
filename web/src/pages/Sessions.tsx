import { useEffect, useState } from "react";
import { api, type SessionRow } from "../api";
import { ago } from "../format";
import { navigate } from "../router";

const LIVE_MS = 2 * 60 * 1000;

function folder(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

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
      <main className="page">
        <p className="muted">Loading</p>
      </main>
    );
  if (rows.length === 0) {
    return (
      <main className="page">
        <p className="muted">
          No sessions yet. In Claude Code run /plugin install murmur@murmur,
          then /murmur:login.
        </p>
      </main>
    );
  }
  const now = Date.now();
  return (
    <main className="page">
      <h1>Sessions</h1>
      <ul className="rows">
        {rows.map((s) => {
          const live =
            !s.ended && now - new Date(s.lastEventAt).getTime() < LIVE_MS;
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                className="row"
                onClick={() =>
                  navigate(`/s/${encodeURIComponent(s.sessionId)}`)
                }
              >
                <div className="title">{s.title || "Untitled session"}</div>
                <div className="meta">
                  <span title={s.cwd}>{folder(s.cwd)}</span>
                  <span>{s.machineName}</span>
                  <span>{ago(s.lastEventAt, now)}</span>
                  {live && <span className="live">live</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
