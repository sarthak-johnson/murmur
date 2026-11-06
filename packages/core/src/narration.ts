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

/**
 * What the recap asks the user's own Claude for, about one imported request it never
 * mapped: the `map` input, each part's detail as `narrate` carries it (plus its steps,
 * the paths it changed and the helpers, by their `H<n>` label, that worked on it), and
 * one line per task on how it ended. The plugin turns it into `map` and `narrate` calls.
 */
export const RecapInput = z.object({
  map: MapInput,
  parts: list(
    NarrateInput.pick({
      aim: true,
      choices: true,
      checks: true,
      words: true,
      files: true,
    }).extend({
      id: text,
      steps: list(z.object({ text, status })).optional(),
      helpers: z.array(text).max(40).optional(),
    }),
  ),
  tasks: z
    .array(z.object({ id: text, status, ended: z.string().max(200) }))
    .max(100),
});
export type RecapInput = z.infer<typeof RecapInput>;
