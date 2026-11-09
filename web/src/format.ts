export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** Names that hold an "and" of their own are kept apart with semicolons. */
const sep = (xs: string[]) => (xs.some((x) => /\band\b/.test(x)) ? "; " : ", ");

/** "a", "a and b", "a, b and c"; "a and b; c" when a name holds an "and". */
export function list(xs: string[]): string {
  if (xs.length < 2) return xs.join("");
  if (sep(xs) === "; ") return xs.join("; ");
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** Up to three names, then how many more: a line stays a line or two. */
export const few = (xs: string[]) =>
  xs.length > 3
    ? `${xs.slice(0, 3).join(sep(xs.slice(0, 3)))} and ${xs.length - 3} more`
    : list(xs);

/** A text cut at a word, at most n characters; one long word is cut at n. */
export function cutWords(s: string, n: number): string {
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const space = head.lastIndexOf(" ");
  return `${(space > n / 3 ? head.slice(0, space) : head).replace(/[,;:]$/, "")}…`;
}
