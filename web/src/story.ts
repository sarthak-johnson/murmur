/*
 * Plain readings of a request's story: what kind of moment a message is, how a task
 * ended, how many rounds a task took, and what a helper's report says in a word.
 */
import type {
  AgentReport,
  AgentView,
  PartView,
  RequestView,
  TaskView,
} from "@murmur/core";
import { plainText } from "./markdown";

export type Moment = "problem" | "fixing" | "done" | "decision" | "plan";
export type Tone = "done" | "warn" | "bad" | "now" | "plain";

export const MOMENT: Record<Moment, { label: string; tone: Tone }> = {
  problem: { label: "Problem found", tone: "bad" },
  fixing: { label: "Fixing", tone: "warn" },
  done: { label: "Done", tone: "done" },
  decision: { label: "Decision", tone: "plain" },
  plan: { label: "Plan changed", tone: "plain" },
};

// Decided from the first sentence only, and conservatively: the first rule that
// matches names the moment, and most messages match none.
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

/** A text's first sentence, without its Markdown marks. */
export function firstSentence(text: string): string {
  const plain = plainText(text);
  for (const m of plain.matchAll(/[.!?](?=\s|$)/g)) {
    // "e.g." and its kind do not end a sentence.
    if (/\b(?:e\.g|i\.e|vs|cf|approx|incl|etc)$/i.test(plain.slice(0, m.index)))
      continue;
    return plain.slice(0, m.index + 1);
  }
  return plain;
}

