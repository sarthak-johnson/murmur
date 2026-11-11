/*
 * A request read while it runs: a task waiting on the user, phases from their tasks,
 * helpers tied to the tasks they do, their files, messages and actions, and needs-you
 * after Claude ends its turn with helpers still at work.
 */
import { describe, expect, test } from "vitest";
import { type MapInput, type MurmurEvent, reduce } from "../src/index.js";
import { at, mapCall, narrateCall, prompt, tool, write } from "./helpers.js";

/** Three phases; scenes 1-4 and 5-7 share the `scenes` part, like a real plan. */
const PLAN: MapInput = {
  kind: "feature",
  goal: "A self-playing demo with a voiceover",
  phases: [
    {
      id: "p1",
      title: "Mockup",
      tasks: [
        { id: "t1", title: "Check the script", part: "audit" },
        { id: "t2", title: "Player shell", part: "engine" },
        { id: "t3", title: "Scenes 1-4 (chat, basket)", part: "scenes" },
        { id: "t4", title: "Scenes 5-7 (desk, ledger)", part: "scenes" },
      ],
    },
    {
      id: "p2",
      title: "Voice",
      tasks: [{ id: "t6", title: "Record 7 narration clips", part: "voice" }],
    },
    {
      id: "p3",
      title: "Video",
      tasks: [{ id: "t7", title: "Mux frames with voice", part: "video" }],
    },
  ],
  parts: [
    { id: "audit", title: "Script check", phase: "p1" },
    { id: "engine", title: "Player shell", phase: "p1" },
    { id: "scenes", title: "Seven scene files", phase: "p1" },
    { id: "voice", title: "Narration", phase: "p2" },
    { id: "video", title: "Final video", phase: "p3" },
  ],
};

const say = (n: number, task: string, taskStatus: string, now = "Working") =>
  narrateCall(n, { now, why: "because", task, taskStatus });
const agentCall = (n: number, description: string) =>
  tool(
    n,
    "Agent",
    { description, prompt: description, subagent_type: "general-purpose" },
    "PreToolUse",
  );
const start = (n: number, id: string) =>
  at(n, "SubagentStart", { agent_id: id, agent_type: "general-purpose" });
const stop = (n: number, id: string) =>
  at(n, "SubagentStop", { agent_id: id, agent_type: "general-purpose" });
const by = (e: MurmurEvent, id: string): MurmurEvent => ({
  ...e,
  payload: { ...e.payload, agent_id: id },
});
const text = (n: number, words: string) =>
  at(n, "AssistantText", { text: words });
const turnEnds = (n: number, last: string) =>
  at(n, "Stop", { last_assistant_message: last });

const ASK =
  "The voiceover is blocked: the voice site is signed out. Please sign in there and tell me when you're done.";

/** The live request: two scene helpers at work, the voice task blocked, the turn over. */
function live(): MurmurEvent[] {
  return [
    prompt(1, "build the demo"),
    mapCall(2, PLAN),
    say(3, "t1", "done"),
    say(4, "t2", "done"),
    agentCall(5, "Build demo scenes 1, 2, 4"),
    agentCall(6, "Build demo scenes 3, 5, 6, 7"),
    start(7, "h1"),
    start(8, "h2"),
    say(9, "t6", "blocked", "The voice site needs a sign-in"),
    text(10, ASK),
    turnEnds(11, ASK),
    by(write(12, "demo/s1-chat.js", "x\n"), "h1"),
    by(write(13, "demo/s5-desk.js", "x\n"), "h2"),
    by(
      tool(14, "Bash", {
        command: "node shot.mjs",
        description: "Reshoot scene 5",
      }),
      "h2",
    ),
  ];
}

const tasksOf = (events: MurmurEvent[]) =>
  Object.fromEntries(
    (reduce(events).requests[0]?.phases ?? [])
      .flatMap((ph) => ph.tasks)
      .map((t) => [t.id, t.status]),
  );

