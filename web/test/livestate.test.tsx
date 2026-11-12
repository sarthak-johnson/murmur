/*
 * A live request told truthfully, from the real reducer's output: a task waiting on the
 * user reads amber everywhere it is drawn, helpers say what they are at, and a zero says
 * nothing.
 */
import {
  MAP_TOOL,
  type MapInput,
  type MurmurEvent,
  NARRATE_TOOL,
  reduce,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowBoard } from "../src/flow/FlowBoard";
import { partMark, stateWord } from "../src/flow/flow";
import { HelpersTab } from "../src/live/Tabs";
import { PhaseTrack } from "../src/live/Track";
import { Live as Page, roomInJsdom } from "./officeShell";

roomInJsdom();

import { PartDetail } from "../src/part/PartDetail";
import { nowLine, requestMark } from "../src/session";

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 6, 0, 0, n)).toISOString();
const ev = (
  n: number,
  hook: MurmurEvent["hook"],
  payload: Record<string, unknown> = {},
): MurmurEvent => ({
  id: `e${n}`,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/p",
  ts: at(n),
  hook,
  payload,
});
const call = (n: number, tool_name: string, tool_input: unknown) =>
  ev(n, "PostToolUse", { tool_name, tool_input, tool_use_id: `t${n}` });

const PLAN: MapInput = {
  kind: "feature",
  goal: "A demo with a voiceover",
  phases: [
    {
      id: "p1",
      title: "Mockup",
      tasks: [
        { id: "t1", title: "Player shell", part: "shell" },
        { id: "t2", title: "Scenes 1-4", part: "scenes" },
      ],
    },
    {
      id: "p2",
      title: "Voice",
      tasks: [{ id: "t3", title: "Record the narration", part: "voice" }],
    },
  ],
  parts: [
    { id: "shell", title: "Player shell", phase: "p1" },
    { id: "scenes", title: "Scene files", phase: "p1" },
    { id: "voice", title: "Narration", phase: "p2" },
  ],
};
const ASK = "The voice site is signed out. Please sign in to it.";
const helperCall = (n: number, description: string) =>
  ev(n, "PreToolUse", {
    tool_name: "Agent",
    tool_use_id: `t${n}`,
    tool_input: { description, prompt: description },
  });
const start = (n: number, id: string) =>
  ev(n, "SubagentStart", { agent_id: id, agent_type: "" });

function live(extra: MurmurEvent[] = []): MurmurEvent[] {
  return [
    ev(1, "UserPromptSubmit", { prompt: "build the demo" }),
    call(2, MAP_TOOL, PLAN),
    call(3, NARRATE_TOOL, {
      now: "x",
      why: "y",
      task: "t1",
      taskStatus: "done",
    }),
    helperCall(4, "Build scenes 1, 2"),
    start(5, "h1"),
    call(6, NARRATE_TOOL, {
      now: "Needs a sign-in",
      why: "y",
      task: "t3",
      taskStatus: "blocked",
    }),
    ev(7, "AssistantText", { text: ASK }),
    ev(8, "Stop", { last_assistant_message: ASK }),
    {
      ...ev(9, "PostToolUse", {
        tool_name: "Write",
        tool_use_id: "t9",
        tool_input: { file_path: "/p/s1.js" },
        tool_response: {
          type: "create",
          filePath: "/p/s1.js",
          content: "x\n",
          structuredPatch: [],
        },
        agent_id: "h1",
      }),
    },
    {
      ...ev(10, "PostToolUse", {
        tool_name: "Bash",
        tool_use_id: "t10",
        tool_input: { command: "node shot", description: "Reshoot scene 2" },
        agent_id: "h1",
      }),
    },
    ...extra,
  ];
}

