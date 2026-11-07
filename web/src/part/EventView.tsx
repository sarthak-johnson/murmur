/*
 * One event as what it is: a command as a terminal block, an Edit or Write as a diff,
 * a Read as its path, a helper call as its brief and report, a narrate or map call as
 * its text, any other tool as its name and main inputs. The raw event stays one small
 * "Event data" toggle away, at the bottom.
 */
import {
  type AgentView,
  MAP_TOOL,
  type MurmurEvent,
  NARRATE_TOOL,
} from "@murmur/core";
import { type ReactNode, useState } from "react";
import { PathText } from "../files";
import { Markdown } from "../markdown";
import { Pill } from "../Pill";
import { verdictOf } from "../story";
import { created, DiffView, type Hunk, hunksOfEvent } from "./Diff";

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The call, its result and its failure, found through the tool use id. */
function callOf(id: string, events: MurmurEvent[]) {
  const e = events.find((x) => x.id === id);
  if (!e) return undefined;
  const use = str(e.payload.tool_use_id);
  const same = (x: MurmurEvent) =>
    x.id === id || (!!use && str(x.payload.tool_use_id) === use);
  const pre = events.find((x) => same(x) && x.hook === "PreToolUse");
  const post = events.find((x) => same(x) && x.hook === "PostToolUse");
  const fail = events.find((x) => same(x) && x.hook === "PostToolUseFailure");
  const any = pre ?? post ?? fail ?? e;
  return {
    event: e,
    all: [pre, post, fail].filter((x): x is MurmurEvent => !!x),
    tool: str(any.payload.tool_name),
    input: obj((pre ?? post ?? fail ?? e).payload.tool_input),
    post,
    fail,
  };
}
type Call = NonNullable<ReturnType<typeof callOf>>;

const SHOWN = 12;

function Output({ text, className }: { text: string; className?: string }) {
  const [all, setAll] = useState(false);
  const lines = text.replace(/\n+$/, "").split("\n");
  if (!text.trim()) return null;
  const shown = all ? lines : lines.slice(0, SHOWN);
  return (
    <>
      <pre className={className ?? "term-out"}>{shown.join("\n")}</pre>
      {lines.length > SHOWN && (
        <button
          type="button"
          className="link term-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer lines" : `Show all ${lines.length} lines`}
        </button>
      )}
    </>
  );
}

function Command({ call }: { call: Call }) {
  const { input, post, fail } = call;
  const res = obj(post?.payload.tool_response);
  const failText = str(fail?.payload.tool_response) || str(fail?.payload.error);
  const code = /exit code (\d+)/i.exec(failText)?.[1];
  const status = fail
    ? code
      ? { label: `Failed, exit ${code}`, tone: "bad" as const }
      : { label: "Failed", tone: "bad" as const }
    : post
      ? res.interrupted
        ? { label: "Interrupted", tone: "warn" as const }
        : { label: "Succeeded", tone: "done" as const }
      : { label: "No result yet", tone: "plain" as const };
  const out = fail
    ? failText.replace(/^Error:\s*Exit code \d+\s*\n?/i, "")
    : [str(res.stdout), str(res.stderr)].filter((s) => s.trim()).join("\n");
  return (
    <div className="term">
      <div className="term-hd">
        <span className="term-title">
          {str(input.description) || "Command"}
        </span>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      <pre className="term-cmd">
        <span className="term-prompt" aria-hidden="true">
          ${" "}
        </span>
        <span>{str(input.command)}</span>
      </pre>
      <Output text={out} />
    </div>
  );
}

function FileChange({ call, cwd }: { call: Call; cwd: string }) {
  const { tool, input, post, fail } = call;
  const res = obj(post?.payload.tool_response);
  const path = str(res.filePath) || str(input.file_path);
  let hunks: Hunk[] = hunksOfEvent(post);
  if (!hunks.length && tool === "Write" && str(input.content))
    hunks = [created(str(input.content))];
  if (!hunks.length && tool === "Edit") {
    const del = str(input.old_string)
      .split("\n")
      .map((l) => `-${l}`);
    const add = str(input.new_string)
      .split("\n")
      .map((l) => `+${l}`);
    hunks = [
      {
        oldStart: 1,
        oldLines: del.length,
        newStart: 1,
        newLines: add.length,
        lines: [...del, ...add],
      },
    ];
  }
  const verb =
    tool === "Edit" ? "Edited" : res.type === "create" ? "Created" : "Wrote";
  return (
    <div className="ev-file">
      <p className="ev-line">
        {verb} <PathText path={path} cwd={cwd} />
        {fail && <Pill tone="bad">Failed</Pill>}
      </p>
      <DiffView hunks={hunks} />
    </div>
  );
}

function ReadFile({ call, cwd }: { call: Call; cwd: string }) {
  const { input } = call;
  const offset = Number(input.offset);
  const limit = Number(input.limit);
  const range =
    offset && limit
      ? `lines ${offset} to ${offset + limit - 1}`
      : offset
        ? `from line ${offset}`
        : "";
  return (
    <p className="ev-line">
      Read <PathText path={str(input.file_path) || str(input.path)} cwd={cwd} />
      {range && <span className="muted"> {range}</span>}
    </p>
  );
}

const MODEL = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);

