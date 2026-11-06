import type {
  AgentView,
  MurmurEvent,
  PartView,
  RequestView,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PartDetail } from "../src/part/PartDetail";

afterEach(cleanup);

function part(p: Partial<PartView> & { id: string; title: string }): PartView {
  return {
    status: "todo",
    links: [],
    steps: [],
    files: [],
    choices: [],
    checks: [],
    words: [],
    agents: [],
    failures: 0,
    ...p,
  };
}

const agent: AgentView = {
  id: "a1",
  type: "general-purpose",
  description: "writes tests",
  prompt: "Write the tests for the endpoint",
  status: "running",
  startedAt: "2026-11-06T10:00:00Z",
};

function request(parts: PartView[], r: Partial<RequestView> = {}) {
  return {
    id: "r1",
    prompt: "add price alerts",
    startedAt: "2026-11-06T10:00:00Z",
    kind: "feature",
    kindInferred: false,
    goal: "Price alerts",
    phases: [
      {
        id: "p1",
        title: "Server",
        status: "now",
        tasks: [
          {
            id: "t1",
            title: "Build endpoint",
            part: "endpoint",
            status: "failed",
            agents: [],
            problem: "Tests keep failing",
          },
        ],
      },
    ],
    planInferred: false,
    parts,
    looseFiles: [],
    now: null,
    agents: [agent],
    assumptions: [],
    flags: [],
    ...r,
  } as RequestView;
}

const ev = (id: string, payload: Record<string, unknown>): MurmurEvent => ({
  id,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/p",
  ts: "2026-11-06T10:00:01Z",
  hook: "PostToolUse",
  payload,
});

const events = [
  ev("e1", {
    tool_name: "Edit",
    tool_response: {
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
  }),
  ev("e2", { tool_name: "Bash", command: "pnpm test" }),
];

const full = part({
  id: "endpoint",
  title: "Server endpoint",
  status: "now",
  failures: 1,
  aim: { aim: "Accept alert requests", doneWhen: "the test passes" },
  io: { gets: "a price and a target", gives: "a saved alert" },
  agents: ["a1"],
  steps: [
    { ts: "t", text: "Read the code", status: "done", eventIds: [] },
    { ts: "t", text: "Wrote the route", status: "failed", eventIds: ["e1"] },
    { ts: "t", text: "Running tests", status: "running", eventIds: ["e2"] },
  ],
  files: [
    {
      path: "src/alerts.ts",
      role: "the route",
      added: 4,
      removed: 1,
      isNew: false,
      eventIds: ["e1"],
    },
  ],
  choices: [
    { choice: "Use polling", reason: "simple", assumption: false },
    { choice: "Ten second delay", reason: "fast enough", assumption: true },
  ],
  checks: [{ check: "route test", status: "fail" }],
  words: [{ term: "alert", meaning: "a saved price target" }],
});

function show(p: PartView, r = request([p])) {
  return render(
    <PartDetail
      sessionId="s1"
      request={r}
      part={p}
      events={events}
      onBack={() => {}}
    />,
  );
}

describe("PartDetail", () => {
  it("shows aim and done-when", () => {
    show(full);
    expect(
      screen.getByRole("heading", { level: 1, name: "Server endpoint" }),
    ).toBeTruthy();
    expect(screen.getByText("Accept alert requests")).toBeTruthy();
    expect(screen.getByText(/Done when the test passes/)).toBeTruthy();
    expect(screen.getByText("Tests keep failing")).toBeTruthy();
  });

  it("steps keep order and failed ones are red", () => {
    show(full);
    const items = screen.getAllByRole("listitem", { name: /step/i });
    expect(items.map((i) => i.textContent?.replace("raw ›", ""))).toEqual([
      "Read the code",
      "Wrote the route",
      "Running tests",
    ]);
    expect(items.map((i) => i.querySelector(".sdot")?.className)).toEqual([
      "sdot done",
      "sdot failed",
      "sdot running",
    ]);
  });

  it("raw button shows the events as JSON", async () => {
    show(full);
    const btn = screen.getAllByRole("button", {
      name: /raw/,
    })[1] as HTMLElement;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"command": "pnpm test"/)).toBeTruthy();
  });

  it("file row shows counts and role and opens the diff", async () => {
    show(full);
    const row = screen.getByRole("button", { name: /src\/alerts\.ts/ });
    expect(row.textContent).toContain("+4");
    expect(row.textContent).toContain("−1");
    expect(row.textContent).toContain("edited");
    expect(row.textContent).toContain("the route");
    await userEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("@@ -3,2 +3,2 @@")).toBeTruthy();
    expect(screen.getByText("+new line").className).toContain("add");
    expect(screen.getByText("-old line").className).toContain("del");
  });

  it("a created file shows its content as added lines", async () => {
    const p = part({
      id: "x",
      title: "X",
      files: [
        { path: "a.ts", added: 2, removed: 0, isNew: true, eventIds: ["w"] },
      ],
    });
    render(
      <PartDetail
        sessionId="s1"
        request={request([p])}
        part={p}
        events={[
          ev("w", {
            tool_response: {
              type: "create",
              content: "one\ntwo",
              structuredPatch: [],
            },
          }),
        ]}
        onBack={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /a\.ts/ }));
    expect(screen.getByText("+two")).toBeTruthy();
  });

  it("assumption choice carries the assumption line", () => {
    show(full);
    const li = screen
      .getByText("Ten second delay")
      .closest("li") as HTMLElement;
    expect(
      within(li).getByText("Claude's assumption. You never said this."),
    ).toBeTruthy();
    const other = screen.getByText("Use polling").closest("li") as HTMLElement;
    expect(within(other).queryByText(/never said/)).toBeNull();
  });

  it("agent brief sits behind a disclosure", () => {
    show(full);
    expect(screen.getByText("Agent 1 · writes tests")).toBeTruthy();
    expect(screen.getByText("Write the tests for the endpoint")).toBeTruthy();
  });

  it("empty sections are hidden", () => {
    show(part({ id: "bare", title: "Bare part" }));
    for (const h of [
      "Aim",
      "What it did, in order",
      "Files touched",
      "Choices it made",
      "Checked so far",
      "Words used here",
      "What goes in and out",
      "Who's on it",
    ])
      expect(screen.queryByText(new RegExp(h))).toBeNull();
    expect(screen.getByText("not started")).toBeTruthy();
  });

  it("three failures read as stuck", () => {
    show({ ...full, failures: 3 });
    expect(screen.getByText("stuck")).toBeTruthy();
  });
});