describe("a task waiting on the user", () => {
  test("is blocked, not failed, and says what was asked", () => {
    const req = reduce(live()).requests[0];
    const t6 = req?.phases[1]?.tasks[0];
    expect(t6?.status).toBe("blocked");
    expect(t6?.problem).toBeUndefined();
    expect(t6?.ask).toEqual({
      text: "Sign in there and tell me when you're done",
      since: "2026-11-06T00:00:10.000Z",
      message: "e10",
    });
    // The asking message is about the voice task, though the scenes phase spans it.
    expect(req?.messages?.find((m) => m.id === "e10")?.phase).toBe("p2");
  });

  test("its narrate step is not a failure", () => {
    const req = reduce(live()).requests[0];
    const voice = req?.parts.find((p) => p.id === "voice");
    expect(voice?.steps.map((s) => s.text)).toEqual([
      "The voice site needs a sign-in",
    ]);
    expect(voice?.steps.map((s) => s.status)).not.toContain("failed");
    expect(voice?.steps.map((s) => s.status)).not.toContain("running");
  });

  test("turning running again drops the ask", () => {
    const req = reduce([...live(), say(20, "t6", "running")]).requests[0];
    expect(req?.phases[1]?.tasks[0]?.ask).toBeUndefined();
  });
});

describe("a phase's status comes from its tasks", () => {
  test("some done and some not is in progress; all done is done", () => {
    const view = reduce([
      prompt(1, "go"),
      mapCall(2, PLAN),
      say(3, "t1", "done"),
      say(4, "t2", "done"),
    ]);
    expect(view.requests[0]?.phases.map((p) => p.status)).toEqual([
      "now",
      "todo",
      "todo",
    ]);
  });

  test("a blocked task makes its phase blocked", () => {
    const view = reduce(live());
    expect(view.requests[0]?.phases.map((p) => p.status)).toEqual([
      "now",
      "blocked",
      "todo",
    ]);
  });
});

describe("needs-you after the turn ends", () => {
  test("a blocked task and an ask raise it while helpers run", () => {
    const view = reduce(live());
    expect(view.needsYou).toEqual({
      reason: "input",
      text: "Sign in there and tell me when you're done",
      since: "2026-11-06T00:00:11.000Z",
    });
    expect(view.requests[0]?.state).toBe("waiting");
  });

  test("the latest ask's words win", () => {
    const again =
      "Two builders are still on the scenes. The voiceover is waiting on you to sign in to the voice site in the tab I opened.";
    const view = reduce([
      ...live(),
      say(15, "t1", "done"),
      text(16, again),
      turnEnds(17, again),
    ]);
    expect(view.needsYou).toMatchObject({
      text: "Sign in to the voice site in the tab I opened",
    });
  });

  test("a blocked task alone raises it, in the narrate's words", () => {
    const events = live()
      .filter((e) => e.hook !== "AssistantText")
      .map((e) =>
        e.hook === "Stop" ? turnEnds(11, "Two builders are on the scenes.") : e,
      );
    expect(reduce(events).needsYou).toMatchObject({
      reason: "input",
      text: "The voice site needs a sign-in",
    });
  });

  test("an ask in the last message alone raises it", () => {
    const view = reduce([
      prompt(1, "go"),
      text(2, "I opened the page. Please sign in to the dashboard."),
      turnEnds(3, "I opened the page. Please sign in to the dashboard."),
    ]);
    expect(view.needsYou).toMatchObject({
      reason: "input",
      text: "Sign in to the dashboard",
    });
  });

  test("a question put to the user raises it", () => {
    const last = "The fix is in. Should I push it to main?";
    const view = reduce([prompt(1, "go"), turnEnds(2, last)]);
    expect(view.needsYou).toMatchObject({
      reason: "input",
      text: "Should I push it to main?",
    });
  });

  test("an ordinary end of turn does not", () => {
    const view = reduce([
      prompt(1, "go"),
      turnEnds(2, "Done. All 40 tests pass and the page renders."),
    ]);
    expect(view.needsYou).toBeNull();
  });

  test("helpers' work does not clear it; the next prompt does", () => {
    expect(reduce(live()).needsYou).not.toBeNull();
    expect(reduce([...live(), prompt(20, "signed in")]).needsYou).toBeNull();
  });

  test("a helper's permission prompt shows over the ask, then the ask returns", () => {
    const asked = [
      ...live(),
      by(at(15, "PermissionRequest", { tool_name: "Bash" }), "h2"),
    ];
    expect(reduce(asked).needsYou).toMatchObject({ reason: "permission" });
    const goneOn = [...asked, by(tool(16, "Bash", { command: "ls" }), "h2")];
    expect(reduce(goneOn).needsYou).toMatchObject({
      reason: "input",
      since: "2026-11-06T00:00:11.000Z",
    });
  });

  test("an idle prompt after the ask keeps the ask", () => {
    const idle = at(15, "Notification", {
      notification_type: "idle_prompt",
      message: "Claude is waiting for your input",
    });
    expect(reduce([...live(), idle]).needsYou).toMatchObject({
      reason: "input",
    });
  });

  test("a helper's permission prompt still clears when that helper goes on", () => {
    const view = reduce([
      prompt(1, "go"),
      agentCall(2, "Build it"),
      start(3, "h1"),
      by(at(4, "PermissionRequest", { tool_name: "Bash" }), "h1"),
      by(tool(5, "Bash", { command: "ls" }), "h1"),
    ]);
    expect(view.needsYou).toBeNull();
  });
});

