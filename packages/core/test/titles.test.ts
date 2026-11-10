import { describe, expect, test } from "vitest";
import {
  type MurmurEvent,
  reduce,
  TITLES_TOOL,
  TitlesInput,
} from "../src/index.js";
import { isReply } from "../src/view/titles.js";
import { at, MAP, mapCall, prompt, tool } from "./helpers.js";

const said = (n: number, text: string) => at(n, "AssistantText", { text });
const stop = (n: number) => at(n, "Stop");
/** A titles run's answer as the plugin queues it. */
const titles = (n: number, input: unknown): MurmurEvent => ({
  ...at(n, "PostToolUse", {
    tool_name: TITLES_TOOL,
    tool_input: input,
    tool_use_id: `murmur-titles:${n}`,
    recap: true,
    titles: true,
  }),
});
const entry = (id: string, thread: string, extra: object = {}) => ({
  id,
  short: `Title of ${id}`,
  goal: `Goal of ${id}`,
  kind: "bug",
  thread,
  ...extra,
});

describe("titles schema", () => {
  const ok = {
    session: { title: "Ship build 9 and plan the next" },
    threads: [{ id: "t1", title: "Ship build 9" }],
    requests: [entry("r1", "t1"), entry("r2", "t1", { follows: "r1" })],
  };

  test("accepts a whole answer", () => {
    expect(TitlesInput.safeParse(ok).success).toBe(true);
  });

  test.each([
    ["a session title over 48", { session: { title: "x".repeat(49) } }],
    [
      "a short over 40",
      { requests: [{ ...entry("r1", "t1"), short: "x".repeat(41) }] },
    ],
    [
      "a goal over 120",
      { requests: [{ ...entry("r1", "t1"), goal: "x".repeat(121) }] },
    ],
    [
      "a thread title over 40",
      { threads: [{ id: "t1", title: "x".repeat(41) }] },
    ],
    ["a thread nobody listed", { requests: [entry("r1", "t9")] }],
    [
      "two requests with one id",
      { requests: [entry("r1", "t1"), entry("r1", "t1")] },
    ],
    [
      "two threads with one id",
      {
        threads: [
          { id: "t1", title: "A" },
          { id: "t1", title: "B" },
        ],
      },
    ],
    [
      "follows a request not in the answer",
      { requests: [entry("r1", "t1", { follows: "r7" })] },
    ],
    ["follows itself", { requests: [entry("r1", "t1", { follows: "r1" })] }],
    ["an empty short", { requests: [{ ...entry("r1", "t1"), short: " " }] }],
    [
      "over 80 requests",
      { requests: Array.from({ length: 81 }, (_, i) => entry(`r${i}`, "t1")) },
    ],
  ])("refuses %s", (_, patch) => {
    expect(TitlesInput.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe("Murmur's own titles", () => {
  test("a reply takes its title from how the request ended, at its first clause", () => {
    const view = reduce([
      prompt(0, "Ship build 9 to TestFlight"),
      prompt(10, "Yes"),
      said(11, "Build 9 is uploaded to TestFlight, and the note is drafted."),
      stop(12),
    ]);
    expect(view.requests[1]).toMatchObject({
      goal: "Build 9 is uploaded to TestFlight",
      short: "Build 9 is uploaded",
    });
  });

  test("a leading yes or okay in the outcome is dropped", () => {
    const [req] = reduce([
      prompt(0, "Ok"),
      said(1, "Okay, build 9 stays on TestFlight."),
    ]).requests;
    expect(req?.goal).toBe("Build 9 stays on TestFlight");
  });

  test.each([
    ["Yes", true],
    ["Sure okay, looking forward to it", true],
    [
      "Ok coming back to our original work, how much more time will it take",
      true,
    ],
    ["Go ahead", true],
    ["Waiting", true],
    ["Sent to Ankur", true],
    ["[Image #1]", true],
    [
      'Umang replied\n\n<pasted_content id="484d">\nThe agent screen is on staging.\n</pasted_content id="484d">\n',
      true,
    ],
    ["Thanks, that works", true],
    ["Find out why the disk is so full today", false],
    ["Finally you have done something good, let's build it", false],
  ])("%j is a reply: %s", (p, reply) => {
    expect(isReply(p)).toBe(reply);
  });

  test("a reply with nothing said keeps its prompt", () => {
    const [req] = reduce([prompt(0, "Sent to Ankur")]).requests;
    expect(req?.short).toBe("Sent to Ankur");
  });

  test("pasted text and images never show in a title, goal or the session's name", () => {
    const view = reduce([
      prompt(
        0,
        'Umang sent me this and wants a reply today \n\n<pasted_content id="484d">\nMessage for Sarthak\n</pasted_content id="484d">\n',
      ),
      prompt(5, "Look at this screen and fix the header [Image #1]"),
    ]);
    const [a, b] = view.requests;
    for (const s of [a?.short, a?.goal, b?.short, b?.goal, view.title]) {
      expect(s).not.toMatch(/pasted_content|\[Image/);
    }
    expect(a?.goal).toBe("Umang sent me this and wants a reply today");
    expect(b?.goal).toBe("Look at this screen and fix the header");
  });

  test("a title never stops mid-phrase", () => {
    const shortOf = (goal: string) =>
      reduce([prompt(0, "x"), mapCall(1, { ...MAP, goal })]).requests[0]?.short;
    expect(
      shortOf("Confirm whether build 9 was already uploaded to TestFlight"),
    ).toBe("Confirm whether build 9…");
    expect(
      shortOf(
        "Find what can be pruned without affecting the 4 live Claude sessions",
      ),
    ).toBe("Find what can be pruned");
    expect(
      shortOf(
        "Ok make sure if there are any old tradara app simulators, let's delete that",
      ),
    ).toBe("Ok make sure");
    // Backing off to before "whether" would leave two words.
    expect(
      shortOf(
        "Find out whether agent edits have hung again on production since the fix",
      ),
    ).toBe("Find out whether agent edits…");
    // A helping verb is no place to back off to.
    expect(
      shortOf("Finally you have done something good, let's build it"),
    ).toBe("Finally you have done something");
    expect(
      shortOf("Here's a shorter version you can paste straight into chat"),
    ).toBe("Here's a shorter version…");
    // A whole clause is never trimmed.
    expect(shortOf("Fix it")).toBe("Fix it");
  });

  test("a reply follows the request before it", () => {
    const view = reduce([
      prompt(0, "Ship build 9 to TestFlight"),
      prompt(10, "Go ahead"),
      prompt(20, "Plan the agent page redesign for the app"),
    ]);
    const [a, b, c] = view.requests;
    expect(a?.follows).toBeUndefined();
    expect(b?.follows).toBe(a?.id);
    expect(c?.follows).toBeUndefined();
  });

  test("the session's name skips bare replies", () => {
    const view = reduce([
      prompt(0, "yes"),
      prompt(10, "Plan the agent page redesign for the app"),
    ]);
    expect(view.title).toBe("Plan the agent page redesign for the app");
    expect(view.titledBy).toBeUndefined();
  });
});

describe("titles from Claude", () => {
  const base = [
    prompt(0, "Ship build 9 to TestFlight"),
    prompt(10, "yes"),
    said(11, "Done."),
    prompt(20, "Plan the agent page redesign"),
    mapCall(21, {
      ...MAP,
      goal: "Plan the agent page redesign",
      short: "Plan the agent page",
    }),
    prompt(30, "Make the map goal the title"),
    mapCall(31, { ...MAP, goal: "Restyle the agent page header" }),
  ];
  const ids = reduce(base).requests.map((r) => r.id) as [
    string,
    string,
    string,
    string,
  ];
  const answer = {
    session: { title: "Build 9 and the agent page" },
    threads: [
      { id: "t1", title: "Ship build 9" },
      { id: "t2", title: "Agent page redesign" },
    ],
    requests: [
      entry(ids[0], "t1", {
        short: "Ship build 9",
        goal: "Ship build 9 to TestFlight",
        kind: "feature",
      }),
      entry(ids[1], "t1", {
        short: "Upload build 9",
        goal: "Upload build 9",
        kind: "feature",
      }),
      entry(ids[2], "t2", {
        short: "Claude's other title",
        goal: "Other goal",
      }),
      entry(ids[3], "t2", {
        short: "Restyle the header",
        goal: "Other goal",
        kind: "feature",
      }),
    ],
  };

  test("short and goal: the map first, then the titles run, then Murmur's own", () => {
    const view = reduce([...base, titles(40, answer)]);
    const [a, b, c, d] = view.requests;
    expect([a?.short, a?.goal, a?.titledBy]).toEqual([
      "Ship build 9",
      "Ship build 9 to TestFlight",
      "claude",
    ]);
    expect(b?.short).toBe("Upload build 9");
    // The map's own short and goal win.
    expect([c?.short, c?.goal]).toEqual([
      "Plan the agent page",
      "Plan the agent page redesign",
    ]);
    // A map with no short takes the run's title, and keeps its own goal.
    expect([d?.short, d?.goal]).toEqual([
      "Restyle the header",
      "Restyle the agent page header",
    ]);
    const untitled = reduce(base).requests;
    expect(untitled[0]?.titledBy).toBeUndefined();
    expect(untitled[2]?.titledBy).toBe("claude");
  });

  test("kind: the map, then the titles run, then the guess", () => {
    const view = reduce([...base, titles(40, answer)]);
    const [a, , c] = view.requests;
    expect([a?.kind, a?.kindInferred]).toEqual(["feature", false]);
    expect([c?.kind, c?.kindInferred]).toEqual(["feature", false]);
    const guessed = reduce(base).requests[0];
    expect(guessed?.kindInferred).toBe(true);
  });

  test("the session takes Claude's name", () => {
    const view = reduce([...base, titles(40, answer)]);
    expect([view.title, view.titledBy]).toEqual([
      "Build 9 and the agent page",
      "claude",
    ]);
  });

  test("threads come from the run, and chapters are runs of one thread", () => {
    const view = reduce([...base, titles(40, answer)]);
    expect(view.threads).toEqual([
      {
        id: "t1",
        title: "Ship build 9",
        requests: [ids[0], ids[1]],
        state: "done",
        startedAt: base[0]?.ts,
        lastAt: base[2]?.ts,
        inferred: false,
      },
      {
        id: "t2",
        title: "Agent page redesign",
        requests: [ids[2], ids[3]],
        state: "running",
        startedAt: base[3]?.ts,
        lastAt: base[6]?.ts,
        inferred: false,
      },
    ]);
    expect(view.requests.map((r) => r.thread)).toEqual([
      "t1",
      "t1",
      "t2",
      "t2",
    ]);
    expect(
      view.journey?.chapters.map((c) => [c.title, c.requestIds.length]),
    ).toEqual([
      ["Ship build 9", 2],
      ["Agent page redesign", 2],
    ]);
  });

  test("a chapter is a run of consecutive requests: a thread that comes back is a new chapter", () => {
    const back = {
      ...answer,
      requests: answer.requests.map((r, i) =>
        i === 3 ? { ...r, thread: "t1" } : r,
      ),
    };
    const view = reduce([...base, titles(40, back)]);
    expect(view.journey?.chapters.map((c) => c.title)).toEqual([
      "Ship build 9",
      "Agent page redesign",
      "Ship build 9",
    ]);
    expect(view.threads?.map((t) => t.requests.length)).toEqual([3, 1]);
  });

  test("follows from the run, never from the reply rule, and only to an earlier request", () => {
    const run = {
      ...answer,
      requests: answer.requests.map((r, i) =>
        i === 3
          ? { ...r, follows: ids[0] }
          : i === 0
            ? { ...r, follows: ids[3] }
            : r,
      ),
    };
    const view = reduce([...base, titles(40, run)]);
    const [a, b, , d] = view.requests;
    expect(a?.follows).toBeUndefined();
    // Covered by the run, which said nothing of it: the reply rule does not apply.
    expect(b?.follows).toBeUndefined();
    expect(d?.follows).toBe(ids[0]);
  });

  test("a request the run has not covered yet joins the thread before it", () => {
    const view = reduce([
      ...base,
      titles(40, answer),
      prompt(50, "Now fix the header colours on the agent page"),
    ]);
    const last = view.requests.at(-1);
    expect(last?.thread).toBe("t2");
    expect(view.threads?.[1]?.requests).toContain(last?.id);
    expect(view.threads?.every((t) => !t.inferred)).toBe(true);
  });

  test("a later run wins for the requests it covers", () => {
    const later = {
      session: { title: "A better name" },
      threads: [{ id: "t2", title: "Agent page" }],
      requests: [entry(ids[3], "t2", { short: "Newer title" })],
    };
    const view = reduce([...base, titles(40, answer), titles(45, later)]);
    expect(view.title).toBe("A better name");
    expect(view.requests[3]?.short).toBe("Newer title");
    expect(view.requests[0]?.short).toBe("Ship build 9");
    expect(view.threads?.map((t) => t.title)).toEqual([
      "Ship build 9",
      "Agent page",
    ]);
  });

  test("an invalid answer is ignored", () => {
    const view = reduce([...base, titles(40, { ...answer, threads: [] })]);
    expect(view.titledBy).toBeUndefined();
    expect(view.threads?.every((t) => t.inferred)).toBe(true);
  });

  test("the run's event is never work: no tool, now, state or time", () => {
    const plain = reduce(base);
    const view = reduce([...base, titles(9000, answer)]);
    expect(view.lastEventAt).toBe(plain.lastEventAt);
    expect(view.requests.map((r) => [r.state, r.now, r.activity])).toEqual(
      plain.requests.map((r) => [r.state, r.now, r.activity]),
    );
    expect(view.journey?.pauses).toEqual(plain.journey?.pauses);
  });
});

describe("threads with no titles run", () => {
  test("one inferred thread per journey chapter", () => {
    const view = reduce([
      prompt(0, "Fix the login button, it is broken"),
      prompt(10, "Fix the logout button, it is broken too"),
      prompt(20, "What does the agent page show?"),
    ]);
    const chapters = view.journey?.chapters ?? [];
    expect(view.threads?.map((t) => [t.title, t.requests, t.inferred])).toEqual(
      chapters.map((c) => [c.title, c.requestIds, true]),
    );
    expect(view.requests.map((r) => r.thread)).toEqual(
      view.threads?.flatMap((t) => t.requests.map(() => t.id)),
    );
  });
});

describe("activity", () => {
  test("counts each kind of tool call, helpers' too, never Murmur's own", () => {
    const pre = (n: number, name: string, extra: object = {}) => ({
      ...tool(n, name, {}, "PreToolUse"),
      payload: {
        tool_name: name,
        tool_input: {},
        tool_use_id: `t${n}`,
        ...extra,
      },
    });
    const [req] = reduce([
      prompt(0, "Fix the login button, it is broken"),
      pre(1, "Read"),
      pre(2, "Read", { agent_id: "a1" }),
      pre(3, "Grep"),
      pre(4, "Glob"),
      pre(5, "Edit"),
      pre(6, "Write"),
      pre(7, "NotebookEdit"),
      pre(8, "Bash"),
      pre(9, "WebFetch"),
      pre(10, "WebSearch"),
      pre(11, "mcp__github__create_pr"),
      pre(12, "mcp__plugin_murmur_murmur__narrate"),
      pre(13, "Agent"),
      // A PostToolUse is the same call again.
      tool(14, "Read", {}),
    ]).requests;
    expect(req?.activity).toEqual({
      reads: 2,
      searches: 2,
      edits: 3,
      commands: 1,
      web: 2,
      tools: 1,
    });
  });
});
