import { useEffect, useState } from "react";
import { api, type SessionRow } from "../api";
import { ago, folderOf } from "../format";
import { follow, sessionPath } from "../router";
import { listedNow } from "../state";

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
          const l = listedNow(s, now);
          const path = sessionPath(s.sessionId);
          return (
            <li key={s.sessionId}>
              <a
                className={`lobby-card ${l.tag}`}
                href={path}
                onClick={follow(path)}
              >
                <span className="lobby-title">{l.title}</span>
                <span className={`lobby-state ${l.tag}`}>{l.word}</span>
                <span className="lobby-meta">
                  <span className="lobby-dir" title={s.cwd}>
                    {folderOf(s.cwd)}
                  </span>
                  <span>{s.machineName}</span>
                  {l.facts && <span>{l.facts}</span>}
                  <span>
                    started <time dateTime={s.startedAt}>{l.day}</time>
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
