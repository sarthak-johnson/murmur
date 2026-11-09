/*
 * Words for lists of names and cut texts. The "since you last looked" box that lived
 * here is gone: its catch-up is the brief's "new" key moments now.
 */

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
