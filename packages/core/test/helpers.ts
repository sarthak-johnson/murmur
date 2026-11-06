import { readFileSync } from "node:fs";
import type { HookName, MurmurEvent } from "../src/events.js";
import { MAP_TOOL, type MapInput, NARRATE_TOOL } from "../src/narration.js";

const BASE = Date.parse("2026-11-06T00:00:00.000Z");

export function ev(payload: Record<string, unknown>): MurmurEvent {
  return {
    id: "e1",
    sessionId: "s1",
    machineId: "m1",
    cwd: "/p",
    ts: "2026-11-06T00:00:00.000Z",
    hook: "PostToolUse",
    payload,
  };
}

/** Event number `n`: id `e<n>`, ts `n` seconds after a fixed base. */
export function at(
  n: number,
  hook: HookName,
  payload: Record<string, unknown> = {},
): MurmurEvent {
  return {
    ...ev(payload),
    id: `e${n}`,
    ts: new Date(BASE + n * 1000).toISOString(),
    hook,
  };
}

export const prompt = (n: number, text: string) =>
  at(n, "UserPromptSubmit", { prompt: text });

export const tool = (
  n: number,
  name: string,
  input: unknown,
  hook: HookName = "PostToolUse",
) => at(n, hook, { tool_name: name, tool_input: input, tool_use_id: `t${n}` });

export const mapCall = (n: number, input: unknown) => tool(n, MAP_TOOL, input);
export const narrateCall = (n: number, input: unknown) =>
  tool(n, NARRATE_TOOL, input);

/** A recorded fixture as events, ids and ts taken from line order. */
export function fixture(name: string): MurmurEvent[] {
  const url = new URL(`../../../e2e/fixtures/${name}`, import.meta.url);
  return readFileSync(url, "utf8")
    .trim()
    .split("\n")
    .map((line, i) => {
      const { hook, payload } = JSON.parse(line);
      return {
        ...at(i, hook, payload),
        sessionId: payload.session_id,
        cwd: payload.cwd,
      };
    });
}

/** Two phases, parts `db` (task 1.1) and `api` (tasks 2.1, 2.2). */
export const MAP: MapInput = {
  kind: "feature",
  goal: "Price alerts",
  phases: [
    {
      id: "1",
      title: "Data",
      tasks: [{ id: "1.1", title: "Alerts table", part: "db" }],
    },
    {
      id: "2",
      title: "API",
      tasks: [
        { id: "2.1", title: "Endpoint to save an alert", part: "api" },
        { id: "2.2", title: "Endpoint to list alerts", part: "api" },
      ],
    },
  ],
  parts: [
    { id: "db", title: "Alerts table", phase: "1", tag: "source" },
    {
      id: "api",
      title: "Alerts API",
      phase: "2",
      links: [{ to: "db", label: "writes" }],
    },
  ],
};

export const note = (extra: Record<string, unknown> = {}) => ({
  now: "Writing the save endpoint",
  why: "the screen needs it",
  ...extra,
});

/** A successful Edit of `path` (relative to cwd `/p`) with patch `lines`. */
export const edit = (n: number, path: string, lines: string[]) =>
  at(n, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: `t${n}`,
    tool_input: { file_path: `/p/${path}` },
    tool_response: {
      filePath: `/p/${path}`,
      structuredPatch: [{ oldStart: 1, newStart: 1, lines }],
    },
  });

/** A successful Write of `path` (relative to cwd `/p`). */
export const write = (
  n: number,
  path: string,
  content: string,
  type: "create" | "update" = "create",
  lines: string[] = [],
) =>
  at(n, "PostToolUse", {
    tool_name: "Write",
    tool_use_id: `t${n}`,
    tool_input: { file_path: `/p/${path}`, content },
    tool_response: {
      type,
      filePath: `/p/${path}`,
      content,
      structuredPatch: lines.length ? [{ lines }] : [],
    },
  });
