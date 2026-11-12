import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAP_TOOL, type MurmurEvent, reduce } from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { readBackfill } from "../src/backfill.js";
import { handleHook } from "../src/hook.js";
import {
  queueDir,
  readSession,
  setPaused,
  setProjectState,
  updateSession,
  writeCredentials,
} from "../src/local.js";
import {
  killRecaps,
  lastRequestOpen,
  recapInput,
  runRecap,
} from "../src/recap.js";

const SID = "33333333-2222-4333-8444-555555555555";
const t = (s: number) =>
  new Date(Date.parse("2026-11-07T09:00:00.000Z") + s * 1000).toISOString();

let dir: string;
let bin: string;
let cwd: string;
let events: MurmurEvent[];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-recap-"));
  process.env.MURMUR_HOME = path.join(dir, "murmur");
  bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  cwd = path.join(dir, "repo");
  writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
  setProjectState(cwd, "on");
  updateSession(SID, { backfill: "done", cwd, project: cwd });
  const line = (o: Record<string, unknown>) => JSON.stringify({ cwd, ...o });
  const file = path.join(dir, `${SID}.jsonl`);
  fs.writeFileSync(
    file,
    [
      line({
        type: "user",
        uuid: "u1",
        timestamp: t(1),
        origin: { kind: "human" },
        message: { content: "Build the lit plate tokens" },
      }),
      line({
        type: "assistant",
        uuid: "u2",
        timestamp: t(2),
        message: {
          content: [
            { type: "text", text: "Sending Task 1 to a builder." },
            {
              type: "tool_use",
              id: "toolu_a",
              name: "Agent",
              input: {
                description: "Implement Task 1: tokens",
                prompt: "## Context\n\nAdd the gain and loss tokens.",
              },
            },
          ],
        },
      }),
      line({
        type: "assistant",
        uuid: "u3",
        timestamp: t(3),
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_e",
              name: "Edit",
              input: { file_path: `${cwd}/src/index.css` },
            },
          ],
        },
      }),
      line({
        type: "user",
        uuid: "u4",
        timestamp: t(4),
        toolUseResult: {
          filePath: `${cwd}/src/index.css`,
          structuredPatch: [{ lines: ["-a", "+b"] }],
        },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_e", content: "ok" },
          ],
        },
      }),
      line({
        type: "assistant",
        uuid: "u5",
        timestamp: t(5),
        message: { content: [{ type: "text", text: "Task 1 is in." }] },
      }),
    ].join("\n"),
  );
  events = readBackfill({
    sessionId: SID,
    machineId: "m1",
    cwd,
    transcriptPath: file,
    cutoff: t(100),
  });
});

const RECAP = {
  map: {
    kind: "feature",
    goal: "Lit plate tokens",
    phases: [
      {
        id: "p1",
        title: "Tokens",
        tasks: [{ id: "t1", title: "Gain and loss tokens", part: "tokens" }],
      },
    ],
    parts: [{ id: "tokens", title: "Gain and loss tokens", phase: "p1" }],
  },
  parts: [
    {
      id: "tokens",
      aim: {
        aim: "Brighter gain and loss colours",
        doneWhen: "Tokens match the prototype",
      },
      steps: [{ text: "Added the tokens", status: "done" }],
      choices: [
        {
          choice: "Dark by default",
          reason: "the prototype is dark",
          assumption: false,
        },
      ],
      checks: [{ check: "Token test", status: "pass" }],
      words: [{ term: "lit plate", meaning: "the one glowing card" }],
      files: [{ path: "src/index.css", role: "the tokens" }],
      helpers: ["H1"],
    },
  ],
  tasks: [{ id: "t1", status: "done", ended: "Merged after one review." }],
};
/** A fake `claude` on PATH: logs its args and stdin, then runs `body`. */
function fake(body: string) {
  const file = path.join(bin, "claude");
  fs.writeFileSync(
    file,
    `#!/bin/sh\necho "$@" >> "${dir}/args.log"\ncat > "${dir}/stdin.txt"\n${body}\n`,
  );
  fs.chmodSync(file, 0o755);
}
const answer = (result: unknown) =>
  `cat <<'JSON'\n${JSON.stringify([
    { type: "system", subtype: "init" },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1200,
      total_cost_usd: 0.01,
      result: typeof result === "string" ? result : JSON.stringify(result),
    },
  ])}\nJSON`;
const env = (extra: Record<string, string> = {}) => ({
  PATH: `${bin}:/usr/bin:/bin`,
  CLAUDE_CODE_ENTRYPOINT: "cli",
  ...extra,
});
const queued = () => {
  let names: string[] = [];
  try {
    names = fs.readdirSync(queueDir()).sort();
  } catch {}
  return names.map(
    (n) =>
      JSON.parse(
        fs.readFileSync(path.join(queueDir(), n), "utf8"),
      ) as MurmurEvent,
  );
};
const calls = () =>
  fs.existsSync(`${dir}/args.log`)
    ? fs.readFileSync(`${dir}/args.log`, "utf8").trim().split("\n")
    : [];

