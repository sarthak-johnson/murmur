import type { PhaseView, RequestView, TaskView } from "@murmur/core";
import { useState } from "react";

const GLYPH: Record<TaskView["status"], string> = {
  done: "✓",
  now: "●",
  todo: "○",
  failed: "✕",
};

export function PlanPanel(props: {
  request: RequestView;
  hoverPart?: string | undefined;
  onHover(partId: string | undefined): void;
  onOpen(partId: string): void;
}) {
  const { request } = props;
  const { phases } = request;
  const tasks = phases.flatMap((ph) => ph.tasks);
  const first = tasks.findIndex((t) => t.status !== "done");
  const step = first < 0 ? tasks.length : first + 1;
  return (
    <section className="plan" aria-label="Plan">
      <div className="lbl">
        {tasks.length ? `Plan · step ${step} of ${tasks.length}` : "Plan"}
        {request.planInferred && <span className="inferred">inferred</span>}
      </div>
      {phases.length === 0 && (
        <p className="muted">
          The plan appears when Claude lays out its steps.
        </p>
      )}
      {phases.map((ph, i) => (
        <PhaseCard key={ph.id} n={i + 1} phase={ph} {...props} />
      ))}
    </section>
  );
}

function PhaseCard(props: {
  n: number;
  phase: PhaseView;
  request: RequestView;
  hoverPart?: string | undefined;
  onHover(partId: string | undefined): void;
  onOpen(partId: string): void;
}) {
  const { n, phase, request, hoverPart, onHover, onOpen } = props;
  const [open, setOpen] = useState(false);
  const folded = phase.status === "done" && !open;
  const done = phase.tasks.filter((t) => t.status === "done").length;
  const partTitle = (id?: string) =>
    request.parts.find((p) => p.id === id)?.title;
  return (
    <div className={`phase-card ${phase.status}`}>
      <div className="phase-hd">
        {phase.status === "done" && <span aria-hidden="true">✓</span>}
        {phase.status === "now" && <span aria-hidden="true">●</span>}
        <span>
          {n} · {phase.title}
        </span>
        <span className="phase-n">
          {done} / {phase.tasks.length}
        </span>
        {phase.status === "done" && (
          <button
            type="button"
            className="link fold"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} phase ${n} tasks`}
            onClick={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      {folded ? (
        <p className="phase-summary">
          {phase.tasks.map((t) => t.title).join(" · ")}
        </p>
      ) : (
        <ul className="tasks">
          {phase.tasks.map((t) => {
            const chip = partTitle(t.part);
            const body = (
              <>
                <span className={`glyph ${t.status}`} aria-hidden="true">
                  {GLYPH[t.status]}
                </span>
                <span className="task-title">{t.title}</span>
                {chip && (
                  <span
                    className={`part-chip${hoverPart === t.part ? " hl" : ""}`}
                  >
                    {chip}
                  </span>
                )}
                {t.agents.map((id) => {
                  const k = request.agents.findIndex((a) => a.id === id);
                  const a = request.agents[k];
                  return a ? (
                    <span key={id} className="task-agent fade-in">
                      ↳ Agent {k + 1} · {a.description}
                    </span>
                  ) : null;
                })}
                {t.problem && <span className="task-problem">{t.problem}</span>}
              </>
            );
            const part = t.part;
            return (
              <li key={t.id} className="fade-in">
                {part ? (
                  <button
                    type="button"
                    className={`task ${t.status}`}
                    onMouseEnter={() => onHover(part)}
                    onMouseLeave={() => onHover(undefined)}
                    onFocus={() => onHover(part)}
                    onBlur={() => onHover(undefined)}
                    onClick={() => onOpen(part)}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={`task ${t.status}`}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
