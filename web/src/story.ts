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
  decision: { label: "Decision", tone: "now" },
  plan: { label: "Plan changed", tone: "plain" },
};

// In order: the first rule that matches names the moment. Words match from their start.
const RULES: [Moment, RegExp][] = [
  ["problem", /review found|\bproblem|\bfailed\b|\bbroke/i],
  ["fixing", /\bfix|\bsent back\b/i],
  ["done", /\bdone\b|\bpassed\b|\bverified\b/i],
  [
    "decision",
    /\binstead of\b|\bnot\s|\bchanged\b|\bdecided\b|\brather than\b/i,
  ],
  ["plan", /\badded a task\b|\badded an\b/i],
];

/** The kind of moment a message is, or undefined when it is none of them. */
export function moment(text: string): Moment | undefined {
  const plain = plainText(text);
  return RULES.find(([, re]) => re.test(plain))?.[0];
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

const AGAIN = /^(fixed|re-?reviewed)\b/i;

/** Tasks that went back for another round after a review. */
export function sentBack(req: RequestView): number {
  return req.parts.filter((p) => p.steps.some((s) => AGAIN.test(s.text)))
    .length;
}

/** Rounds of fixing: each fix or re-review is one; a fix and its re-review count once. */
export function fixRounds(part: PartView): number {
  const n = (re: RegExp) => part.steps.filter((s) => re.test(s.text)).length;
  return Math.max(n(/^fixed\b/i), n(/^re-?reviewed\b/i));
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
