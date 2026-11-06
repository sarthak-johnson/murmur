import type { Flag, NeedsYou, PartView } from "@murmur/core";
import { useState } from "react";
import { ago } from "../format";

interface Notice {
  key: string;
  cls: string;
  chip?: string;
  lead?: string;
  text: string;
}

const newest = (a: Flag, b: Flag) => b.ts.localeCompare(a.ts);

function Body({ n }: { n: Notice }) {
  return (
    <>
      {n.chip && <span className="notice-chip">{n.chip}</span>}
      {n.lead && <b>{n.lead} </b>}
      {n.text}
    </>
  );
}

/**
 * One fixed row under the title, always reserved so nothing below it moves. Shows the
 * most urgent notice (needs you, then a pending risky command, then stuck, then the
 * catch-up line); "+N more" opens the rest over the screen.
 */
export function Notices(props: {
  needsYou: NeedsYou | null;
  flags: Flag[];
  parts: PartView[];
  catchUp: string | null;
  since: string | null;
}) {
  const { needsYou, flags, parts, catchUp, since } = props;
  const [open, setOpen] = useState(false);
  const pending = (kind: Flag["kind"]) =>
    flags.filter((f) => f.kind === kind && f.pending).sort(newest);
  const partTitle = (id?: string) => parts.find((p) => p.id === id)?.title;
  const items: Notice[] = [
    ...(needsYou
      ? [
          {
            key: `needs:${needsYou.since}`,
            cls: "notice-needs",
            chip: "Needs you",
            text: needsYou.text,
          },
        ]
      : []),
    ...pending("risky").map((f) => ({
      key: `risky:${f.ts}:${f.text}`,
      cls: "notice-risky",
      text: f.text,
    })),
    ...pending("stuck").map((f) => {
      const part = partTitle(f.part);
      return {
        key: `stuck:${f.ts}:${f.part ?? ""}`,
        cls: "notice-stuck",
        chip: "Stuck",
        text: part ? `${f.text} · ${part}` : f.text,
      };
    }),
    ...(catchUp && since
      ? [
          {
            key: "catch-up",
            cls: "notice-catch",
            lead: `Since you last looked (${ago(since)}):`,
            text: catchUp,
          },
        ]
      : []),
  ];
  const [top, ...rest] = items;
  return (
    <div className="notice-row" aria-live="polite">
      {top && (
        <p
          key={top.key}
          className={`notice fade-in ${top.cls}`}
          title={[top.chip, top.lead, top.text].filter(Boolean).join(" ")}
        >
          <Body n={top} />
        </p>
      )}
      {rest.length > 0 && (
        <button
          type="button"
          className="link notice-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          +{rest.length} more
        </button>
      )}
      {open && rest.length > 0 && (
        <ul className="notice-list">
          {rest.map((n) => (
            <li key={n.key} className={`notice ${n.cls}`}>
              <Body n={n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
