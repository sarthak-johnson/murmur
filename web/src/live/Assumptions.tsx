import type { Assumption } from "@murmur/core";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Decision = "accepted" | "rejected";

export function Assumptions(props: {
  sessionId: string;
  assumptions: Assumption[];
}) {
  const { sessionId, assumptions } = props;
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    api.assumptions(sessionId).then(
      (r) => {
        if (dead) return;
        const saved: Record<string, Decision> = {};
        for (const d of r.decisions) saved[d.key] = d.decision as Decision;
        // Choices made while the list loaded win over the stored ones.
        setDecided((now) => ({ ...saved, ...now }));
      },
      () => {},
    );
    return () => {
      dead = true;
    };
  }, [sessionId]);

  async function decide(key: string, d: Decision) {
    const before = decided[key];
    setDecided((m) => ({ ...m, [key]: d }));
    setFailed(false);
    try {
      await api.setAssumption(sessionId, key, d);
    } catch {
      setDecided((m) => {
        const { [key]: _, ...rest } = m;
        return before ? { ...rest, [key]: before } : rest;
      });
      setFailed(true);
    }
  }

  if (!assumptions.length) return null;
  return (
    <section
      className="assumptions"
      aria-label={`Assumptions (${assumptions.length})`}
    >
      <div className="lbl">Assumptions ({assumptions.length})</div>
      {failed && (
        <p className="error small" role="alert">
          Could not save that choice. Try again.
        </p>
      )}
      <ul>
        {assumptions.map((a) => {
          const d = decided[a.key];
          return (
            <li key={a.key} className="assumption fade-in">
              <b>{a.choice}</b>
              <span className="muted">{a.reason}</span>
              <span className="decide">
                {d === "accepted" ? (
                  <span className="decided">Accepted</span>
                ) : (
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => decide(a.key, "accepted")}
                  >
                    Accept
                  </button>
                )}
                {d === "rejected" ? (
                  <span className="decided">Rejected</span>
                ) : (
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => decide(a.key, "rejected")}
                  >
                    Reject
                  </button>
                )}
              </span>
              {d === "rejected" && (
                <CopyRow text={`Please undo this choice: ${a.choice}`} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CopyRow({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: select the line so Cmd/Ctrl+C copies it.
      const el = ref.current;
      const sel = window.getSelection();
      if (!el || !sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  return (
    <span className="copy-row">
      <span ref={ref} className="copy-text">
        {text}
      </span>
      <button type="button" className="small-btn" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