describe("waiting on you means you are needed", () => {
  const ends = (last: string) =>
    reduce([prompt(1, "go"), text(2, last), turnEnds(3, last)]).needsYou;

  test.each([
    "Done. All 40 tests pass. Let me know if you want changes.",
    "Please let me know if you want changes.",
    "The tests pass. Please note the old build still runs on staging.",
    "Please see the report for the details.",
    "Done. You don't need to do anything else: it no longer needs you to sign in.",
    "If the sign-in lapses, I will need you to run the login again.",
    "It was waiting on you to sign in, and now it is through.",
    "All merged. Want me to open a PR?",
    "All merged. Would you like me to write the changelog?",
    "Done. Shall I start the next build?",
    "He wrote:\n\n> Please sign in first",
    "From the review:\n\n> Should you ship this?",
    "Why did it fail? The cache was stale, so I cleared it.",
  ])("%s", (last) => {
    expect(ends(last)).toBeNull();
  });

  test.each([
    ["Should I expire it, or keep it?", "Should I expire it, or keep it?"],
    ["Want me to keep it, or drop it?", "Want me to keep it, or drop it?"],
    ["Blocked. Please paste the key.", "Paste the key"],
    ["It needs you to sign in.", "Sign in"],
    [
      "Do you want snooze at ten minutes?",
      "Do you want snooze at ten minutes?",
    ],
  ])("%s", (last, ask) => {
    expect(ends(last)).toMatchObject({ reason: "input", text: ask });
  });

  test("a turn that ends without an ask drops the last turn's", () => {
    const view = reduce([
      prompt(1, "go"),
      turnEnds(2, "Please sign in."),
      turnEnds(3, "Never mind, I found a saved login and carried on."),
    ]);
    expect(view.needsYou).toBeNull();
  });

  test("a stale ask never shows on a later request", () => {
    const events = [
      ...live(),
      prompt(20, "signed in"),
      turnEnds(21, "Voice is done."),
    ];
    const view = reduce(events);
    expect(view.needsYou).toBeNull();
    expect(view.requests[1]?.state).toBe("done");
  });

  test("a task blocked on a job, not on you, is under way and asks nothing", () => {
    const events = [
      prompt(1, "go"),
      mapCall(2, PLAN),
      narrateCall(3, {
        now: "The recording is waiting for the scheduled job",
        why: "the limit resets tomorrow",
        task: "t6",
        taskStatus: "blocked",
      }),
      turnEnds(4, "Scheduled for tomorrow; nothing to do until then."),
    ];
    const view = reduce(events);
    expect(view.needsYou).toBeNull();
    expect(tasksOf(events).t6).toBe("now");
  });

  test("a part with a blocked task is not done, whatever its steps said", () => {
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, PLAN),
      narrateCall(3, {
        now: "Tried the voice site",
        why: "why",
        part: "voice",
        step: { text: "Opened the site", status: "done" },
      }),
      say(4, "t6", "blocked", "The voice site needs a sign-in"),
      turnEnds(5, "Please sign in to the voice site."),
    ]).requests[0];
    expect(req?.parts.find((p) => p.id === "voice")?.status).toBe("now");
  });

  test("the task's ask is the clearest sentence Claude wrote", () => {
    const clear = "It is waiting on you to sign in to the voice site.";
    const view = reduce([
      ...live(),
      text(16, "Still building."),
      text(17, clear),
    ]);
    expect(view.requests[0]?.phases[1]?.tasks[0]?.ask).toEqual({
      text: "Sign in to the voice site",
      since: "2026-11-06T00:00:10.000Z",
      message: "e17",
    });
  });
});

