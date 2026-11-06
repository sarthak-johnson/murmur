import { readFileSync } from "node:fs";
import type { HookName, MurmurEvent } from "../src/events.js";
import { MAP_TOOL, NARRATE_TOOL } from "../src/narration.js";

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
