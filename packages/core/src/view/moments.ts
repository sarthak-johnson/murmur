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
  // An explicit change of plan, or a choice: between options ("going with X", "we chose
  // X", "switching to X") or with its reason ("X, not Y: because").
  [
    "decision",
    /\b(?:I|I'm|I'll|I've|we|we'll|we're)\b[^.;]*\b(?:instead of|rather than|chose|switch(?:ed|ing)? to|decided to)\b|^(?:going with|switching to)\b|\bI(?:'ve| have)? decided\b|\bchanged? (?:the |my |our )?plan\b|,\s*not\s+\w+(?:\s+\w+)?\s*[:;]/i,
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

/** Asked of the user: "Should I…", "Do you…", "May we…", or anything with "you". */
const ASKS =
  /^(?:(?:and|but|so|also|then|or)\s+)?(?:(?:should|shall|may|can|could|would|will|do|does|did|is|are|want)\s+(?:i|we|me|you)\b|want me\b)|\byou(?:rs?)?\b/i;

/**
 * The questions Claude's message leaves for you, in order. Only questions that end its
 * last paragraph or a trailing list count, and only ones put to you: code, links and
 * a question Claude answers itself never do. When unsure, none: a false "needs you"
 * is worse than a missed one.
 */
export function questionsIn(text: string): string[] {
  const src = text
    .replace(/```[\s\S]*?(?:```|$)/g, "\n\n")
    .replace(/`[^`\n]*`/g, "code")
    .replace(/\]\([^)\s]*\)/g, "]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, "link");
  const block =
    src
      .split(/\n\s*\n/)
      .filter((b) => b.trim())
      .at(-1) ?? "";
  // A heading or a list item is a unit of its own; other lines run together.
  type Unit = { text: string; kind: "heading" | "item" | "para" };
  const units: Unit[] = [];
  for (const line of block.split("\n")) {
    const l = line.trim();
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)?.[1];
    const last = units.at(-1);
    if (/^#{1,6}\s/.test(l)) units.push({ text: l, kind: "heading" });
    else if (item !== undefined) units.push({ text: item, kind: "item" });
    else if (last?.kind === "para") last.text += ` ${l}`;
    else units.push({ text: l, kind: "para" });
  }
  const tail =
    units.at(-1)?.kind === "item"
      ? units.slice(units.findLastIndex((u) => u.kind !== "item") + 1)
      : units.slice(-1);
  return tail.flatMap((u) => {
    if (u.kind === "heading") return [];
    // A sentence ends at . ! ? before a space, so "v1.2" stays whole.
    const said = plainText(u.text).replace(/\s+/g, " ").trim();
    const sentences = said.split(/(?<=[.!?])\s+/);
    const asked: string[] = [];
    for (const q of sentences.reverse()) {
      if (!q.endsWith("?")) break;
      asked.unshift(q);
    }
    // "Should I…? Or…?" is one choice.
    const merged: string[] = [];
    for (const q of asked)
      if (/^or\b/i.test(q) && merged.length)
        merged[merged.length - 1] += ` ${q}`;
      else merged.push(q);
    return merged.filter((q) => ASKS.test(q) && q.length > 3);
  });
}

// A sentence that asks the user to act: "Please sign in", "waiting on you to sign in".
const ASK_TO =
  /^(?:please|kindly)\s+(.+)$|\b(?:waiting (?:on|for) you to|(?:I )?needs? you to)\s+(.+)$/i;

/**
 * What a message asks of the user, as one sentence: its first question put to you
 * (`questionsIn`), else its first sentence asking you to act, as an instruction
 * ("Please sign in there." and "It is waiting on you to sign in there." read "Sign in
 * there"). Unset when it asks nothing.
 */
export function askIn(text: string): string | undefined {
  const q = questionsIn(text)[0];
  if (q) return q;
  for (const s of sentences(plainText(text))) {
    const m = ASK_TO.exec(s);
    const what = (m?.[1] ?? m?.[2])?.replace(/[.!]+$/, "").trim();
    if (what) return what.charAt(0).toUpperCase() + what.slice(1);
  }
  return undefined;
}

/** A text's first sentence, without its Markdown marks. */
export function firstSentence(text: string): string {
  return sentences(plainText(text))[0] ?? "";
}

// A remark that something is meant to be so ("intentional, not a bug:") chooses nothing.
const REMARK =
  /\b(?:intentional(?:ly)?|on purpose|by design|not a (?:bug|mistake)|works? as (?:designed|intended)|as intended|expected behaviou?r)\b/i;

/** The kind of moment a message is, or undefined when it is none of them. */
export function moment(text: string): Moment | undefined {
  const first = firstSentence(text);
  return RULES.find(
    ([mark, re]) =>
      re.test(first) && !(mark === "decision" && REMARK.test(first)),
  )?.[0];
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

/** What a "done" moment says finished: its words before the first colon or semicolon. */
const doneKey = (m: Omit<KeyMoment, "new">) =>
  `${m.task ?? ""}|${m.text
    .split(/[:;]/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}`;

/**
 * Up to five moments of a request, newest last: messages that read as a moment (their
 * first sentence), helper reports that failed or were blocked, and the plan being done
 * while work goes on (`beyond`). A thing said finished twice counts once, at its later
 * word. With `lastLooked`, moments after it are `new`.
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
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  // The same thing said finished twice ("Phase 0 is finished: ...") is one moment, the
  // later word kept; problems and decisions can rightly repeat, so they all stay.
  const lastDone = new Map(
    out.flatMap((m, i) => (m.mark === "done" ? [[doneKey(m), i]] : [])),
  );
  return out
    .filter((m, i) => m.mark !== "done" || lastDone.get(doneKey(m)) === i)
    .slice(-5)
    .map((m) => ({ ...m, new: lastLooked !== undefined && m.ts > lastLooked }));
}
