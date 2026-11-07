import type { ReactNode } from "react";
import type { Tone } from "./story";

/** A status pill: tone shows by colour and by its marker's shape together. */
export function Pill(props: { tone: Tone; children: ReactNode }) {
  return <span className={`pill ${props.tone}`}>{props.children}</span>;
}
