/*
 * Claude's own words: helper reports, helper briefs and the messages of each request.
 * Runs after every request is reduced and inferred, so part titles are final.
 * - Report: a `<task-notification>` prompt names its Agent call by `<tool-use-id>`; the
 *   helper that call started gets `{ status, summary, text, verdict, ts, interim }`, a
 *   later notification replacing it. A foreground helper's report is the text of its
 *   Agent PostToolUse result. `verdict` is a first line like `Status: DONE`.
 * - Messages: each `AssistantText` of a request, in order. `task` when the message names
 *   one subject ("Task 1", "Tasks 4 and 5", "B7", "bug B1") that exactly one task covers,
 *   or, with no subject named on a narrated request, contains exactly one task's (or a
 *   one-task part's) title. `agent` when a report came before it in the same turn: no
 *   Stop, prompt, new helper or other report in between.
 * - Brief: see `briefOf`.
 */
import type { MurmurEvent } from "../events.js";
import type {
  AgentReport,
  AgentView,
  MessageView,
  RequestView,
  TaskView,
} from "./types.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const unentity = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const tag = (name: string, s: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s);
  return m ? unentity((m[1] as string).trim()) : undefined;
};
const VERDICT = /^Status:\s*([A-Z][A-Z_]+)(?![A-Za-z])/;
const INTERIM = /waiting on its own background work|may be interim/i;

function verdictOf(text: string): string | undefined {
  const first = text.trim().split("\n")[0]?.replace(/\*/g, "") ?? "";
  return VERDICT.exec(first.trim())?.[1];
}

/** A task notification prompt as the Agent call it reports on and its report. */
export function parseNotification(
  prompt: string,
  ts: string,
): { use: string; report: AgentReport } | undefined {
  if (!/^\s*<task-notification>/.test(prompt)) return undefined;
  const use = tag("tool-use-id", prompt);
  if (!use) return undefined;
  // The report itself may hold the closing tag, so it runs to the last one.
  const open = prompt.indexOf("<result>");
  const close = prompt.lastIndexOf("</result>");
  const text =
    open >= 0 && close > open
      ? unentity(prompt.slice(open + "<result>".length, close).trim())
      : "";
  const summary = tag("summary", prompt) ?? "";
  const verdict = verdictOf(text);
  return {
    use,
    report: {
      status: tag("status", prompt) ?? "completed",
      summary,
      text,
      ...(verdict ? { verdict } : {}),
      ts,
      interim: INTERIM.test(`${summary}\n${tag("note", prompt) ?? ""}`),
    },
  };
}

/** A foreground Agent result's text, without the harness's own tags. */
function foregroundText(res: Record<string, unknown>): string {
  const content = Array.isArray(res.content) ? res.content : [];
  return content
    .map((b) => str(obj(b).text))
    .filter((t) => t && !/^\s*<tools-used-before-summary>/.test(t))
    .join("\n")
    .trim();
}

export function applyWords(
  reqs: RequestView[],
  events: MurmurEvent[][],
  agents: Map<string, AgentView>,
  started: Map<string, string>,
): void {
  // Reports, in time order across requests: a later one replaces an earlier.
  const reportAt = new Map<string, string>(); // event id -> agent id
  for (const list of events)
    for (const e of list) {
      const got = reportOf(e, started);
      const agent = got && agents.get(got.agentId);
      if (!got || !agent) continue;
      agent.report = got.report;
      reportAt.set(e.id, agent.id);
    }
  for (const agent of agents.values()) {
    const brief = briefOf(agent.prompt);
    if (brief) agent.brief = brief;
  }
  reqs.forEach((req, i) => {
    req.messages = messagesOf(req, events[i] ?? [], reportAt);
  });
}

function reportOf(
  e: MurmurEvent,
  started: Map<string, string>,
): { agentId: string; report: AgentReport } | undefined {
  if (e.hook === "UserPromptSubmit") {
    const n = parseNotification(str(e.payload.prompt), e.ts);
    const agentId = n && started.get(n.use);
    return n && agentId ? { agentId, report: n.report } : undefined;
  }
  if (e.hook !== "PostToolUse" || e.payload.tool_name !== "Agent") return;
  const res = obj(e.payload.tool_response);
  if (res.isAsync === true || res.status === "async_launched") return;
  const agentId =
    str(res.agentId) || started.get(str(e.payload.tool_use_id)) || "";
  const text = foregroundText(res);
  if (!agentId || !text) return;
  const verdict = verdictOf(text);
  return {
    agentId,
    report: {
      status: str(res.status) || "completed",
      summary: "",
      text,
      ...(verdict ? { verdict } : {}),
      ts: e.ts,
      interim: false,
    },
  };
}

// A turn ends at these; a report links the messages after it until one comes.
const ENDS_TURN = (e: MurmurEvent) =>
  e.hook === "Stop" ||
  e.hook === "UserPromptSubmit" ||
  (e.hook === "PreToolUse" && e.payload.tool_name === "Agent");