describe("recap", () => {
  it("asks the user's own Claude once, with no tools, hooks, plugins or saved session", async () => {
    fake(answer(RECAP));
    expect(await runRecap(SID, events, { env: env() })).toEqual({
      ran: 1,
      ok: 1,
    });
    const args = calls()[0] as string;
    for (const flag of [
      "-p",
      "--model sonnet",
      "--output-format json",
      "--tools ",
      "--max-turns 1",
      "--no-session-persistence",
      "--safe-mode",
      "--strict-mcp-config",
      '{"disableAllHooks":true}',
    ])
      expect(args).toContain(flag);
    const stdin = fs.readFileSync(`${dir}/stdin.txt`, "utf8");
    for (const part of [
      "Build the lit plate tokens",
      "Sending Task 1 to a builder.",
      "Task 1 is in.",
      "H1",
      "Implement Task 1: tokens",
      "Add the gain and loss tokens.",
      "src/index.css",
    ])
      expect(stdin).toContain(part);
  });

  it("draws the request on the narrated path, marked as a recap", async () => {
    fake(answer(`\`\`\`json\n${JSON.stringify(RECAP)}\n\`\`\``));
    await runRecap(SID, events, { env: env() });
    const out = queued();
    expect(out.every((e) => e.payload.recap === true)).toBe(true);
    expect(out[0]?.payload.tool_name).toBe(MAP_TOOL);
    // Deterministic ids and times just after the prompt.
    expect(out.every((e) => e.ts > t(1) && e.ts < t(2))).toBe(true);
    const [req] = reduce([...events, ...out]).requests;
    expect(req).toMatchObject({
      recap: true,
      planInferred: false,
      goal: "Lit plate tokens",
    });
    expect(req?.phases[0]?.tasks[0]).toMatchObject({
      id: "t1",
      status: "done",
    });
    const part = req?.parts[0];
    expect(part).toMatchObject({
      aim: {
        aim: "Brighter gain and loss colours",
        doneWhen: "Tokens match the prototype",
      },
      checks: [{ check: "Token test", status: "pass" }],
      words: [{ term: "lit plate", meaning: "the one glowing card" }],
    });
    expect(part?.steps.map((s) => s.text)).toEqual([
      "Added the tokens",
      "Merged after one review.",
    ]);
    expect(part?.files.map((f) => [f.path, f.role, f.added])).toEqual([
      ["src/index.css", "the tokens", 1],
    ]);
    expect(req?.messages?.map((m) => m.task ?? null)).toEqual([null, null]);
  });

  it("the same run twice gives the same events", async () => {
    fake(answer(RECAP));
    await runRecap(SID, events, { env: env() });
    const first = queued().map((e) => e.id);
    updateSession(SID, { recapped: [] });
    fs.rmSync(queueDir(), { recursive: true });
    await runRecap(SID, events, { env: env() });
    expect(queued().map((e) => e.id)).toEqual(first);
  });

  it("never recaps a request twice, nor a mapped one", async () => {
    fake(answer(RECAP));
    await runRecap(SID, events, { env: env() });
    expect(await runRecap(SID, events, { env: env() })).toEqual({
      ran: 0,
      ok: 0,
    });
    expect(calls()).toHaveLength(1);
    expect(readSession(SID).recapped).toEqual([events[0]?.id]);
  });

  it.each([
    ["bad JSON", answer("Here is your recap: {not json")],
    ["JSON that is not a recap", answer({ map: { kind: "epic" } })],
    [
      "a map whose tasks name parts it does not have",
      answer({ ...RECAP, map: { ...RECAP.map, parts: [] } }),
    ],
    [
      "part detail for a part the map does not have",
      answer({ ...RECAP, parts: [{ ...RECAP.parts[0], id: "other" }] }),
    ],
    [
      "two parts with one id",
      answer({
        ...RECAP,
        map: {
          ...RECAP.map,
          parts: [
            RECAP.map.parts[0],
            { ...RECAP.map.parts[0], title: "Again" },
          ],
        },
      }),
    ],
    [
      "two tasks with one id",
      answer({
        ...RECAP,
        map: {
          ...RECAP.map,
          phases: [RECAP.map.phases[0], { ...RECAP.map.phases[0], id: "p2" }],
        },
      }),
    ],
    [
      "an error result",
      'echo \'{"type":"result","is_error":true,"result":"no"}\'',
    ],
    ["a crash", "exit 3"],
  ])(
    "on %s keeps the inferred view, logs one line, never retries",
    async (_, body) => {
      fake(body);
      const logged: string[] = [];
      expect(
        await runRecap(SID, events, { env: env(), log: (l) => logged.push(l) }),
      ).toEqual({
        ran: 1,
        ok: 0,
      });
      expect(queued().filter((e) => e.payload.recap)).toEqual([]);
      expect(logged).toHaveLength(1);
      expect(await runRecap(SID, events, { env: env() })).toEqual({
        ran: 0,
        ok: 0,
      });
      expect(calls()).toHaveLength(1);
    },
  );

  it("gives up after its timeout", async () => {
    fake(`sleep 5\n${answer(RECAP)}`);
    const logged: string[] = [];
    const t0 = Date.now();
    const r = await runRecap(SID, events, {
      env: env(),
      timeoutMs: 300,
      log: (l) => logged.push(l),
    });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toEqual({ ran: 1, ok: 0 });
    expect(logged[0]).toMatch(/timed out/);
  });

  it("with no claude on PATH, logs one line and sends nothing", async () => {
    const logged: string[] = [];
    expect(
      await runRecap(SID, events, { env: env(), log: (l) => logged.push(l) }),
    ).toEqual({ ran: 1, ok: 0 });
    expect(logged).toHaveLength(1);
    expect(queued().filter((e) => e.payload.recap)).toEqual([]);
  });

  it("MURMUR_RECAP=0 and a headless run never ask", async () => {
    fake(answer(RECAP));
    expect(
      await runRecap(SID, events, { env: env({ MURMUR_RECAP: "0" }) }),
    ).toEqual({
      ran: 0,
      ok: 0,
    });
    expect(
      await runRecap(SID, events, {
        env: env({ CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }),
      }),
    ).toEqual({ ran: 0, ok: 0 });
    expect(calls()).toEqual([]);
  });

  it("the input stays under about 60,000 characters", () => {
    const long = Array.from({ length: 200 }, (_, i) => ({
      ...events[1],
      id: `x${i}`,
      hook: "AssistantText" as const,
      ts: t(2 + i / 1000),
      payload: { text: `Message ${i}: ${"words ".repeat(100)}` },
    })) as MurmurEvent[];
    const view = reduce([...events, ...long]);
    const text = recapInput(
      view.requests[0] as NonNullable<(typeof view.requests)[0]>,
      view.cwd,
    );
    expect(text.length).toBeLessThanOrEqual(61_000);
    expect(text).toContain("Build the lit plate tokens");
  });
});

