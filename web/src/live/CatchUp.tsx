import { ago } from "../format";

export function CatchUp(props: { text: string | null; since: string | null }) {
  if (!props.text || !props.since) return null;
  return (
    <p className="catch-up">
      <b>Since you last looked ({ago(props.since)}):</b> {props.text}
    </p>
  );
}
