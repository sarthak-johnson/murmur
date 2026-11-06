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
] as const;

export type HookName = (typeof HOOK_NAMES)[number];

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