it("a file a helper changed in a worktree lands on its part as the server reads it", async () => {
  // A helper's events carry the worktree as cwd; the server gives every event the session's.
  const wt = `${cwd}/.claude/worktrees/lit`;
  const sub: MurmurEvent = {
    ...(events.find((e) => e.hook === "PostToolUse") as MurmurEvent),
    id: "sub-edit",
    cwd: wt,
    ts: t(3.5),
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "toolu_sub",
      agent_id: "a1",
      cwd: wt,
      // Named, so its own though the main thread's call is open meanwhile (core bashCredit).
      tool_input: { command: "sed -i '' s/a/b/ frontend/x.css" },
      tool_response: {
        bashEditDiff: {
          files: [
            { filePath: `${wt}/frontend/x.css`, hunks: [{ lines: ["+a"] }] },
          ],
        },
      },
    },
  };
  const all = [...events, sub];
  fake(
    answer({
      ...RECAP,
      parts: [
        {
          ...RECAP.parts[0],
          files: [{ path: "frontend/x.css", role: "styles" }],
        },
      ],
    }),
  );
  await runRecap(SID, all, { env: env() });
  const onServer = [...all, ...queued()].map((e) => ({ ...e, cwd }));
  const [req] = reduce(onServer).requests;
  expect(req?.parts[0]?.files.map((f) => [f.path, f.role])).toEqual([
    [".claude/worktrees/lit/frontend/x.css", "styles"],
  ]);
});

/** `n` more requests after the fixture's, each with a message, one second apart. */
const more = (n: number): MurmurEvent[] =>
  Array.from({ length: n }, (_, i) => {
    const base = events[0] as MurmurEvent;
    return [
      {
        ...base,
        id: `p${i}`,
        ts: t(10 + i),
        payload: { ...base.payload, prompt: `Request ${i}` },
      },
      {
        ...base,
        id: `m${i}`,
        ts: t(10.5 + i),
        hook: "AssistantText" as const,
        payload: { text: `Done ${i}.` },
      },
    ];
  }).flat();