describe("helpers tied to the tasks they do", () => {
  test("numbers and words in the description pick the task", () => {
    const req = reduce(live()).requests[0];
    const tasks = req?.phases[0]?.tasks ?? [];
    expect(tasks.find((t) => t.id === "t3")?.agents).toEqual(["h1"]);
    expect(tasks.find((t) => t.id === "t4")?.agents).toEqual(["h2"]);
    expect(req?.agents.map((a) => a.part)).toEqual(["scenes", "scenes"]);
    expect(req?.parts.find((p) => p.id === "scenes")?.agents).toEqual([
      "h1",
      "h2",
    ]);
  });

  test("a task a running helper does reads running", () => {
    expect(tasksOf(live())).toMatchObject({ t3: "now", t4: "now" });
  });

  test("a helper that finished fine finishes the task Claude said nothing of", () => {
    const over = [...live(), stop(15, "h1"), stop(16, "h2")];
    expect(tasksOf(over)).toMatchObject({ t3: "done", t4: "done" });
    const req = reduce(over).requests[0];
    expect(req?.parts.find((p) => p.id === "scenes")?.status).toBe("done");
    expect(req?.phases[0]?.status).toBe("done");
  });

  test("a helper matched on one word alone does not finish the task", () => {
    const plan: MapInput = {
      ...PLAN,
      phases: [
        {
          id: "p1",
          title: "One",
          tasks: [{ id: "a", title: "Apply value fixes", part: "audit" }],
        },
      ],
    };
    const events = [
      prompt(1, "go"),
      mapCall(2, plan),
      agentCall(3, "Check values in demo"),
      start(4, "h1"),
      stop(5, "h1"),
    ];
    expect(tasksOf(events).a).toBe("todo");
  });

  test("Claude's own status wins over its helper finishing", () => {
    const over = [...live(), say(14.5, "t4", "failed"), stop(15, "h2")];
    expect(tasksOf(over).t4).toBe("failed");
    const open = [...live(), say(14.5, "t3", "running"), stop(15, "h1")];
    expect(tasksOf(open).t3).toBe("now");
  });

  test("one of two helpers still running keeps the task under way", () => {
    const events = [
      ...live(),
      agentCall(15, "Build scenes 1, 2"),
      start(16, "h3"),
      stop(17, "h1"),
    ];
    expect(tasksOf(events).t3).toBe("now");
  });

  test("a helper whose report failed leaves the task open", () => {
    const failed = prompt(
      16,
      "<task-notification>\n<task-id>h1</task-id>\n<tool-use-id>t5</tool-use-id>\n<status>failed</status>\n<summary>Agent failed</summary>\n<result>Could not build.</result>\n</task-notification>",
    );
    expect(tasksOf([...live(), stop(15, "h1"), failed]).t3).toBe("todo");
  });

  test("one common word in a long description is no match", () => {
    const plan: MapInput = {
      ...PLAN,
      phases: [
        {
          id: "p1",
          title: "One",
          tasks: [
            {
              id: "a",
              title: "Read screen, machine, cards, contracts",
              part: "audit",
            },
            {
              id: "b",
              title: "Widgets: draw server cards in chat",
              part: "engine",
            },
          ],
        },
      ],
    };
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, plan),
      say(3, "a", "running"),
      agentCall(4, "Map server chat stream contract"),
      start(5, "h1"),
    ]).requests[0];
    expect(req?.phases[0]?.tasks.map((t) => t.agents)).toEqual([["h1"], []]);
  });

  test("a generic word like page is no match", () => {
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, PLAN),
      agentCall(3, "Update the home page"),
      start(4, "h1"),
    ]).requests[0];
    expect(req?.agents[0]?.part).toBeUndefined();
  });

  test("a helper naming a task the plan lacks still matches on its words", () => {
    const plan: MapInput = {
      ...PLAN,
      phases: [
        {
          id: "p1",
          title: "One",
          tasks: [{ id: "a", title: "Conversation page", part: "engine" }],
        },
      ],
    };
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, plan),
      agentCall(3, "Build Task 61: conversation page"),
      start(4, "h1"),
    ]).requests[0];
    expect(req?.phases[0]?.tasks[0]?.agents).toEqual(["h1"]);
  });

  test("no shared word: the helper stands on its own", () => {
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, PLAN),
      agentCall(3, "Research pricing pages"),
      start(4, "h1"),
    ]).requests[0];
    expect(req?.agents[0]?.part).toBeUndefined();
    expect(
      req?.phases.flatMap((p) => p.tasks.flatMap((t) => t.agents)),
    ).toEqual([]);
  });

  test("two tasks matching equally: no task, but their shared part", () => {
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, PLAN),
      agentCall(3, "Build more scenes"),
      start(4, "h1"),
    ]).requests[0];
    expect(
      req?.phases.flatMap((p) => p.tasks.flatMap((t) => t.agents)),
    ).toEqual([]);
    expect(req?.agents[0]?.part).toBe("scenes");
  });

  test("two tasks on different parts matching equally: neither", () => {
    const plan: MapInput = {
      ...PLAN,
      phases: [
        {
          id: "p1",
          title: "One",
          tasks: [
            { id: "a", title: "Chart colours", part: "engine" },
            { id: "b", title: "Chart labels", part: "voice" },
          ],
        },
      ],
    };
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, plan),
      agentCall(3, "Fix the chart"),
      start(4, "h1"),
    ]).requests[0];
    expect(req?.agents[0]?.part).toBeUndefined();
  });

  test("a word shared with a long title loses to a title it covers whole", () => {
    // From a real session: "list" also hit "Collect the four task lists", which tied it
    // with the Library task, so the Library builder stood on its own.
    const plan: MapInput = {
      ...PLAN,
      phases: [
        {
          id: "p1",
          title: "Prepare",
          tasks: [
            { id: "a", title: "Collect the four task lists", part: "engine" },
          ],
        },
        {
          id: "p2",
          title: "Phase 7 Library",
          tasks: [
            { id: "b", title: "Build and review Library", part: "voice" },
          ],
        },
      ],
    };
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, plan),
      agentCall(3, "Build Task 173 Library list"),
      start(4, "h1"),
    ]).requests[0];
    expect(req?.phases[1]?.tasks[0]?.agents).toEqual(["h1"]);
    expect(req?.agents[0]?.part).toBe("voice");
  });

  test("the word phase ties nothing: a phase planner joins the part its subject names", () => {
    // From a real session: "Plan Phase 4 Portfolio" tied five tasks on "phase" alone.
    const plan: MapInput = {
      ...PLAN,
      phases: [
        {
          id: "p0",
          title: "Get ready",
          tasks: [
            {
              id: "a",
              title: "Re-read the rules and Phase 3 plan",
              part: "audit",
            },
          ],
        },
        {
          id: "p4",
          title: "Phase 4: Portfolio",
          tasks: [
            { id: "b", title: "Write Portfolio task list", part: "engine" },
            { id: "c", title: "Build and review Portfolio", part: "engine" },
          ],
        },
        {
          id: "p6",
          title: "Phases 6-7",
          tasks: [
            { id: "d", title: "Build Phase 6", part: "scenes" },
            { id: "e", title: "Build Phase 7", part: "voice" },
          ],
        },
      ],
    };
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, plan),
      agentCall(3, "Plan Phase 4 Portfolio"),
      start(4, "h1"),
    ]).requests[0];
    // Both Portfolio tasks match, on one part: that part alone, as before.
    expect(req?.agents[0]?.part).toBe("engine");
    expect(
      req?.phases.flatMap((p) => p.tasks.flatMap((t) => t.agents)),
    ).toEqual([]);
  });
});

