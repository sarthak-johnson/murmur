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
  // Claude says "blocked" on its own when it waits on the user; read it as failed.
  taskStatus: z.union([status, z.literal("blocked")]).optional(),
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
 * one line per task on how it ended. Every part a task or a detail names is in the map,
 * and part and task ids are unique.
 * The plugin turns it into `map` and `narrate` calls.
 */
export const RecapInput = z
  .object({
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
  })
  // A recap that names a part its map lacks would draw tasks and detail on nothing.
  .refine(({ map, parts }) => {
    const ids = new Set(map.parts.map((p) => p.id));
    const tasks = map.phases.flatMap((ph) => ph.tasks);
    return (
      tasks.every((t) => t.part === undefined || ids.has(t.part)) &&
      parts.every((p) => ids.has(p.id))
    );
  }, "every part a task or detail names is in the map")
  // Two parts or tasks with one id would merge into one, or one would vanish.
  .refine(({ map, parts, tasks }) => {
    const once = (ids: string[]) => new Set(ids).size === ids.length;
    return (
      once(map.parts.map((p) => p.id)) &&
      once(map.phases.flatMap((ph) => ph.tasks.map((t) => t.id))) &&
      once(parts.map((p) => p.id)) &&
      once(tasks.map((t) => t.id))
    );
  }, "part and task ids are unique");
export type RecapInput = z.infer<typeof RecapInput>;