function messagesOf(
  req: RequestView,
  events: MurmurEvent[],
  reportAt: Map<string, string>,
): MessageView[] {
  const out: MessageView[] = [];
  const tasks = req.phases.flatMap((ph) => ph.tasks);
  let agent: string | undefined;
  for (const e of events) {
    const by = reportAt.get(e.id);
    if (by) {
      agent = by;
      continue;
    }
    if (ENDS_TURN(e)) agent = undefined;
    if (e.hook !== "AssistantText" || e.payload.agent_id) continue;
    const text = str(e.payload.text);
    if (!text.trim()) continue;
    const task = taskOf(text, tasks, req);
    out.push({
      id: e.id,
      ts: e.ts,
      text,
      ...(task ? { task } : {}),
      ...(agent ? { agent } : {}),
    });
  }
  return out;
}

type Subject =
  | { kind: "task"; from: number; to: number }
  | { kind: "item"; id: number };

const SUBJECT =
  /\b(?:tasks?\s+(\d+)(?:\s*(?:[-–]|and|&)\s*(\d+))?|(?:bug\s+b?|b)(\d+))\b/gi;

/** Every subject a text names: `Task 1`, `Tasks 4-5`, `Tasks 4 and 5`, `B7`, `bug B1`. */
export function subjectsOf(text: string): Subject[] {
  return [...text.matchAll(SUBJECT)].map((m) => {
    if (m[3]) return { kind: "item", id: Number(m[3]) };
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    return { kind: "task", from: Math.min(from, to), to: Math.max(from, to) };
  });
}

const covers = (key: Subject, s: Subject) =>
  key.kind === "task" && s.kind === "task"
    ? key.from <= s.from && s.to <= key.to
    : key.kind === "item" && s.kind === "item" && key.id === s.id;

function taskOf(
  text: string,
  tasks: TaskView[],
  req: RequestView,
): string | undefined {
  const partTitle = (t: TaskView) =>
    req.parts.find((p) => p.id === t.part)?.title ?? "";
  const named = subjectsOf(text);
  if (named.length) {
    // Each task's own subject, from its title or its part's (an inferred part's id is one too).
    const keyed = tasks.flatMap((t) => {
      const keys = subjectsOf(`${t.title}\n${partTitle(t)}`);
      return keys.length ? [{ t, key: keys[0] as Subject }] : [];
    });
    const hit = new Set<TaskView>();
    for (const s of named) {
      const by = keyed.filter((k) => covers(k.key, s));
      if (by.length !== 1) return undefined;
      hit.add((by[0] as { t: TaskView }).t);
    }
    return hit.size === 1 ? [...hit][0]?.id : undefined;
  }
  if (req.planInferred) return undefined;
  const has = (title: string) =>
    title.length >= 8 && text.toLowerCase().includes(title.toLowerCase());
  const byTask = tasks.filter((t) => has(t.title));
  if (byTask.length === 1) return byTask[0]?.id;
  if (byTask.length > 1) return undefined;
  const parts = req.parts.filter((p) => has(p.title));
  const own = tasks.filter((t) => t.part === parts[0]?.id);
  return parts.length === 1 && own.length === 1 ? own[0]?.id : undefined;
}

const BRIEF_MAX = 600;
// A sentence that only points at something to read, or a label then a path.
const POINTER =
  /^(?:please\s+)?(?:first\s+)?(?:then\s+)?(?:read|look at|see|study|open|check out|follow)\b|^[\w ()-]{1,40}:\s*(?:`?[~.]?\/|https?:)/i;
// A sentence that gives working rules.
const RULE =
  /^(?:read-only\b|never\b|do not\b|don't\b|always\b|work (?:and commit )?only\b|commit\b|no\s+co-author|rules?:|you must\b|keep it\b)/i;
const SENTENCE = /(?<=[.!?])\s+(?=[A-Z0-9"'`(*[])/;

const plain = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What a helper was asked to do: the paragraph under a `## Context` heading when there
 * is one, else the first paragraph left once headings, pointer sentences ("Read the
 * brief first: /path"), rule sentences ("Never use git stash.") and lead-ins ending
 * in a colon are dropped. Plain
 * text, at most 600 characters, cut at a sentence end.
 */
export function briefOf(prompt: string): string | undefined {
  const context = /^#{1,6}\s*context\s*$/im.exec(prompt);
  const body = context
    ? prompt.slice(context.index + context[0].length)
    : prompt;
  for (const para of body.split(/\n\s*\n/)) {
    if (/^\s*#/.test(para) && !para.trim().includes("\n")) continue;
    const lines = para.split("\n").filter((l) => !/^\s*#/.test(l));
    const kept = plain(lines.join("\n"))
      .split(SENTENCE)
      // A lead-in ("Your screens:") says nothing without the list after it.
      .filter((s) => !POINTER.test(s) && !RULE.test(s) && !s.endsWith(":"))
      .join(" ")
      .trim();
    if (kept) return cutAtSentence(kept, BRIEF_MAX);
    if (context) return undefined;
  }
  return undefined;
}

function cutAtSentence(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const end = Math.max(...[". ", "! ", "? "].map((p) => head.lastIndexOf(p)));
  if (end > 0) return head.slice(0, end + 1);
  return `${head.slice(0, head.lastIndexOf(" ")).trimEnd()}…`;
}
