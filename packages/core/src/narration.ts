import { z } from "zod";

export const MAP_TOOL = "mcp__plugin_murmur_murmur__map";
export const NARRATE_TOOL = "mcp__plugin_murmur_murmur__narrate";

const text = z.string().max(300);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(20);
// Claude often says these in its own words ("in_progress", "completed"); a refused
// narrate makes it retry, so the common ones map onto the three Murmur knows.
const STATUS_WORDS: Record<string, string> = {
  in_progress: "running",
  "in-progress": "running",
  started: "running",
  working: "running",
  complete: "done",
  completed: "done",
  finished: "done",
  passed: "done",
  error: "failed",
  errored: "failed",
};
const said = (v: unknown) =>
  typeof v === "string"
    ? (STATUS_WORDS[v.toLowerCase()] ?? v.toLowerCase())
    : v;
const status = z.preprocess(said, z.enum(["running", "done", "failed"]));

export const MapInput = z.object({
  kind: z.enum(["feature", "bug", "refactor", "question"]),
  goal: text,
  // What the request does in 2 to 5 words, for a list of requests ("Restyle the app"),
  // never the user's own words ("Yes").
  short: z.string().max(60).optional(),
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
  taskStatus: z
    .preprocess(
      (v) => (v === "waiting" || v === "on_hold" ? "blocked" : said(v)),
      z.enum(["running", "done", "failed", "blocked"]),
    )
    .optional(),
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

/** Part detail as `narrate` carries it, by part id: what a recap or a refresh says of a part. */
const PartDetail = NarrateInput.pick({
  aim: true,
  choices: true,
  checks: true,
  words: true,
  files: true,
}).extend({ id: text });
/** One task's status and one line on how it ended or stands. */
const TaskEnd = z.object({ id: text, status, ended: z.string().max(200) });
const unique = (ids: string[]) => new Set(ids).size === ids.length;

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
      PartDetail.extend({
        steps: list(z.object({ text, status })).optional(),
        helpers: z.array(text).max(40).optional(),
      }),
    ),
    tasks: z.array(TaskEnd).max(100),
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
  .refine(
    ({ map, parts, tasks }) =>
      unique(map.parts.map((p) => p.id)) &&
      unique(map.phases.flatMap((ph) => ph.tasks.map((t) => t.id))) &&
      unique(parts.map((p) => p.id)) &&
      unique(tasks.map((t) => t.id)),
    "part and task ids are unique",
  );
export type RecapInput = z.infer<typeof RecapInput>;

/**
 * What a refresh asks the user's own Claude for, about a request Claude mapped itself
 * but stopped narrating: each task's status and one line on how it ended or stands, and
 * part detail, by the ids of the request's map as it stands (the plugin refuses an id
 * that map lacks). No map: the request keeps the one Claude drew.
 */
export const RefreshInput = z
  .object({ tasks: z.array(TaskEnd).max(100), parts: list(PartDetail) })
  .refine(
    ({ parts, tasks }) =>
      unique(parts.map((p) => p.id)) && unique(tasks.map((t) => t.id)),
    "part and task ids are unique",
  );
export type RefreshInput = z.infer<typeof RefreshInput>;

/**
 * Murmur's own tool name for a titles run's answer: never a real tool. The plugin queues
 * one `PostToolUse` event per run with this `tool_name`, the answer as `tool_input`, and
 * `recap: true` and `titles: true` on the payload, timed a millisecond after the latest
 * event the run read. Core takes it out of the session before reading requests, so no
 * pass sees it as work, and reads it only for titles and storylines.
 */
export const TITLES_TOOL = "murmur:titles";

const KINDS = MapInput.shape.kind;
const id = z.string().min(1).max(100);
const title = (max: number) => z.string().trim().min(1).max(max);

/**
 * What a titles run asks the user's own Claude for, about up to 80 requests of one
 * session: a name for the session, the session's storylines, and per request a title
 * (`short`), a one-line goal, the kind, its storyline and, when it picks up a different,
 * earlier request than the one before it in its storyline, that request (`follows`).
 * A request's `id` (and `follows`) is its key (`requestKeys`): its `prompt_id`, which the
 * live hook and the transcript share. Every storyline a request names is listed, ids are
 * unique, and `follows` names another request of the answer. The plugin asks with short
 * labels ("r1") and checks they are the ones it asked about before turning them into keys.
 */
export const TitlesInput = z
  .object({
    session: z.object({ title: title(48) }),
    threads: z.array(z.object({ id, title: title(40) })).max(30),
    requests: z
      .array(
        z.object({
          id,
          short: title(40),
          goal: title(120),
          kind: KINDS,
          thread: id,
          follows: id.optional(),
        }),
      )
      .max(80),
  })
  .refine(({ threads, requests }) => {
    const ids = new Set(threads.map((t) => t.id));
    return requests.every((r) => ids.has(r.thread));
  }, "every thread a request names is listed")
  .refine(
    ({ threads, requests }) =>
      unique(threads.map((t) => t.id)) && unique(requests.map((r) => r.id)),
    "thread and request ids are unique",
  )
  .refine(({ requests }) => {
    const ids = new Set(requests.map((r) => r.id));
    return requests.every(
      (r) =>
        r.follows === undefined || (r.follows !== r.id && ids.has(r.follows)),
    );
  }, "follows names another request of the answer");
export type TitlesInput = z.infer<typeof TitlesInput>;
