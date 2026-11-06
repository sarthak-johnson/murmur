import type { Flag, NeedsYou } from "@murmur/core";

export function FlagsBar(props: { needsYou: NeedsYou | null; flags: Flag[] }) {
  const items = [
    ...(props.needsYou
      ? [
          {
            key: `needs:${props.needsYou.since}`,
            ts: props.needsYou.since,
            cls: "flag-needs",
            text: `Claude needs you: ${props.needsYou.text}`,
          },
        ]
      : []),
    ...props.flags
      .filter((f) => f.kind === "risky" && f.pending)
      .map((f) => ({
        key: `risky:${f.ts}:${f.text}`,
        ts: f.ts,
        cls: "flag-risky",
        text: f.text,
      })),
  ]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, 3);
  if (!items.length) return null;
  return (
    <div className="flags" role="status">
      {items.map((it) => (
        <p key={it.key} className={`flag fade-in ${it.cls}`}>
          {it.text}
        </p>
      ))}
    </div>
  );
}
