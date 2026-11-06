import type { RequestView } from "@murmur/core";

const KIND: Record<RequestView["kind"], string> = {
  feature: "feature",
  bug: "bug hunt",
  refactor: "refactor",
  question: "question",
};

export function RequestList(props: {
  requests: RequestView[];
  selectedId: string;
  onSelect(requestId: string): void;
}) {
  const { requests, selectedId, onSelect } = props;
  return (
    <nav className="requests" aria-label="Requests">
      <div className="lbl">Requests</div>
      <ul>
        {[...requests].reverse().map((r) => (
          <li key={r.id} className="fade-in">
            <button
              type="button"
              className="request"
              aria-current={r.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(r.id)}
            >
              <span className="kind">
                {KIND[r.kind]}
                {r.kindInferred && <span className="inferred">inferred</span>}
              </span>
              <span className="clamp">{r.goal || r.prompt}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
