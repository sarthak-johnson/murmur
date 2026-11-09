/*
 * What kind of moment a message is (the story's badge), and a request's key moments.
 * The rules read the first sentence only, conservatively: the first that matches names
 * the moment, and most messages match none. The web draws its badges from these.
 */
import type { KeyMoment, Moment, RequestView } from "./types.js";

const SUBJECT = String.raw`\b(?:tasks?|phase)\b[^.;:!?]*?`;
const RULES: [Moment, RegExp][] = [
  // A review or test that found a problem, or something that failed.
  [
    "problem",
    // Not a guess ("means one failed", "might have failed", "if it failed") or a
    // negation ("none of the tests failed", "the review found no problems").
    /\breview(?:er)? found\b(?!\s+(?:no|nothing|none|zero)\b)|\bfound (?:a|an|one|two|three|\d+|some|real)\b[^.;:]*\bproblems?\b|(?<!\b(?:none|nothing|no|zero|0|never|not|means|meaning|might|may|maybe|could|would|if|or|whether)\b(?:\s[\w'-]+){0,3}\s)\bfailed\b/i,
  ],
  // Something sent back.
  [
    "fixing",
    /\bsen(?:d|ding|t) (?:it |them |this |that )?back\b|\bback to the (?:same )?builder\b/i,
  ],
  // A task or phase that is done or passed.
  [
    "done",
    new RegExp(
      `${SUBJECT}\\b(?:is|are|was|were)\\s+(?:now\\s+)?(?:done|finished|complete)\\b|\\b(?:tasks?|phase)\\s+[\\w-]+(?:\\s+and\\s+[\\w-]+)?\\s+passed\\b`,
      "i",
    ),
  ],
  // An explicit change of plan, or a choice with its reason ("X, not Y: because").
  [
    "decision",
    /\b(?:I|I'm|I'll|I've|we|we'll|we're)\b[^.;]*\b(?:instead of|rather than)\b|\bI(?:'ve| have)? decided\b|\bchanged? (?:the |my |our )?plan\b|,\s*not\s+\w+(?:\s+\w+)?\s*[:;]/i,
  ],
  ["plan", /\badded an? (?:\w+ )?task\b/i],
];

/** Markdown as one line of plain text: no code blocks, marks, links or list markers. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sentences of a plain text; "e.g." and its kind do not end one. */
export function sentences(plain: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of plain.matchAll(/[.!?](?=\s|$)/g)) {
    if (/\b(?:e\.g|i\.e|vs|cf|approx|incl|etc)$/i.test(plain.slice(0, m.index)))
      continue;
    out.push(plain.slice(from, m.index + 1).trim());
    from = m.index + 1;
  }
  const rest = plain.slice(from).trim();
  if (rest) out.push(rest);
  return out;
}

/** A text's first sentence, without its Markdown marks. */
export function firstSentence(text: string): string {
  return sentences(plainText(text))[0] ?? "";
}

/** The kind of moment a message is, or undefined when it is none of them. */
export function moment(text: string): Moment | undefined {
  const first = firstSentence(text);
  return RULES.find(([, re]) => re.test(first))?.[0];
}

/** At most `max` characters, cut at a word with "…" when it had to be cut. */
export function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

const MOMENT_TEXT = 140;
const BAD_VERDICT = /block|fail|reject/i;

/**
 * Up to five moments of a request, newest last: messages that read as a moment (their
 * first sentence), helper reports that failed or were blocked, and the plan being done
 * while work goes on (`beyond`). With `lastLooked`, moments after it are `new`.
 */
export function keyMoments(req: RequestView, lastLooked?: string): KeyMoment[] {
  const out: Omit<KeyMoment, "new">[] = [];
  for (const m of req.messages ?? []) {
    const mark = moment(m.text);
    if (mark)
      out.push({
        ts: m.ts,
        mark,
        text: cutWords(firstSentence(m.text), MOMENT_TEXT),
        ...(m.task ? { task: m.task } : {}),
      });
  }
  for (const a of req.agents) {
    const r = a.report;
    const bad =
      r &&
      (BAD_VERDICT.test(r.verdict ?? "") || /failed|killed/.test(r.status));
    if (!r || !bad) continue;
    const word = r.verdict
      ? r.verdict.replace(/[_-]+/g, " ").toLowerCase()
      : r.status;
    out.push({
      ts: r.ts,
      mark: "problem",
      text: cutWords(`${a.description || "A helper"}: ${word}`, MOMENT_TEXT),
    });
  }
  if (req.beyond)
    out.push({
      ts: req.beyond.since,
      mark: "plan",
      text: "The plan is done; work goes on beyond it",
    });
  return out
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
    .slice(-5)
    .map((m) => ({ ...m, new: lastLooked !== undefined && m.ts > lastLooked }));
}
