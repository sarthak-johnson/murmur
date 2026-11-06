import type { PhaseView } from "@murmur/core";

export function PhaseStrip(props: {
  phases: PhaseView[];
  inferred: boolean;
  selected?: string | undefined;
  onSelect(phaseId: string | undefined): void;
}) {
  const { phases, inferred, selected, onSelect } = props;
  if (!phases.length) return null;
  return (
    <div className="strip-wrap">
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add a legend and border for a row of toggles */}
      <div
        className="strip"
        role="group"
        aria-label="Phases"
        style={{ gridTemplateColumns: `repeat(${phases.length}, 1fr)` }}
      >
        {phases.map((ph, i) => {
          const total = ph.tasks.length;
          const done = ph.tasks.filter((t) => t.status === "done").length;
          return (
            <button
              key={ph.id}
              type="button"
              className={`phase-seg ${ph.status}`}
              aria-pressed={selected === ph.id}
              onClick={() => onSelect(selected === ph.id ? undefined : ph.id)}
            >
              <b>
                {i + 1} · {ph.title}
              </b>
              <span>
                {done} of {total} {total === 1 ? "task" : "tasks"}
              </span>
              <span className="bar">
                <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      {inferred && <span className="inferred">inferred</span>}
    </div>
  );
}
