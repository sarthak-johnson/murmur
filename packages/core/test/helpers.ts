import type { MurmurEvent } from "../src/events.js";

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