describe("what helpers did", () => {
  test("a helper's files go to its task's part, never to the main thread's latest", () => {
    const req = reduce(live()).requests[0];
    const files = (id: string) =>
      req?.parts.find((p) => p.id === id)?.files.map((f) => f.path);
    expect(files("scenes")).toEqual(["demo/s1-chat.js", "demo/s5-desk.js"]);
    expect(files("voice")).toEqual([]);
    expect(req?.agents.map((a) => a.files)).toEqual([
      ["demo/s1-chat.js"],
      ["demo/s5-desk.js"],
    ]);
  });

  test("a helper with no task keeps its files out of other parts", () => {
    const req = reduce([
      prompt(1, "go"),
      mapCall(2, PLAN),
      say(3, "t1", "done"),
      agentCall(4, "Research pricing pages"),
      start(5, "h1"),
      by(write(6, "notes/pricing.md", "x\n"), "h1"),
    ]).requests[0];
    expect(req?.parts.flatMap((p) => p.files)).toEqual([]);
    expect(req?.looseFiles.map((f) => f.path)).toEqual(["notes/pricing.md"]);
    expect(req?.agents[0]?.files).toEqual(["notes/pricing.md"]);
  });

  test("each helper's latest action, and whose action the now line is", () => {
    const req = reduce(live()).requests[0];
    expect(req?.agents.map((a) => a.doing?.text)).toEqual([
      "Editing s1-chat.js",
      "Reshoot scene 5",
    ]);
    expect(req?.now).toMatchObject({ text: "Reshoot scene 5", agent: "h2" });
  });

  test("a message after a helper's report goes to that helper's phase", () => {
    const note = (id: string, words: string) =>
      prompt(
        0,
        `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>t5</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>${words}</result>\n</task-notification>`,
      );
    const events = [
      ...live(),
      { ...note("h1", "Scenes built."), id: "e20", ts: at(20, "Stop").ts },
      text(21, "Those scenes are built and checked."),
    ];
    const req = reduce(events).requests[0];
    const m = req?.messages?.find((x) => x.id === "e21");
    expect(m?.agent).toBe("h1");
    expect(m?.phase).toBe("p1");
  });
});

test("a narrated path under ~ matches the file it names", () => {
  const home = (e: MurmurEvent): MurmurEvent => ({
    ...e,
    cwd: "/Users/me/app",
  });
  const req = reduce(
    [
      prompt(1, "go"),
      mapCall(2, PLAN),
      at(3, "PostToolUse", {
        tool_name: "Write",
        tool_input: { file_path: "/Users/me/demo/engine.js" },
        tool_response: {
          type: "create",
          filePath: "/Users/me/demo/engine.js",
          content: "x\n",
          structuredPatch: [],
        },
      }),
      narrateCall(4, {
        now: "Shell written",
        why: "it drives the scenes",
        part: "engine",
        files: [{ path: "~/demo/engine.js", role: "the clock" }],
      }),
    ].map(home),
  ).requests[0];
  expect(req?.parts.find((p) => p.id === "engine")?.files).toMatchObject([
    { path: "/Users/me/demo/engine.js", role: "the clock", added: 1 },
  ]);
  expect(req?.looseFiles).toEqual([]);
});
