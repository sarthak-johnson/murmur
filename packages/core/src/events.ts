import { z } from "zod";

export const HOOK_NAMES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "PermissionRequest",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "PreCompact",
  "PostCompact",
  // Not a Claude Code hook: Murmur reads it from the transcript (see AssistantTextPayload).
  "AssistantText",
] as const;

export type HookName = (typeof HOOK_NAMES)[number];

/**
 * The payload of an `AssistantText` event: one non-empty text block Claude wrote to the
 * user on the main thread (a subagent's text never becomes one). Claude Code has no such
 * hook; the plugin reads these from the session transcript, in the backfill and in the
 * detached upload child, with the same id for the same block either way.
 */
export interface AssistantTextPayload {
  text: string;
  session_id: string;
  cwd: string;
  hook_event_name: "AssistantText";
}

export interface MurmurEvent {
  id: string;
  sessionId: string;
  machineId: string;
  cwd: string;
  ts: string;
  hook: HookName;
  payload: Record<string, unknown>;
}

export const MurmurEventSchema: z.ZodType<MurmurEvent> = z.object({
  id: z.string(),
  sessionId: z.string(),
  machineId: z.string(),
  cwd: z.string(),
  ts: z.string(),
  hook: z.enum(HOOK_NAMES),
  payload: z.record(z.string(), z.unknown()),
});