/** A helper: what it was asked, and what it reported. */
export function HelperCall(props: {
  call: Call;
  agent?: AgentView | undefined;
}) {
  const { call, agent } = props;
  const [brief, setBrief] = useState(false);
  const prompt = str(call.input.prompt) || agent?.prompt || "";
  const model = str(call.input.model);
  const verdict = verdictOf(agent?.report);
  return (
    <div className="ev-helper">
      <p className="ev-line">
        <b>{str(call.input.description) || agent?.description || "A helper"}</b>
        {model && <span className="muted"> {MODEL(model)}</span>}
      </p>
      {agent?.brief ? (
        <p className="ev-brief">{agent.brief}</p>
      ) : (
        prompt && <Markdown text={prompt} className="reading" />
      )}
      {agent?.brief && prompt && (
        <>
          <button
            type="button"
            className="link"
            aria-expanded={brief}
            onClick={() => setBrief(!brief)}
          >
            {brief ? "Hide the full brief" : "The full brief"}
          </button>
          {brief && <Markdown text={prompt} className="reading" />}
        </>
      )}
      {agent?.report && (
        <div className="ev-report">
          <div className="ev-report-hd">
            <span>Report</span>
            {verdict && <Pill tone={verdict.tone}>{verdict.label}</Pill>}
          </div>
          <Markdown text={agent.report.text} className="reading" />
        </div>
      )}
    </div>
  );
}

function Narrate({ input }: { input: Record<string, unknown> }) {
  const step = obj(input.step);
  return (
    <div className="ev-narrate">
      {str(input.now) && <p className="ev-now">{str(input.now)}</p>}
      {str(input.why) && <p className="muted">{str(input.why)}</p>}
      {str(step.text) && (
        <p className="ev-line">
          <span className="muted">Step: </span>
          {str(step.text)}
        </p>
      )}
    </div>
  );
}

function MapCall({ input }: { input: Record<string, unknown> }) {
  return (
    <div className="ev-map">
      <p className="ev-now">{str(input.goal)}</p>
      {list(input.phases).map((ph, i) => {
        const p = obj(ph);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed plan
          <div key={i} className="ev-phase">
            <b>{str(p.title)}</b>
            <ul>
              {list(p.tasks).map((t, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed plan
                <li key={j}>{str(obj(t).title)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const human = (s: string) => {
  const w = s.replace(/[_-]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** "mcp__claude-in-chrome__navigate" reads as "Navigate" from "claude-in-chrome". */
function toolName(tool: string): { name: string; from?: string } {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!m) return { name: tool };
  const server = (m[1] as string)
    .replace(/^plugin_([^_]+)_\1$/, "$1")
    .replace(/^plugin_/, "");
  return { name: human(m[2] as string), from: server };
}

/** A response's readable text: a string, or the text parts of a content list. */
function responseText(v: unknown): string {
  if (typeof v === "string") return v;
  const parts = list(v)
    .map((p) => str(obj(p).text))
    .filter(Boolean);
  if (parts.length) return parts.join("\n");
  const o = obj(v);
  return str(o.text) || str(o.message) || str(o.content) || "";
}

function OtherTool({ call }: { call: Call }) {
  const { name, from } = toolName(call.tool);
  const inputs = Object.entries(call.input).filter(
    ([k]) => k !== "description",
  );
  const value = (v: unknown): ReactNode => {
    if (typeof v === "string")
      return v.length > 240 ? `${v.slice(0, 240)}…` : v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v))
      return `${v.length} ${v.length === 1 ? "item" : "items"}`;
    const n = Object.keys(obj(v)).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  };
  const out = responseText(
    call.post?.payload.tool_response ?? call.fail?.payload.tool_response,
  );
  return (
    <div className="ev-tool">
      <p className="ev-line">
        <b>{name}</b>
        {from && <span className="muted"> from {from}</span>}
        {call.fail && <Pill tone="bad">Failed</Pill>}
      </p>
      {str(call.input.description) && (
        <p className="muted">{str(call.input.description)}</p>
      )}
      {inputs.length > 0 && (
        <dl className="ev-inputs">
          {inputs.slice(0, 8).map(([k, v]) => (
            <div key={k}>
              <dt>{human(k)}</dt>
              <dd>{value(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Output text={out} className="ev-out" />
    </div>
  );
}

function Body(props: { call: Call; cwd: string; agents: AgentView[] }) {
  const { call, cwd, agents } = props;
  const { tool, input } = call;
  if (tool === "Bash") return <Command call={call} />;
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit")
    return <FileChange call={call} cwd={cwd} />;
  if (tool === "Read") return <ReadFile call={call} cwd={cwd} />;
  if (tool === "Agent" || tool === "Task") {
    const prompt = str(input.prompt);
    const agent = agents.find((a) => prompt && a.prompt === prompt);
    return <HelperCall call={call} agent={agent} />;
  }
  if (tool === NARRATE_TOOL) return <Narrate input={input} />;
  if (tool === MAP_TOOL) return <MapCall input={input} />;
  if (tool) return <OtherTool call={call} />;
  const p = call.event.payload;
  return (
    <p className="ev-line">
      {str(p.prompt) || str(p.last_assistant_message) || human(call.event.hook)}
    </p>
  );
}

/** The raw event, only on request. */
export function EventData({ events }: { events: MurmurEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ev-data">
      <button
        type="button"
        className="link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Event data
      </button>
      {open && (
        <pre className="ev-json">
          {JSON.stringify(events.length === 1 ? events[0] : events, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function EventView(props: {
  eventId: string;
  events: MurmurEvent[];
  cwd?: string;
  agents?: AgentView[];
}) {
  const { eventId, events, cwd = "", agents = [] } = props;
  const call = callOf(eventId, events);
  if (!call) return <p className="muted small">This event is not loaded.</p>;
  return (
    <div className="ev">
      <Body call={call} cwd={cwd} agents={agents} />
      <EventData events={call.all.length ? call.all : [call.event]} />
    </div>
  );
}