/** The kind of moment a message is, or undefined when it is none of them. */
export function moment(text: string): Moment | undefined {
  const first = firstSentence(text);
  return RULES.find(([, re]) => re.test(first))?.[0];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "10:06", in the viewer's time. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "under a minute", "7 m", "3 h 07 m". */
export function duration(from: string, to: string): string {
  const m = Math.floor(Math.max(0, Date.parse(to) - Date.parse(from)) / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} m`;
}

/** Tasks that went back for another round after a review. */
export function sentBack(req: RequestView): number {
  return req.parts.filter((p) => fixRounds(p, partAgents(req, p)) > 0).length;
}

/**
 * Rounds of fixing, from the part's steps (a fix or re-review step is one; a fix and its
 * re-review count once) or, when its steps are a recap's, from its helpers: each one
 * described as a fix round or re-review, or each review after the first.
 */
export function fixRounds(part: PartView, helpers: AgentView[] = []): number {
  const steps = (re: RegExp) =>
    part.steps.filter((s) => re.test(s.text)).length;
  const help = (re: RegExp) =>
    helpers.filter((a) => re.test(a.description)).length;
  return Math.max(
    steps(/^fixed\b/i),
    steps(/^re-?reviewed\b/i),
    help(/fix round|re-?review/i),
    help(/\b(?:re-?)?review/i) - 1,
  );
}

const COMMIT = /^[\s>*_-]*commits?\b[*_]*\s*:?[*_]*\s*(.*)$/im;

/** Commit hashes named on `Commit: <hash>` lines, first seen first. */
export function commitsIn(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts)
    for (const line of t.split("\n")) {
      const m = COMMIT.exec(line);
      for (const h of m?.[1]?.match(/\b[0-9a-f]{7,40}\b/g) ?? []) out.add(h);
    }
  return [...out];
}

// A heading, a bold label or a "Concerns:" label; a sentence that starts with the word is not one.
const CONCERNS =
  /^\s*(?:#{1,6}\s*(?:\*\*|__)?concerns?(?:\*\*|__)?\s*:?|(?:\*\*|__)?concerns?(?:\*\*|__)?\s*:(?:\*\*|__)?|(?:\*\*|__)concerns?(?:\*\*|__))\s*(.*)$/i;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const NONE = /^(none|n\/a|nothing)\.?$/i;

/** The bullets under a report's `Concerns:` heading (or its one line), without "None". */
export function concernsIn(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => CONCERNS.test(l));
  if (at < 0) return [];
  const same = (CONCERNS.exec(lines[at] as string)?.[1] ?? "").trim();
  if (same) return NONE.test(same) ? [] : [same];
  const items: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const m = ITEM.exec(l);
    if (m) items.push((m[1] as string).trim());
    else if (!l.trim()) {
      if (items.length) break;
    } else if (items.length && /^\s+/.test(l))
      items[items.length - 1] += ` ${l.trim()}`;
    else break;
  }
  return items.filter((i) => !NONE.test(i));
}

const STATUS_LINE =
  /^\s*[*_]*(status|verdict|commits?|branch|result)[*_]*\s*:/i;

/** A report's first paragraph of prose, without its status lines and headings. */
export function reportLead(text: string): string {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((l) => !STATUS_LINE.test(l) && !/^\s*#/.test(l))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
  return paras[0] ?? "";
}

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  DONE: { label: "Done", tone: "done" },
  DONE_WITH_CONCERNS: { label: "Done, with concerns", tone: "warn" },
  BLOCKED: { label: "Blocked", tone: "bad" },
  NEEDS_CONTEXT: { label: "Needs context", tone: "warn" },
};

/** A report's verdict line as a label and a tone; failed and stopped reports say so. */
export function verdictOf(
  report: AgentReport | undefined,
): { label: string; tone: Tone } | undefined {
  if (!report) return undefined;
  const v = report.verdict?.trim();
  if (v) {
    const known = VERDICT[v.toUpperCase()];
    if (known) return known;
    const words = v.replace(/[_-]+/g, " ").toLowerCase();
    const label = words.charAt(0).toUpperCase() + words.slice(1);
    const tone: Tone = /approv|pass|\bok\b|done|complete|ready/.test(words)
      ? "done"
      : /fail|block|issue|change|reject|problem|broke/.test(words)
        ? "bad"
        : /concern|need|partial|warn/.test(words)
          ? "warn"
          : "plain";
    return { label, tone };
  }
  if (report.status === "failed") return { label: "Failed", tone: "bad" };
  if (report.status === "killed") return { label: "Stopped", tone: "bad" };
  return undefined;
}

/**
 * A brief that says what the work is, or undefined for one that only tells the helper
 * how to act ("You are re-reviewing one task's fix round…"): that is the prompt talking.
 */
export function aboutWork(brief: string | undefined): string | undefined {
  const b = brief?.trim();
  if (!b || /^(you are|you're|your (job|task|role)|you will|act as)\b/i.test(b))
    return undefined;
  return b;
}

/** A report in a line: its lead paragraph, else its summary unless that only says it finished. */
export function reportLine(report: AgentReport | undefined): string {
  if (!report) return "";
  const lead = reportLead(report.text);
  if (lead) return lead;
  return /^Agent ".*" (finished|completed|failed|was stopped)\.?$/i.test(
    report.summary,
  )
    ? ""
    : report.summary;
}

type Kind = "build" | "review" | "rereview";
const stepKind = (t: string): Kind | undefined =>
  /\bre-?check|\bre-?review/i.test(t)
    ? "rereview"
    : /\breview/i.test(t)
      ? "review"
      : /\b(?:built|builder|build|implemented|implement|added|wrote|created)\b/i.test(
            t,
          )
        ? "build"
        : undefined;
const helperKind = (d: string): Kind | undefined =>
  /^re-?review/i.test(d)
    ? "rereview"
    : /^review/i.test(d)
      ? "review"
      : /^(?:implement|build|write|add|draft|create|fix)\b/i.test(d)
        ? "build"
        : undefined;

/**
 * A recapped part's steps and its helpers as one list. A step that names a kind of round
 * (built, reviewed, rechecked) leads the first unused helper of that kind; helpers no
 * step names keep their start order; a step that leads no helper stays where it is, and
 * one after the last matched step goes to the end.
 */
export function recapRounds<S extends { text: string }>(
  steps: S[],
  helpers: AgentView[],
): { step?: S; helper?: AgentView }[] {
  const used = new Set<string>();
  const matched = steps.map((s) => {
    const kind = stepKind(s.text);
    const h = kind
      ? helpers.find(
          (a) => !used.has(a.id) && helperKind(a.description) === kind,
        )
      : undefined;
    if (h) used.add(h.id);
    return h;
  });
  const lastMatched = matched.findLastIndex(Boolean);
  const END = "\uffff";
  let key = "";
  const entries: { key: string; seq: number; step?: S; helper?: AgentView }[] =
    steps.map((step, i) => {
      const helper = matched[i];
      if (helper) key = helper.startedAt;
      return {
        key: helper ? helper.startedAt : i > lastMatched ? END : key,
        seq: i,
        step,
        ...(helper ? { helper } : {}),
      };
    });
  helpers.forEach((helper, i) => {
    if (!used.has(helper.id))
      entries.push({ key: helper.startedAt, seq: steps.length + i, helper });
  });
  return entries
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.seq - b.seq))
    .map(({ step, helper }) => ({
      ...(step ? { step } : {}),
      ...(helper ? { helper } : {}),
    }));
}

/** The helpers on a part, in start order. */
export function partAgents(req: RequestView, part: PartView): AgentView[] {
  return part.agents.flatMap((id) => req.agents.find((a) => a.id === id) ?? []);
}

/**
 * How a task ended, in one line: the recap's line (its part's last step), else the
 * last message about it, else the verdict of its last helper to report.
 */
export function outcome(req: RequestView, task: TaskView): string | undefined {
  const part = req.parts.find((p) => p.id === task.part);
  if (req.recap) {
    const last = part?.steps.at(-1)?.text;
    if (last) return last;
  }
  const msg = req.messages?.findLast((m) => m.task === task.id);
  if (msg) return plainText(msg.text.split(/\n\s*\n/)[0] ?? msg.text);
  const ids = new Set([...task.agents, ...(part?.agents ?? [])]);
  const reported = req.agents
    .filter((a) => ids.has(a.id) && a.report)
    .sort((a, b) => (a.report?.ts ?? "").localeCompare(b.report?.ts ?? ""))
    .at(-1);
  return verdictOf(reported?.report)?.label;
}
