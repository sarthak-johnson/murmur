/*
 * Plain readings of a request's story: what kind of moment a message is, how a task
 * ended, how many rounds a task took, and what a helper's report says in a word.
 */
import {
  type AgentReport,
  type AgentView,
  cutWords,
  firstSentence,
  type Moment,
  type PartView,
  type RequestView,
  type TaskView,
} from "@murmur/core";
import { plainText } from "./markdown";

// The badge rules live in core, so the request brief and the story read messages alike.
export { firstSentence, type Moment, moment } from "@murmur/core";
export type Tone = "done" | "warn" | "bad" | "now" | "plain";

export const MOMENT: Record<Moment, { label: string; tone: Tone }> = {
  problem: { label: "Problem found", tone: "bad" },
  fixing: { label: "Fixing", tone: "warn" },
  done: { label: "Done", tone: "done" },
  decision: { label: "Decision", tone: "plain" },
  plan: { label: "Plan changed", tone: "plain" },
};

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
  /^\s*[*_]*(status|verdict|commits?|branch|result|tests?|report)[*_]*\s*:/i;
/** A commit line ("`cdabad5ab` test(contracts): ..."): a record, not what was done. */
const HASH_LINE = /^\s*(?:[-*+]\s+)?`?[0-9a-f]{7,40}\b/;
/** A section's label ("What is captured:", "Concerns:") opens a list, not prose. */
const LABEL = /^[*_]*[^\n.]{1,60}:[*_]*\s*(?:\n|$)/;

/**
 * A report's opening paragraph when it is prose: past its status, commit and test lines
 * and headings. A report that opens with a list or a labelled section ("What is captured:")
 * has no lead; `helperGist` then reads Claude's word on it.
 */
export function reportLead(text: string): string {
  const [first] = paragraphs(text);
  return first && isProse(first) ? first : "";
}

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  DONE: { label: "Done", tone: "done" },
  DONE_WITH_CONCERNS: { label: "Done, with concerns", tone: "warn" },
  BLOCKED: { label: "Blocked", tone: "bad" },
  NEEDS_CONTEXT: { label: "Needs context", tone: "warn" },
};

/** "verdict is **fix first**", "Verdict: Compliant.": the first verdict a report names. */
const SAID_VERDICT =
  /\bverdict\b[*_]*\s*(?:is\b|:)\s*[*_]*\s*([^*_.\n:;(]{2,40})/i;

/** A report's verdict line as a label and a tone; failed and stopped reports say so. */
export function verdictOf(
  report: AgentReport | undefined,
): { label: string; tone: Tone } | undefined {
  if (!report) return undefined;
  // A `Status:` line, else the verdict a review names in its words ("My verdict is fix first").
  const v =
    report.verdict?.trim() ||
    SAID_VERDICT.exec(report.text.slice(0, 600))?.[1]
      ?.replace(/^[^\p{L}\p{N}]+/u, "")
      .trim();
  if (v) {
    const known = VERDICT[v.toUpperCase()];
    if (known) return known;
    const words = v.replace(/[_-]+/g, " ").toLowerCase();
    const label = words.charAt(0).toUpperCase() + words.slice(1);
    const tone: Tone = /fix(?:es)? first|needs? fix|not pass/.test(words)
      ? "bad"
      : /approv|pass|\bok\b|done|complete|ready|compliant/.test(words)
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

/**
 * What a helper is at, in a line: while it runs, its latest action and the files it has
 * changed so far; once finished, the first sentence of its gist (`helperGist`). Empty when
 * there is nothing to say.
 */
export function helperLine(
  a: AgentView,
  running: boolean,
  req?: RequestView,
): string {
  const files = a.files?.length ?? 0;
  if (running)
    return [a.doing?.text, files ? `${nOf(files, "file")} so far` : ""]
      .filter(Boolean)
      .join(" · ");
  return cutWords(firstSentence(helperGist(a, req)), 160);
}

/** Words about waiting on its own work: no gist of what a helper did. */
const WAITING =
  /\b(?:still (?:going|running|in progress|being)|in flight|in the background|(?:running|going) now|(?:i'?ll|i will|let me) wait|waiting (?:for|on)|wait(?:ing)? until|will (?:notify|report|ping)|once (?:it|they) (?:finish|finishes|end|ends|complete|completes)|when (?:it|they) (?:end|ends|finish|finishes|complete|completes))\b/i;

/** A text's paragraphs without status, commit or test lines and headings. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter(
          (l) => !STATUS_LINE.test(l) && !HASH_LINE.test(l) && !/^\s*#/.test(l),
        )
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}
const isProse = (p: string) =>
  !/^\s*(?:[-*+]|\d+[.)])\s/.test(p) && !LABEL.test(p);

/** A report's paragraphs of prose: no status, commit or test lines, headings, lists or labels. */
const prose = (text: string) => paragraphs(text).filter(isProse);

const COMMIT_SUBJECT =
  /^\s*(?:[-*+]\s+)?(?:[*_]*commits?[*_]*\s*:\s*)?`?[0-9a-f]{7,40}`?\s+(.+)$/i;
/**
 * What its commits say it did, in words: "test(contracts): capture the screener reads
 * [T101]" reads "Capture the screener reads"; several join with "; ".
 */
export function commitWords(text: string): string {
  const s = text
    .split("\n")
    .flatMap((l) => {
      const subject = COMMIT_SUBJECT.exec(l)?.[1]
        ?.replace(/^[\w-]+(?:\([^)]*\))?!?:\s*/, "")
        .replace(/\s*\[[A-Z]*\d+[a-z]?\]/g, "")
        .trim();
      return subject ? [subject] : [];
    })
    .join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What a finished helper did, in a few words: its report's lead. A final report with none
 * (only lists and labelled sections) gives way to Claude's word on it, then to what its
 * commits say, then to the rest of its prose; one that only says it is waiting on its own background work gives way to its
 * other prose, then to Claude's word, then to its last words. A helper whose every word
 * was about waiting says it stopped with its own work still running.
 */
export function helperGist(a: AgentView, req?: RequestView): string {
  const r = a.report;
  const lead = r ? reportLine(r) : "";
  // A final report says what it did; only an interim one, or none, is read for waiting.
  if (lead && !r?.interim) return lead;
  const claude = (req?.messages ?? [])
    .filter((m) => m.agent === a.id)
    .map((m) => plainText(m.text.split(/\n\s*\n/)[0] ?? m.text));
  const own = r ? prose(r.text) : [];
  const commits = r ? commitWords(r.text) : "";
  const said = [
    ...(r && !r.interim
      ? [...claude, ...(commits ? [commits] : []), ...own]
      : [...own, ...claude]),
    ...(a.lastText ? prose(a.lastText) : []),
  ].find((p) => !WAITING.test(firstSentence(p)));
  if (said) return said;
  // A final report with no prose and no word of Claude's on it: nothing to add.
  if (r && !r.interim) return "";
  if (r?.interim || lead || a.lastText)
    return "Stopped while its own checks were still running; no final report came.";
  return "";
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

/** Fix rounds in a request: each subject's rounds past its first, counted once. */
export function fixRoundCount(req: RequestView): number {
  const pairs = new Set(
    req.agents.flatMap((a) =>
      a.subject && (a.round ?? 1) > 1 ? [`${a.subject}#${a.round}`] : [],
    ),
  );
  return pairs.size;
}

/** "1,219". */
export const thousands = (n: number) => n.toLocaleString("en-US");

/** "1 helper", "3 helpers". */
export const nOf = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "Task 39", "Tasks 4-5", "Bug B1": the plan number a task's title starts with. */
export function taskNumber(title: string): string | undefined {
  return /^(?:(?:tasks?|bug|step)\s+[A-Z]?\d+[a-z]?(?:\s*[-–,&]\s*\d+)*)/i
    .exec(title.trim())?.[0]
    .replace(/–/g, "-");
}
