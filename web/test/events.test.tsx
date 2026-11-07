import type { AgentView, MurmurEvent } from "@murmur/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DiffView, hunksOf, hunksOfEvent } from "../src/part/Diff";
import { EventView } from "../src/part/EventView";
import { clock } from "../src/story";

afterEach(cleanup);

let n = 0;
function ev(
  hook: MurmurEvent["hook"],
  payload: Record<string, unknown>,
  id = `e${++n}`,
): MurmurEvent {
  return {
    id,
    sessionId: "s1",
    machineId: "m1",
    cwd: "/x/app",
    ts: "2026-11-06T10:00:01Z",
    hook,
    payload,
  };
}

function pair(
  tool: string,
  input: Record<string, unknown>,
  response?: unknown,
  failed = false,
) {
  const use = `toolu_${++n}`;
  const pre = ev("PreToolUse", {
    tool_name: tool,
    tool_input: input,
    tool_use_id: use,
  });
  const post =
    response === undefined
      ? []
      : [
          ev(failed ? "PostToolUseFailure" : "PostToolUse", {
            tool_name: tool,
            tool_input: input,
            tool_use_id: use,
            tool_response: response,
          }),
        ];
  return { pre, events: [pre, ...post] };
}

function view(eventId: string, events: MurmurEvent[], agents?: AgentView[]) {
  return render(
    <EventView
      eventId={eventId}
      events={events}
      cwd="/x/app"
      {...(agents ? { agents } : {})}
    />,
  );
}

