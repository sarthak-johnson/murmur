import { z } from "zod";

export const MAP_TOOL = "mcp__plugin_murmur_murmur__map";
export const NARRATE_TOOL = "mcp__plugin_murmur_murmur__narrate";

const text = z.string().max(300);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(20);
const status = z.enum(["running", "done", "failed"]);

export const MapInput = z.object({
  kind: z.enum(["feature", "bug", "refactor", "question"]),
  goal: text,
  phases: list(
    z.object({
      id: text,
      title: text,
      tasks: list(z.object({ id: text, title: text, part: text.optional() })),
    }),
  ),
  parts: list(
    z.object({
      id: text,
      title: text,
      phase: text.optional(),
      tag: z
        .enum([
          "symptom",
          "suspect",
          "ruled_out",
          "cause",
          "fix",
          "before",
          "after",
          "source",
          "answer",
        ])
        .optional(),
      links: list(z.object({ to: text, label: text })).optional(),
    }),
  ),
});
export type MapInput = z.infer<typeof MapInput>;

export const NarrateInput = z.object({
  now: z.string().max(200),
  why: z.string().max(200),
  part: text.optional(),
  task: text.optional(),
  taskStatus: status.optional(),
  step: z.object({ text, status }).optional(),
  aim: z.object({ aim: text, doneWhen: text }).optional(),
  io: z.object({ gets: text, gives: text }).optional(),
  files: list(z.object({ path: text, role: text })).optional(),
  choices: list(
    z.object({ choice: text, reason: text, assumption: z.boolean() }),
  ).optional(),
  checks: list(
    z.object({ check: text, status: z.enum(["pass", "fail", "untried"]) }),
  ).optional(),
  words: list(z.object({ term: text, meaning: text })).optional(),
});
export type NarrateInput = z.infer<typeof NarrateInput>;