function Live(p: React.ComponentProps<typeof Page>) {
  return <Page {...p} />;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ decisions: [] }), { status: 200 }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("waiting on you while helpers work", () => {
  const events = live();
  const view = reduce(events);
  const req = view.requests[0] as (typeof view.requests)[number];

  it("reads waiting, though a helper still runs", () => {
    expect(requestMark(view, req, events)).toMatchObject({
      mark: "waiting",
      state: "waiting",
    });
  });

  it("leads the brief with the ask, once, and says who is still working", () => {
    // Minutes after its last event: the helper is fresh, at its desk in the room.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(at(600)));
    render(
      <Live
        sessionId="s1"
        requestId="e1"
        view={view}
        status="live"
        lastLooked={null}
      />,
    );
    const stands = screen.getByRole("region", { name: "Where it stands" });
    expect(stands.textContent).toContain("Sign in to it");
    const call = screen.getByRole("region", { name: "Waiting on you" });
    expect(call.textContent).not.toContain("Sign in to it");
    // The bar says both: waiting on you, and the helper still at work.
    const bar = document.querySelector(".of-top") as HTMLElement;
    expect(bar.querySelector(".of-pill")?.textContent).toContain(
      "Waiting on you",
    );
    expect(stands.textContent).toContain("Still running: Build scenes 1, 2.");
    expect(bar.textContent).toContain("1 helper at work");
    vi.useRealTimers();
  });

  it("heads the phase amber and lists a running helper under its own task's phase", () => {
    render(
      <Live
        sessionId="s1"
        requestId="e1"
        view={view}
        status="live"
        lastLooked={null}
      />,
    );
    const voice = document.getElementById("phase-p2") as HTMLElement;
    expect(voice.textContent).toContain("Waiting on you");
    expect(voice.textContent).not.toContain("Build scenes 1, 2");
    const mockup = document.getElementById("phase-p1") as HTMLElement;
    expect(mockup.textContent).toContain("Build scenes 1, 2, running for");
  });

  it("draws the blocked task and its phase amber on the track, never failed", () => {
    const { container } = render(
      <PhaseTrack
        sessionId="s1"
        request={req}
        done={false}
        stopped={false}
        end={at(10)}
      />,
    );
    const voice = container.querySelectorAll(".trk-seg")[1] as HTMLElement;
    expect(voice.className).toContain("blocked");
    expect(voice.textContent).toContain("0 of 1 done · waiting on you");
    expect(voice.querySelector(".mk.waiting")).toBeTruthy();
    expect(container.querySelector(".mk.failed")).toBeNull();
    expect(voice.textContent).not.toContain("not started");
  });

  it("marks the flow card and its band waiting", () => {
    const voice = req.parts.find((p) => p.id === "voice");
    if (!voice) throw new Error("no voice part");
    expect(partMark(req, voice)).toBe("waiting");
    expect(stateWord(req, voice)).toBe("Waiting on you");
    const { container } = render(<FlowBoard sessionId="s1" request={req} />);
    expect(container.querySelector(".fc.waiting")).toBeTruthy();
    expect(container.querySelector(".fc.failed")).toBeNull();
  });

  it("gives the task page the ask, when, and Claude's message", () => {
    const voice = req.parts.find((p) => p.id === "voice");
    if (!voice) throw new Error("no voice part");
    render(
      <PartDetail
        sessionId="s1"
        requestNumber={1}
        request={req}
        part={voice}
        events={events}
      />,
    );
    const ask = screen.getByRole("region", { name: "Waiting on you" });
    expect(ask.textContent).toContain("Sign in to it");
    expect(ask.textContent).toContain("Asked at");
    expect(
      within(ask).getByRole("link", { name: "Read Claude's message" }),
    ).toHaveProperty("href", expect.stringContaining("#m-e7"));
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("Not started");
    expect(page).not.toContain("Failed");
  });

  it("a request a later prompt moved on from waits on nobody", () => {
    const later = reduce(
      live([ev(11, "UserPromptSubmit", { prompt: "something else" })]),
    );
    const first = later.requests[0] as typeof req;
    const voice = first.parts.find((p) => p.id === "voice");
    if (!voice) throw new Error("no voice part");
    expect(partMark(first, voice)).toBe("open");
  });
});

describe("what helpers are at", () => {
  it("names whose action the now line is", () => {
    const events = live();
    const req = reduce(events).requests[0] as ReturnType<
      typeof reduce
    >["requests"][number];
    expect(nowLine(req, events, false).text).toBe(
      "Scenes 1, 2: Reshoot scene 2",
    );
  });

  it("shows a running helper's action and files so far", () => {
    const events = live();
    const req = reduce(events).requests[0] as ReturnType<
      typeof reduce
    >["requests"][number];
    render(<HelpersTab sessionId="s1" request={req} events={events} />);
    expect(screen.getByText("Reshoot scene 2 · 1 file so far")).toBeTruthy();
  });

  it("shows a finished helper's result in a sentence", () => {
    const events = live([
      ev(11, "SubagentStop", {
        agent_id: "h1",
        agent_type: "",
        last_assistant_message: "Both scenes are built. Here is the long part.",
      }),
    ]);
    const req = reduce(events).requests[0] as ReturnType<
      typeof reduce
    >["requests"][number];
    render(<HelpersTab sessionId="s1" request={req} events={events} />);
    expect(screen.getByText("Both scenes are built.")).toBeTruthy();
  });
});
