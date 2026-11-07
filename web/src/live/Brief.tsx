import type { Flag } from "@murmur/core";
import { type Brief as BriefData, briefLead, type Mark } from "../catchup";
import { ago } from "../format";
import type { Waiting } from "../session";
import { clock, duration } from "../story";
import { Glyph } from "./PlanColumn";
import { NeedIcon } from "./TopBar";

function ItemMark({ mark }: { mark: Mark }) {
  if (mark === "bad")
    return (
      <svg className="g" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 2.6 14 13H2L8 2.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M8 6.6v3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  return <Glyph status={mark === "plain" ? "todo" : mark} />;
}

function CatchUp(props: {
  brief: BriefData;
  since: string;
  waiting: Waiting | null;
}) {
  const { brief, since, waiting } = props;
  return (
    <section className="brief-l" aria-label="Since you last looked">
      <div className="since">
        <b>Since you last looked</b> at {clock(since)}, {ago(since)}
      </div>
      <p className="lead">{briefLead(brief, waiting, since)}</p>
      {brief.items.length > 0 && (
        <ul className="items">
          {brief.items.map((i) => (
            <li key={i.lead} className={`it ${i.mark}`}>
              <ItemMark mark={i.mark} />
              <span>
                <b>{i.lead}</b>
                {i.text && ` ${i.text}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NeedsCall(props: { waiting: Waiting; risky: Flag[] }) {
  const { waiting, risky } = props;
  const now = new Date().toISOString();
  return (
    <section className="brief-r" id="needs" aria-label="Needs your call">
      <div className="call-h">
        <NeedIcon />
        Needs your call
        <span className="num">waiting {duration(waiting.since, now)}</span>
      </div>
      {waiting.questions.map((q) => (
        <div key={q.question} className="qq">
          <b>{q.question}</b>
          {q.detail && <p>{q.detail}</p>}
        </div>
      ))}
      {!waiting.questions.length && waiting.text && (
        <div className="qq">
          <b>{waiting.text}</b>
        </div>
      )}
      {risky.map((f) => (
        <div key={`${f.ts}:${f.text}`} className="qq">
          <p>{f.text}</p>
        </div>
      ))}
      <div className="ans">
        <span className="where">Answer in the terminal</span>
        <span className="num">Asked {clock(waiting.since)}</span>
      </div>
    </section>
  );
}

/** What changed since the last look, beside what Claude needs from you. Draws nothing when neither. */
export function BriefBlock(props: {
  brief: BriefData | null;
  since: string | null;
  waiting: Waiting | null;
  flags: Flag[];
}) {
  const { brief, since, waiting, flags } = props;
  const risky = flags.filter((f) => f.kind === "risky" && f.pending);
  const catchUp = brief && since;
  if (!catchUp && !waiting) return null;
  return (
    <div className={catchUp && waiting ? "brief two" : "brief"}>
      {catchUp && <CatchUp brief={brief} since={since} waiting={waiting} />}
      {waiting && <NeedsCall waiting={waiting} risky={risky} />}
    </div>
  );
}
