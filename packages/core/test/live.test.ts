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
    const over = [...live(), stop(15, "h1"), stop(16, "h2")];
    expect(tasksOf(over)).toMatchObject({ t3: "todo", t4: "todo" });
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
