import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type MurmurEvent,
  reduce,
  requestKeys,
  TITLES_TOOL,
} from "@murmur/core";
import { beforeEach, describe, expect, it } from "vitest";
import { NARRATION_INSTRUCTION } from "../src/instruction.js";
import {
  queueDir,
  readSession,
  readTitles,
  setPaused,
  setProjectState,
  updateSession,
  writeCredentials,
  writeSession,
  writeTitles,
} from "../src/local.js";
import { runTitles, runTitlesLive, titlesInput } from "../src/titles.js";

const SID = "44444444-2222-4333-8444-555555555555";
const t = (s: number) =>
  new Date(Date.parse("2026-11-07T09:00:00.000Z") + s * 1000).toISOString();
const NOW = new Date(t(1000));

let dir: string;
let bin: string;
let cwd: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-titles-"));
  process.env.MURMUR_HOME = path.join(dir, "murmur");
  bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  cwd = path.join(dir, "repo");
  writeCredentials({ server: "http://x", token: "t", machineId: "m1" });
  setProjectState(cwd, "on");
  // Every prompt of these tests was sent live (see `sent`).
  updateSession(SID, {
    backfill: "done",
    cwd,
    project: cwd,
    transcriptPath: path.join(dir, "t.jsonl"),
    sent: Array.from({ length: 1000 }, (_, i) => `p${i}`),
  });
});

const event = (
  n: number,
  hook: MurmurEvent["hook"],
  payload: Record<string, unknown>,
): MurmurEvent => ({
  id: `e${n}`,
  sessionId: SID,
  machineId: "m1",
  cwd,
  ts: t(n),
  hook,
  payload: { session_id: SID, cwd, ...payload },
});
const ask = (n: number, prompt: string) =>
  event(n, "UserPromptSubmit", { prompt, prompt_id: `p${n}` });
const said = (n: number, text: string) => event(n, "AssistantText", { text });
const stop = (n: number) => event(n, "Stop", {});

const EVENTS = [
  ask(1, "Ship build 9 to TestFlight please"),
  said(2, "Starting the build."),
  said(3, "Build 9 is uploaded to TestFlight."),
  stop(4),
  ask(10, "yes"),
  said(11, "Drafted the note for Priya."),
  stop(12),
];