const noJson = (c: HTMLElement) => {
  expect(c.textContent).not.toMatch(/[{[]\s*"/);
  expect(c.textContent).not.toContain("tool_input");
};

describe("readable event views", () => {
  it("a command reads as a terminal block with its first output lines and exit status", async () => {
    const out = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const { pre, events } = pair(
      "Bash",
      { command: "pnpm test", description: "Run the tests" },
      { stdout: out, stderr: "", interrupted: false },
    );
    const { container } = view(pre.id, events);
    expect(screen.getByText("Run the tests")).toBeTruthy();
    expect(screen.getByText("pnpm test")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(container.textContent).toContain("line 1");
    expect(container.textContent).not.toContain("line 30");
    await userEvent.click(
      screen.getByRole("button", { name: "Show all 30 lines" }),
    );
    expect(container.textContent).toContain("line 30");
    noJson(container);
  });

  it("a failed command shows its exit code and error", () => {
    const { pre, events } = pair(
      "Bash",
      { command: "python3 crop.py" },
      "Error: Exit code 1\nModuleNotFoundError: No module named 'PIL'",
      true,
    );
    const { container } = view(pre.id, events);
    expect(screen.getByText("Failed, exit 1")).toBeTruthy();
    expect(container.textContent).toContain("No module named 'PIL'");
    expect(container.textContent).not.toContain("Error: Exit code 1");
  });

  it("a command with no result yet says so", () => {
    const { pre, events } = pair("Bash", { command: "sleep 5" });
    view(pre.id, events);
    expect(screen.getByText("No result yet")).toBeTruthy();
  });

  it("an Edit reads as a diff of the file", () => {
    const { events } = pair(
      "Edit",
      { file_path: "/x/app/src/a.ts", old_string: "old", new_string: "new" },
      {
        filePath: "/x/app/src/a.ts",
        structuredPatch: [
          {
            oldStart: 3,
            oldLines: 2,
            newStart: 3,
            newLines: 2,
            lines: [" keep", "-old line", "+new line"],
          },
        ],
      },
    );
    const post = events[1] as MurmurEvent;
    const { container } = view(post.id, events);
    expect(container.textContent).toContain("Edited");
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("new line").closest(".dl")?.className).toContain(
      "add",
    );
    noJson(container);
  });

  it("an Edit with no result yet shows its old and new text as a diff", () => {
    const { pre, events } = pair("Edit", {
      file_path: "/x/app/src/a.ts",
      old_string: "a\nb",
      new_string: "c",
    });
    view(pre.id, events);
    expect(screen.getByText("b").closest(".dl")?.className).toContain("del");
    expect(screen.getByText("c").closest(".dl")?.className).toContain("add");
  });

  it("a Write that created a file shows its lines as added", () => {
    const { pre, events } = pair(
      "Write",
      { file_path: "/x/app/new.md", content: "one\ntwo" },
      { type: "create", filePath: "/x/app/new.md", structuredPatch: [] },
    );
    const { container } = view(pre.id, events);
    expect(container.textContent).toContain("Created");
    expect(screen.getByText("two").closest(".dl")?.className).toContain("add");
  });

  it("a Read reads as Read and the path", () => {
    const { pre, events } = pair(
      "Read",
      { file_path: "/x/app/src/theme.css", offset: 10, limit: 40 },
      { type: "text", file: { filePath: "/x/app/src/theme.css" } },
    );
    const { container } = view(pre.id, events);
    expect(container.textContent).toContain("Read");
    expect(screen.getByText("src/theme.css")).toBeTruthy();
    expect(container.textContent).toContain("lines 10 to 49");
    noJson(container);
  });

  it("a helper call shows its brief and its report", () => {
    const prompt =
      "## Context\n\nThis is the **first** task.\n\n## Rules\n\n- Test first";
    const { pre, events } = pair("Agent", {
      description: "Build Task 1: tokens",
      prompt,
      model: "sonnet",
    });
    const agent: AgentView = {
      id: "a1",
      type: "general-purpose",
      description: "Build Task 1: tokens",
      prompt,
      status: "done",
      startedAt: "2026-11-06T10:00:01Z",
      brief: "This is the first task.",
      report: {
        status: "completed",
        summary: "",
        text: "Status: DONE\n\nThe tests **pass**.",
        verdict: "DONE",
        ts: "2026-11-06T10:05:00Z",
        interim: false,
      },
    };
    const { container } = view(pre.id, events, [agent]);
    expect(screen.getByText("Build Task 1: tokens")).toBeTruthy();
    expect(container.textContent).toContain("Sonnet");
    expect(screen.getByText("This is the first task.")).toBeTruthy();
    expect(container.querySelector(".ev-report strong")?.textContent).toBe(
      "pass",
    );
    expect(screen.getByText("Done")).toBeTruthy();
    expect(container.textContent).toContain("The tests pass.");
    noJson(container);
  });

  it("a narrate call reads as its text", () => {
    const { pre, events } = pair("mcp__plugin_murmur_murmur__narrate", {
      now: "Merged staging in, tests green",
      why: "Phase 2 needs a task list",
      step: { text: "Merged staging", status: "done" },
    });
    const { container } = view(pre.id, events);
    expect(screen.getByText("Merged staging in, tests green")).toBeTruthy();
    expect(screen.getByText("Phase 2 needs a task list")).toBeTruthy();
    noJson(container);
  });

  it("a map call reads as its goal and plan", () => {
    const { pre, events } = pair("mcp__plugin_murmur_murmur__map", {
      goal: "Start Phase 2",
      kind: "feature",
      parts: [],
      phases: [
        {
          id: "p",
          title: "Plan Phase 2",
          tasks: [{ id: "t", title: "Write the task list" }],
        },
      ],
    });
    const { container } = view(pre.id, events);
    expect(screen.getByText("Start Phase 2")).toBeTruthy();
    expect(screen.getByText("Plan Phase 2")).toBeTruthy();
    expect(screen.getByText("Write the task list")).toBeTruthy();
    noJson(container);
  });

  it("an MCP tool reads as its name and main inputs", () => {
    const { pre, events } = pair(
      "mcp__claude-in-chrome__navigate",
      { url: "https://tradara.in/agents", tabId: 86917, extra: { a: 1 } },
      [{ type: "text", text: "Navigated to https://tradara.in/agents" }],
    );
    const { container } = view(pre.id, events);
    expect(screen.getByText("Navigate")).toBeTruthy();
    expect(container.textContent).toContain("claude-in-chrome");
    expect(screen.getByText("https://tradara.in/agents")).toBeTruthy();
    expect(container.textContent).toContain("Navigated to");
    noJson(container);
  });

  it("keeps the event data behind a small toggle at the bottom", async () => {
    const { pre, events } = pair(
      "Bash",
      { command: "pnpm test" },
      { stdout: "ok", stderr: "" },
    );
    const { container } = view(pre.id, events);
    noJson(container);
    const btn = screen.getByRole("button", { name: "Event data" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(btn);
    expect(container.textContent).toContain('"command": "pnpm test"');
  });

  it("an unknown event id says it is not loaded", () => {
    view("nope", []);
    expect(screen.getByText("This event is not loaded.")).toBeTruthy();
  });
});

describe("DiffView", () => {
  const hunks = [
    {
      oldStart: 3,
      oldLines: 3,
      newStart: 3,
      newLines: 3,
      lines: [" keep", "-old line", "+new line", " tail"],
    },
    {
      oldStart: 40,
      oldLines: 1,
      newStart: 40,
      newLines: 2,
      lines: [" ctx", "+added"],
    },
  ];

  it("numbers lines, tints added and removed ones, and separates hunks", () => {
    const { container } = render(<DiffView hunks={hunks} />);
    const row = (t: string) =>
      screen.getByText(t).closest(".dl") as HTMLElement;
    expect(row("old line").className).toContain("del");
    expect(row("new line").className).toContain("add");
    expect(row("keep").className).toContain("ctx");
    const nums = (t: string) =>
      [...row(t).querySelectorAll(".ln")].map((x) => x.textContent);
    expect(nums("keep")).toEqual(["3", "3"]);
    expect(nums("old line")).toEqual(["4", ""]);
    expect(nums("new line")).toEqual(["", "4"]);
    expect(nums("tail")).toEqual(["5", "5"]);
    expect(nums("added")).toEqual(["", "41"]);
    expect(container.querySelectorAll(".dl.hunk").length).toBe(2);
    expect(container.textContent).not.toContain("@@");
  });

  it("folds a long diff", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `+l${i}`);
    render(
      <DiffView
        hunks={[
          { oldStart: 0, oldLines: 0, newStart: 1, newLines: 200, lines },
        ]}
      />,
    );
    expect(screen.queryByText("l199")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Show all 200 lines" }),
    );
    expect(screen.getByText("l199")).toBeTruthy();
  });
});

describe("round 3 diffs and views", () => {
  const patch = (lines: unknown[], start = 3) => ({
    oldStart: start,
    oldLines: 1,
    newStart: start,
    newLines: 1,
    lines,
  });

  it("a file changed by several edits has a divider before each later edit", () => {
    const e1 = ev("PostToolUse", {
      tool_name: "Edit",
      tool_response: {
        filePath: "/x/app/a.ts",
        structuredPatch: [patch(["-a", "+b"])],
      },
    });
    const e2 = {
      ...ev("PostToolUse", {
        tool_name: "Edit",
        tool_response: {
          filePath: "/x/app/a.ts",
          structuredPatch: [patch(["-c", "+d"], 9)],
        },
      }),
      ts: "2026-11-06T10:13:00Z",
    };
    const file = {
      path: "a.ts",
      added: 2,
      removed: 2,
      isNew: false,
      eventIds: [e1.id, e2.id],
    };
    const byId = new Map([e1, e2].map((e) => [e.id, e]));
    const { container } = render(<DiffView hunks={hunksOf(file, byId)} />);
    const dividers = [...container.querySelectorAll(".dl.edit")].map(
      (d) => d.textContent,
    );
    expect(dividers).toEqual([`Edit 2 · ${clock("2026-11-06T10:13:00Z")}`]);
  });

  it("drops lines that are not text", () => {
    const e = ev("PostToolUse", {
      tool_name: "Edit",
      tool_response: {
        filePath: "/x/app/a.ts",
        structuredPatch: [patch([" keep", 42, null, "+new"])],
      },
    });
    const { container } = render(<DiffView hunks={hunksOfEvent(e)} />);
    expect(
      [...container.querySelectorAll(".dl-text")].map((t) => t.textContent),
    ).toEqual(["keep", "new"]);
  });

  it("a pending Edit shows no made-up line numbers", () => {
    const { pre, events } = pair("Edit", {
      file_path: "/x/app/src/a.ts",
      old_string: "a",
      new_string: "c",
    });
    const { container } = view(pre.id, events);
    expect(
      [...container.querySelectorAll(".ln")].every((l) => l.textContent === ""),
    ).toBe(true);
    expect(container.textContent).not.toMatch(/Lines? 1/);
  });

  it("a MultiEdit with no patch shows each of its edits", () => {
    const { pre, events } = pair("MultiEdit", {
      file_path: "/x/app/src/a.ts",
      edits: [
        { old_string: "one", new_string: "uno" },
        { old_string: "two", new_string: "dos" },
      ],
    });
    view(pre.id, events);
    for (const t of ["one", "uno", "two", "dos"])
      expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText("Edit 2")).toBeTruthy();
  });

  it("a command can leave its title to the line above it", () => {
    const { pre, events } = pair(
      "Bash",
      { command: "pnpm test", description: "Run the tests" },
      { stdout: "ok", stderr: "" },
    );
    render(
      <EventView eventId={pre.id} events={events} cwd="/x/app" quietTitle />,
    );
    expect(screen.queryByText("Run the tests")).toBeNull();
    expect(screen.getByText("Command")).toBeTruthy();
  });

  it("a helper call never shows a brief that only addresses the helper", () => {
    const prompt = "You are reviewing one task. Read the diff.";
    const { pre, events } = pair("Agent", {
      description: "Review Task 1",
      prompt,
    });
    const agent: AgentView = {
      id: "a1",
      type: "general-purpose",
      description: "Review Task 1",
      prompt,
      status: "done",
      startedAt: "2026-11-06T10:00:01Z",
      brief: "You are reviewing one task.",
    };
    const { container } = view(pre.id, events, [agent]);
    expect(container.querySelector(".ev-brief")).toBeNull();
    expect(container.textContent).not.toContain("Read the diff");
  });
});