describe("recap limits", () => {
  it("asks about the 5 newest requests only, newest first", async () => {
    fake(answer(RECAP));
    const all = [...events, ...more(6)];
    const r = await runRecap(SID, all, { env: env() });
    expect(r.ran).toBe(5);
    expect(readSession(SID).recapped).toEqual(["p5", "p4", "p3", "p2", "p1"]);
  });

  it("starts no new ask after its budget, and marks only what it asked", async () => {
    fake(`sleep 0.6\n${answer(RECAP)}`);
    const all = [...events, ...more(6)];
    const r = await runRecap(SID, all, { env: env(), budgetMs: 300 });
    expect(r.ran).toBe(3);
    expect(readSession(SID).recapped).toEqual(["p5", "p4", "p3"]);
    // The rest are asked by a later run.
    fake(answer(RECAP));
    expect((await runRecap(SID, all, { env: env() })).ran).toBe(2);
  });

  it("kills its claude children when the process exits", async () => {
    fake(`echo $$ > "${dir}/pid"\nsleep 30`);
    const running = runRecap(SID, events, { env: env() });
    for (let i = 0; i < 100 && !fs.existsSync(`${dir}/pid`); i++)
      await new Promise((ok) => setTimeout(ok, 20));
    const pid = Number(fs.readFileSync(`${dir}/pid`, "utf8"));
    killRecaps();
    expect(await running).toEqual({ ran: 1, ok: 0 });
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("asks nothing once the project is off or the session paused", async () => {
    fake(answer(RECAP));
    setProjectState(cwd, "off");
    expect((await runRecap(SID, events, { env: env() })).ran).toBe(0);
    setProjectState(cwd, "on");
    setPaused(cwd, true, SID);
    expect((await runRecap(SID, events, { env: env() })).ran).toBe(0);
    expect(calls()).toEqual([]);
    expect(readSession(SID).recapped ?? []).toEqual([]);
  });

  it("leaves the last request alone when the import started mid-request", async () => {
    fake(answer(RECAP));
    const all = [...events, ...more(1)];
    await runRecap(SID, all, { env: env(), lastOpen: true });
    expect(readSession(SID).recapped).toEqual([events[0]?.id]);
    expect(lastRequestOpen("PreToolUse")).toBe(true);
    expect(lastRequestOpen("SessionStart:compact")).toBe(true);
    expect(lastRequestOpen(undefined)).toBe(true);
    expect(lastRequestOpen("UserPromptSubmit")).toBe(false);
    expect(lastRequestOpen("SessionStart:resume")).toBe(false);
  });

  it("the hook records what started the import", () => {
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, "");
    handleHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "fresh-1",
        cwd,
        transcript_path: transcript,
      },
      { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" },
      new Date(),
    );
    expect(readSession("fresh-1")).toMatchObject({
      backfill: "pending",
      triggerHook: "PreToolUse",
    });
  });

  it("the claude run is headless and marked, whatever entry point Murmur had", async () => {
    fake(`env > "${dir}/env.txt"\n${answer(RECAP)}`);
    await runRecap(SID, events, {
      env: env({
        CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
        CLAUDE_CODE_SESSION_ATTENDED: "1",
        MURMUR_ALLOW_HEADLESS: "1",
      }),
    });
    const seen = fs.readFileSync(`${dir}/env.txt`, "utf8").split("\n");
    expect(seen).toContain("CLAUDE_CODE_ENTRYPOINT=sdk-cli");
    expect(seen).toContain("CLAUDE_CODE_SESSION_ATTENDED=0");
    expect(seen).toContain("MURMUR_RECAP_RUN=1");
    expect(seen.some((l) => l.startsWith("MURMUR_ALLOW_HEADLESS="))).toBe(
      false,
    );
  });

  it("its events are scrubbed like every other", async () => {
    fake(
      answer({
        ...RECAP,
        parts: [
          {
            ...RECAP.parts[0],
            aim: { aim: "Set token=abc123secretvalue", doneWhen: "done" },
          },
        ],
      }),
    );
    await runRecap(SID, events, { env: env() });
    const text = JSON.stringify(queued());
    expect(text).not.toContain("abc123secretvalue");
    expect(text).toContain("token=[redacted]");
  });

  it("a full path too long for a part's detail falls back to the shown one", async () => {
    const deep = `${cwd}/${"d".repeat(290)}`;
    const long: MurmurEvent = {
      ...(events.find((e) => e.hook === "PostToolUse") as MurmurEvent),
      id: "long-edit",
      ts: t(3.5),
      cwd: deep,
      payload: {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_use_id: "toolu_long",
        cwd: deep,
        tool_response: {
          filePath: `${deep}/x.css`,
          structuredPatch: [{ lines: ["+a"] }],
        },
      },
    };
    fake(
      answer({
        ...RECAP,
        parts: [
          { ...RECAP.parts[0], files: [{ path: "x.css", role: "styles" }] },
        ],
      }),
    );
    await runRecap(SID, [...events, long], { env: env() });
    const [req] = reduce([...events, long, ...queued()]).requests;
    expect(req?.parts[0]?.aim).toBeDefined();
  });
});
