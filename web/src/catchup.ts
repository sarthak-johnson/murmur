/*
 * "Since you last looked": one plain sentence and up to five marked bullets, built by
 * comparing the request as it was at the viewer's last look with the request now.
 */
import type { RequestView, SessionView, TaskView } from "@murmur/core";
import { phaseSpan, shortTitle, type Waiting } from "./session";
import { clock, firstSentence, moment } from "./story";

export type Mark = "done" | "bad" | "now" | "plain";
export interface BriefItem {
  mark: Mark;
  lead: string;
  text: string;
}
export interface Brief {
  /** The sentence as it stood at the look; `briefLead` adds open questions live. */
  sentences: string[];
  items: BriefItem[];
}

const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const word = (n: number) => NUM[n] ?? String(n);
const n_ = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Names that hold an "and" of their own are kept apart with semicolons. */
const sep = (xs: string[]) => (xs.some((x) => /\band\b/.test(x)) ? "; " : ", ");

/** "a", "a and b", "a, b and c"; "a and b; c" when a name holds an "and". */
export function list(xs: string[]): string {
  if (xs.length < 2) return xs.join("");
  if (sep(xs) === "; ") return xs.join("; ");
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** Up to three names, then how many more: a bullet stays a line or two. */
const few = (xs: string[]) =>
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function catchUpBrief(
  before: SessionView | null,
  after: SessionView,
  requestId: string,
  lastLooked: string | null,
): Brief | null {
  const a = after.requests.find((r) => r.id === requestId);
  if (!a || !before || !lastLooked) return null;
  const b: Pick<RequestView, "phases" | "agents"> = before.requests.find(
    (r) => r.id === requestId,
  ) ?? { phases: [], agents: [] };
  const tasks = (r: Pick<RequestView, "phases">) =>
    r.phases.flatMap((p) => p.tasks);
  const was = new Map(tasks(b).map((t) => [t.id, t.status]));
  const wasPhase = new Map(b.phases.map((p) => [p.id, p.status]));
  const name = (t: TaskView) => shortTitle(t.title);

  const finished = a.phases.filter(
    (p) => p.status === "done" && wasPhase.get(p.id) !== "done",
  );
  const started = a.phases.filter(
    (p) => p.status === "now" && (wasPhase.get(p.id) ?? "todo") === "todo",
  );

  const items: BriefItem[] = [];
  const says: string[] = [];
  const is = (n: number) => (n === 1 ? "is" : "are");
  const doneNow = tasks(a).filter(
    (t) => t.status === "done" && was.get(t.id) !== "done",
  );
  if (doneNow.length) {
    says.push(`${n_(doneNow.length, "task")} ${is(doneNow.length)} done`);
    items.push({
      mark: "done",
      lead: `${n_(doneNow.length, "task")} done:`,
      text: few(doneNow.map(name)),
    });
  }
  const newer = (a.messages ?? []).filter((m) => m.ts > lastLooked);
  for (const [kind, mark] of [
    ["problem", "bad"],
    ["fixing", "plain"],
  ] as const) {
    const ms = newer.filter((m) => moment(m.text) === kind);
    const latest = ms.at(-1);
    if (!latest) continue;
    says.push(
      kind === "problem"
        ? `${n_(ms.length, "problem")} ${ms.length === 1 ? "was" : "were"} found`
        : `${ms.length} sent back for fixes`,
    );
    items.push({
      mark,
      lead:
        kind === "problem"
          ? `${n_(ms.length, "problem")} found:`
          : `${ms.length} sent back for fixes:`,
      text: cutWords(firstSentence(latest.text), 140),
    });
  }
  const known = new Set(b.agents.map((x) => x.id));
  const fresh = a.agents.filter((x) => !known.has(x.id));
  if (fresh.length) {
    const on = [
      ...new Set(
        fresh.flatMap((h) => {
          const t = tasks(a).find(
            (t) =>
              t.agents.includes(h.id) ||
              a.parts.find((p) => p.id === t.part)?.agents.includes(h.id),
          );
          return t ? [name(t)] : [];
        }),
      ),
    ];
    says.push(`${n_(fresh.length, "helper")} started`);
    items.push({
      mark: fresh.some((h) => h.status === "running") ? "now" : "plain",
      lead: `${n_(fresh.length, "helper")} started`,
      text: on.length ? `on ${few(on)}` : "",
    });
  }

  const sentences: string[] = [];
  if (finished.length)
    sentences.push(
      `${list(finished.map((p) => p.title))} ${finished.length === 1 ? "is" : "are"} finished.`,
    );
  const begun = started.map((p) => {
    const from = phaseSpan(a, p).from;
    return from ? `${p.title} started at ${clock(from)}` : `${p.title} started`;
  });
  if (begun.length) sentences.push(`${cap(list(begun))}.`);
  if (!sentences.length && !items.length) return null;
  if (!sentences.length) sentences.push(`${cap(list(says))}.`);
  return { sentences, items: items.slice(0, 5) };
}

/** The brief's sentence, with the questions asked since the look that are still open. */
export function briefLead(
  brief: Brief,
  waiting: Waiting | null,
  lastLooked: string,
): string {
  const n =
    waiting && waiting.since > lastLooked ? waiting.questions.length : -1;
  const ask =
    n < 0
      ? ""
      : n === 0
        ? "Claude is waiting for you"
        : n === 1
          ? "a question is waiting for you"
          : `${word(n)} questions are waiting for you`;
  const out = [...brief.sentences];
  if (ask) out.push(`${out.pop()?.replace(/\.$/, "")}, and ${ask}.`);
  return out.join(" ");
}