const ANSWER = {
  session: { title: "Ship build 9" },
  threads: [{ id: "t1", title: "Ship build 9" }],
  requests: [
    {
      id: "r1",
      short: "Ship build 9",
      goal: "Uploaded build 9 to TestFlight.",
      kind: "feature",
      thread: "t1",
    },
    {
      id: "r2",
      short: "Draft the build note",
      goal: "Drafted the build note for Priya.",
      kind: "feature",
      thread: "t1",
      follows: "r1",
    },
  ],
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
    {
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.02,
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
const stdin = () => fs.readFileSync(`${dir}/stdin.txt`, "utf8");
// The server is unreachable unless a test says otherwise: the local record decides.
const offline = (() => Promise.reject(new Error("offline"))) as typeof fetch;
const run = (
  events = EVENTS,
  extra: Record<string, string> = {},
  now = NOW,
  fetch = offline,
) => runTitles(SID, events, { env: env(extra), now, log: () => {}, fetch });

describe("the narration instruction", () => {
  it("asks map for a short title, never the user's words, even on a reply", () => {
    expect(NARRATION_INSTRUCTION).toContain('"short": ');
    expect(NARRATION_INSTRUCTION).toContain("never the user's own words");
    expect(NARRATION_INSTRUCTION).toContain('a short reply ("yes"');
  });
});

describe("titles input", () => {
  const view = (events: MurmurEvent[]) => reduce(events).requests;

  it("scrubs the prompt, reduces pasted text and images, and caps each part", () => {
    const reqs = view([
      ask(
        1,
        `Ravi replied <pasted_content id="1">\nsecret stuff\n</pasted_content id="1"> see [Image #1] key sk-ant-${"a".repeat(30)} ${"word ".repeat(100)}`,
      ),
      said(2, `First ${"x ".repeat(200)}`),
      said(3, `Last ${"y ".repeat(400)}`),
    ]);
    const text = titlesInput(reqs, ["p1"], {});
    expect(text).toContain("Asked: Ravi replied (pasted text) see (image) key");
    expect(text).not.toContain("secret stuff");
    expect(text).not.toContain("sk-ant-");
    const line = (label: string) =>
      text.split("\n").find((l) => l.startsWith(`  ${label}: `)) ?? "";
    expect(line("Asked").length).toBeLessThanOrEqual(2 + 7 + 300);
    expect(line("Claude first said").length).toBeLessThanOrEqual(2 + 19 + 200);
    expect(line("Claude ended with").length).toBeLessThanOrEqual(2 + 19 + 400);
  });

  it("names at most 5 changed files and 3 helpers", () => {
    const edits = Array.from({ length: 7 }, (_, i) =>
      event(2 + i, "PostToolUse", {
        tool_name: "Edit",
        tool_use_id: `u${i}`,
        tool_input: { file_path: `${cwd}/f${i}.ts` },
        tool_response: {
          filePath: `${cwd}/f${i}.ts`,
          structuredPatch: [{ lines: ["+a"] }],
        },
      }),
    );
    const helpers = Array.from({ length: 4 }, (_, i) => [
      event(20 + 2 * i, "PreToolUse", {
        tool_name: "Agent",
        tool_use_id: `a${i}`,
        tool_input: { description: `Helper ${i}`, prompt: "Do it." },
      }),
      event(21 + 2 * i, "SubagentStart", {
        agent_id: `ag${i}`,
        agent_type: "general-purpose",
      }),
    ]).flat();
    const text = titlesInput(
      view([ask(1, "Build the thing"), ...edits, ...helpers]),
      ["p1"],
      {},
    );
    expect(text).toContain("Changed: f0.ts, f1.ts, f2.ts, f3.ts, f4.ts\n");
    expect(text).toContain("Helpers: Helper 0; Helper 1; Helper 2");
    expect(text).not.toContain("Helper 3");
  });

  it("gives a request a run already covered only its title, goal and storyline", () => {
    const reqs = view(EVENTS);
    const text = titlesInput(reqs, ["p1", "p10"], {
      covered: {
        p1: { short: "Ship build 9", goal: "Shipped it.", thread: "t1" },
      },
      threads: { t1: "Ship build 9" },
    });
    expect(text).toContain(
      'r1 (2026-11-07 09:00), titled "Ship build 9": Shipped it. Storyline so far: t1',
    );
    expect(text).not.toContain("Ship build 9 to TestFlight please");
    expect(text).toContain("## Storylines so far");
    expect(text).toContain("t1: Ship build 9");
    expect(text).toContain("r2 (2026-11-07 09:00)\n  Asked: yes");
  });
});

describe("titles run", () => {
  it("asks once, isolated, and queues one titles event core reads", async () => {
    fake(answer(ANSWER));
    expect(await run()).toEqual({ ran: 1, ok: 1 });
    const args = calls()[0] as string;
    for (const flag of [
      "-p",
      "--model sonnet",
      "--tools ",
      "--no-session-persistence",
      "--safe-mode",
      '{"disableAllHooks":true}',
    ])
      expect(args).toContain(flag);
    expect(stdin()).toContain("Ship build 9 to TestFlight please");
    const out = queued();
    expect(out).toHaveLength(1);
    expect(out[0]?.payload).toMatchObject({
      tool_name: TITLES_TOOL,
      recap: true,
      titles: true,
    });
    // A millisecond after the latest event read.
    expect(out[0]?.ts).toBe(new Date(Date.parse(t(12)) + 1).toISOString());
    const v = reduce([...EVENTS, ...(out as MurmurEvent[])]);
    expect([v.title, v.titledBy]).toEqual(["Ship build 9", "claude"]);
    expect(v.requests.map((r) => r.short)).toEqual([
      "Ship build 9",
      "Draft the build note",
    ]);
    expect(v.requests[1]?.follows).toBe(v.requests[0]?.id);
    expect(v.threads?.map((x) => [x.title, x.inferred])).toEqual([
      ["Ship build 9", false],
    ]);
    expect(readTitles(SID).covered).toMatchObject({
      p1: { short: "Ship build 9", thread: "t1" },
      p10: { short: "Draft the build note", thread: "t1" },
    });
  });

  it("names requests by key, so the live prompt's own event id does not matter", async () => {
    fake(answer(ANSWER));
    await run();
    const live = EVENTS.map((e) =>
      e.hook === "UserPromptSubmit" ? { ...e, id: `live-${e.id}` } : e,
    );
    const v = reduce([...live, ...queued()]);
    expect(v.requests.map((r) => r.short)).toEqual([
      "Ship build 9",
      "Draft the build note",
    ]);
    expect(
      requestKeys(live.filter((e) => e.hook === "UserPromptSubmit")),
    ).toEqual(["p1", "p10"]);
  });

  it("never asks while the project is off or the session paused", async () => {
    fake(answer(ANSWER));
    setPaused(cwd, true, SID);
    expect(await run()).toEqual({ ran: 0, ok: 0 });
    setPaused(cwd, false, SID);
    setProjectState(cwd, "off");
    expect(await run()).toEqual({ ran: 0, ok: 0 });
    expect(calls()).toHaveLength(0);
  });

  it("names only requests Murmur sent: imported, or recorded live, never one asked while paused", async () => {
    fake("exit 3");
    // p10 was asked while paused: the hook never sent it, so it is never named.
    updateSession(SID, { sent: ["p1"] });
    await run();
    expect(stdin()).toContain("Asked: Ship build 9 to TestFlight please");
    expect(stdin()).not.toContain("Asked: yes");
    expect(stdin()).not.toContain("r2 (");
    expect(readTitles(SID).tried).toEqual(["p1"]);
    // Before the import's cutoff is imported history, sent whether recorded or not.
    updateSession(SID, { sent: [], cutoff: t(5) });
    fake("exit 3");
    await run(EVENTS, {}, new Date(t(5000)));
    expect(stdin()).toContain("Asked: Ship build 9 to TestFlight please");
    expect(stdin()).not.toContain("Asked: yes");
    // Nothing sent is uncovered: nothing to ask.
    const { cutoff: _, ...rest } = readSession(SID);
    writeSession(SID, rest);
    expect(await run(EVENTS, {}, new Date(t(9000)))).toEqual({ ran: 0, ok: 0 });
  });

  it("names the requests the server holds, even ones sent before Murmur kept a record", async () => {
    fake("exit 3");
    // Sent live before this version: no local record, after the import's cutoff.
    updateSession(SID, { sent: [], cutoff: t(0) });
    let asked = "";
    const held = (async (url: string | URL | Request, init?: RequestInit) => {
      asked = `${url} ${new Headers(init?.headers).get("authorization")}`;
      return new Response(JSON.stringify({ prompts: ["p1"] }));
    }) as typeof fetch;
    await run(EVENTS, {}, NOW, held);
    expect(asked).toBe(`http://x/api/ingest/sessions/${SID}/prompts Bearer t`);
    expect(stdin()).toContain("Asked: Ship build 9 to TestFlight please");
    // p10 is not on the server (asked while paused, or lost): never named.
    expect(stdin()).not.toContain("Asked: yes");
    expect(readTitles(SID).tried).toEqual(["p1"]);
  });

  it("never asks in its own run, headless, or with MURMUR_RECAP=0", async () => {
    fake(answer(ANSWER));
    for (const extra of [
      { MURMUR_RECAP_RUN: "1" },
      { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
      { MURMUR_RECAP: "0" },
    ])
      expect(await run(EVENTS, extra)).toEqual({ ran: 0, ok: 0 });
    expect(calls()).toHaveLength(0);
  });

  it("asks at most once every 10 minutes, and only when something new is uncovered", async () => {
    fake(answer(ANSWER));
    await run();
    // Everything covered: nothing to ask, even much later.
    expect(await run(EVENTS, {}, new Date(t(5000)))).toEqual({ ran: 0, ok: 0 });
    const more = [...EVENTS, ask(20, "Plan the agent page"), stop(21)];
    // A new request, but within 10 minutes of the last ask.
    expect(await run(more, {}, new Date(t(1300)))).toEqual({ ran: 0, ok: 0 });
    expect(calls()).toHaveLength(1);
    fake(
      answer({
        ...ANSWER,
        requests: [
          ...ANSWER.requests,
          { ...ANSWER.requests[0], id: "r3", short: "Plan the agent page" },
        ],
      }),
    );
    expect(await run(more, {}, new Date(t(1700)))).toEqual({ ran: 1, ok: 1 });
    // The covered ones go in as context only.
    expect(stdin()).toContain('r1 (2026-11-07 09:00), titled "Ship build 9"');
    expect(stdin()).toContain("Asked: Plan the agent page");
  });

  it("a failed ask is not repeated until a new request comes", async () => {
    fake("exit 3");
    expect(await run()).toEqual({ ran: 1, ok: 0 });
    expect(await run(EVENTS, {}, new Date(t(5000)))).toEqual({ ran: 0, ok: 0 });
    expect(calls()).toHaveLength(1);
    expect(readTitles(SID).tried).toEqual(["p1", "p10"]);
  });

  it("asks about the newest 80 requests at most", async () => {
    const many = Array.from({ length: 85 }, (_, i) =>
      ask(i * 10, `Request number ${i} about something`),
    );
    fake("exit 3");
    await run(many, {}, new Date(t(2000)));
    expect(stdin()).toContain("r80 (");
    expect(stdin()).not.toContain("r81 (");
    expect(stdin()).toContain("Request number 84");
    expect(stdin()).not.toContain("Request number 4 ");
  });

  it.each([
    ["bad JSON", answer("{not json")],
    [
      "a request it was not asked about",
      answer({ ...ANSWER, requests: [{ ...ANSWER.requests[0], id: "r9" }] }),
    ],
    [
      "a follows it was not asked about",
      answer({
        ...ANSWER,
        requests: [{ ...ANSWER.requests[0], follows: "r9" }],
      }),
    ],
    [
      "a short over 40 characters",
      answer({
        ...ANSWER,
        requests: [{ ...ANSWER.requests[0], short: "x".repeat(41) }],
      }),
    ],
    ["a crash", "exit 3"],
  ])("on %s queues nothing and logs one line", async (_, body) => {
    fake(body);
    const logged: string[] = [];
    expect(
      await runTitles(SID, EVENTS, {
        env: env(),
        now: NOW,
        log: (l) => logged.push(l),
      }),
    ).toEqual({ ran: 1, ok: 0 });
    expect(queued()).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("kept its titles");
  });

  it("leaves the last request to live narration when the import started inside it", async () => {
    fake("exit 3");
    await runTitles(SID, EVENTS, {
      env: env(),
      now: NOW,
      lastOpen: true,
      log: () => {},
    });
    expect(stdin()).not.toContain("Asked: yes");
    expect(readTitles(SID).tried).toEqual(["p1"]);
  });

  it("an answer that comes back after a pause is not sent", async () => {
    fake(`sleep 0.3\n${answer(ANSWER)}`);
    const going = run();
    await new Promise((r) => setTimeout(r, 100));
    setPaused(cwd, true, SID);
    expect(await going).toEqual({ ran: 1, ok: 0 });
    expect(queued()).toHaveLength(0);
  });

  it("keeps the storylines it named for the next run", async () => {
    writeTitles(SID, {});
    fake(answer(ANSWER));
    await run();
    expect(readTitles(SID).threads).toEqual({ t1: "Ship build 9" });
  });
});

describe("titles run after a Stop", () => {
  /** A transcript with one prompt per `n`, each with Claude's answer. */
  const transcript = (...ns: number[]) =>
    fs.writeFileSync(
      path.join(dir, "t.jsonl"),
      ns
        .flatMap((n) => [
          {
            type: "user",
            uuid: `u${n}`,
            promptId: `p${n}`,
            timestamp: t(n),
            origin: { kind: "human" },
            message: { content: `Request number ${n} about the app` },
          },
          {
            type: "assistant",
            uuid: `a${n}`,
            timestamp: t(n + 1),
            message: { content: [{ type: "text", text: `Did ${n}.` }] },
          },
        ])
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
  const live = (now: Date) =>
    runTitlesLive(SID, { env: env(), now, log: () => {} });

  it("reads the transcript at most once every 5 minutes, so a burst of Stops asks once", async () => {
    transcript(1);
    fake("exit 3");
    const burst = await Promise.all([live(NOW), live(NOW), live(NOW)]);
    expect(burst.map((r) => r.ran)).toEqual([1, 0, 0]);
    expect(calls()).toHaveLength(1);
    // Ten minutes on, nothing new: one look, no ask, and no other look for 5 minutes.
    expect(await live(new Date(t(1700)))).toEqual({ ran: 0, ok: 0 });
    transcript(1, 999);
    expect(await live(new Date(t(1800)))).toEqual({ ran: 0, ok: 0 });
    expect(await live(new Date(t(2001)))).toEqual({ ran: 1, ok: 0 });
    expect(calls()).toHaveLength(2);
  });
});
