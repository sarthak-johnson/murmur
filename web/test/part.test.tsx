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
import { clock } from "../src/story";

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
  ev("e2", { tool_name: "Bash", tool_input: { command: "pnpm test" } }),
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
  return render(<PartDetail request={r} part={p} events={events} />);
}

const at = (min: number) =>
  new Date(Date.UTC(2026, 10, 6, 10, min)).toISOString();

/** Task 1 the way the inferred history builds it: three helper calls, with reports. */
function task1(over: { agents?: Partial<AgentView>[] } = {}) {
  const call = (
    id: string,
    description: string,
    model: string,
    min: number,
  ) => ({
    ...ev(id, {
      tool_name: "Agent",
      tool_input: { description, model, prompt: `Brief for ${id}` },
    }),
    hook: "PreToolUse" as const,
    ts: at(min),
  });
  const calls = [
    call("c1", "Build Task 1: tokens", "sonnet", 10),
    call("c2", "Review Task 1", "opus", 12),
    call("c3", "Re-review Task 1", "sonnet", 14),
  ];
  const report = (text: string, verdict: string | undefined, min: number) => ({
    status: "completed",
    summary: "",
    text,
    ts: at(min),
    interim: false,
    ...(verdict ? { verdict } : {}),
  });
  const base: AgentView[] = [
    {
      ...agent,
      id: "a1",
      description: "Build Task 1: tokens",
      prompt: "Brief for c1",
      status: "done",
      startedAt: at(10),
      brief:
        "This is the first task: it adds the design tokens every later part reads, in `index.css`.",
      report: report(
        "Status: DONE_WITH_CONCERNS\nCommit: df095803a\n\n## Summary\n\nThe new token tests **pass**.\n\n**Concerns:**\n- Opacity steps on `--l2` won't work\n- One test on staging already fails",
        "DONE_WITH_CONCERNS",
        11,
      ),
    },
    {
      ...agent,
      id: "a2",
      description: "Review Task 1",
      prompt: "Brief for c2",
      status: "done",
      startedAt: at(12),
      report: report(
        "Status: ISSUES_FOUND\n\nThe lit values are the pre-review ones.",
        "ISSUES_FOUND",
        13,
      ),
    },
    {
      ...agent,
      id: "a3",
      description: "Re-review Task 1",
      prompt: "Brief for c3",
      status: "done",
      startedAt: at(14),
      report: report(
        "Status: APPROVED\nCommit: 2b3689eb3\n\nLooks right.",
        "APPROVED",
        15,
      ),
    },
  ];
  const agents = base.map(
    (a, i) => ({ ...a, ...(over.agents?.[i] ?? {}) }) as AgentView,
  );
  const p = part({
    id: "task:1",
    title: "Task 1: Lit plate tokens",
    status: "done",
    span: { start: at(10), end: at(15) },
    agents: ["a1", "a2", "a3"],
    steps: [
      {
        ts: at(10),
        text: "Built",
        status: "done",
        agentId: "a1",
        eventIds: ["c1"],
      },
      {
        ts: at(12),
        text: "Reviewed",
        status: "done",
        agentId: "a2",
        eventIds: ["c2"],
      },
      {
        ts: at(14),
        text: "Re-reviewed",
        status: "done",
        agentId: "a3",
        eventIds: ["c3"],
      },
    ],
  });
  const r = request([p], {
    planInferred: true,
    phases: [],
    agents,
    messages: [
      {
        id: "m1",
        ts: at(13),
        text: "The review found one real problem: the **gain** colours were weak.",
        task: "task:1",
        agent: "a2",
      },
    ],
  });
  return { p, r, calls };
}

function showTask1(t = task1()) {
  return render(<PartDetail request={t.r} part={t.p} events={t.calls} />);
}

const section = (name: string) => screen.getByRole("region", { name });

describe("PartDetail", () => {
  it("shows aim and done-when as what it was for", () => {
    show(full);
    expect(
      screen.getByRole("heading", { level: 1, name: "Server endpoint" }),
    ).toBeTruthy();
    const why = section("What it was for");
    expect(within(why).getByText("Accept alert requests")).toBeTruthy();
    expect(why.textContent).toContain("Done when the test passes");
    // Claude's own aim needs no source line.
    expect(why.querySelector(".source")).toBeNull();
    expect(screen.getByText("Tests keep failing")).toBeTruthy();
  });

  it("steps keep order and failed ones are red", () => {
    show(full);
    const items = screen.getAllByRole("listitem", { name: /step/i });
    // Claude's own steps read who, then the one-line fact.
    expect(
      items.map((i) => i.querySelector(".step-title")?.textContent),
    ).toEqual(["Claude", "Claude", "Claude"]);
    expect(
      items.map((i) => i.querySelector(".step-lead")?.textContent),
    ).toEqual(["Read the code", "Wrote the route", "Running tests"]);
    expect(items.map((i) => i.querySelector(".sdot")?.className)).toEqual([
      "sdot done",
      "sdot failed",
      "sdot running",
    ]);
  });

  it("a step's Details reads as what it is, with its data behind a toggle", async () => {
    show(full);
    expect(document.body.textContent).not.toMatch(/[{[]\s*"/);
    const btn = screen.getAllByRole("button", {
      name: "Details",
    })[1] as HTMLElement;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("pnpm test")).toBeTruthy();
    expect(document.body.textContent).not.toContain('"command"');
    await userEvent.click(screen.getByRole("button", { name: "Event data" }));
    expect(screen.getByText(/"command": "pnpm test"/)).toBeTruthy();
  });

  it("a step from Claude's own note shows its why and no Details that would repeat it", () => {
    const note = ev("n1", {
      tool_name: "mcp__plugin_murmur_murmur__narrate",
      tool_input: {
        now: "Data recording built and in review; styles started",
        why: "keeps it moving while its first piece is checked",
      },
    });
    const p = part({
      id: "endpoint",
      title: "Server endpoint",
      steps: [
        {
          ts: "t",
          text: "Data recording built and in review; styles started",
          status: "done",
          eventIds: ["n1"],
        },
      ],
    });
    render(<PartDetail request={request([p])} part={p} events={[note]} />);
    const card = screen.getByRole("listitem", { name: /step/ });
    expect(card.querySelector(".step-lead")?.textContent).toBe(
      "Data recording built and in review; styles started",
    );
    expect(card.querySelector(".step-why")?.textContent).toBe(
      "Keeps it moving while its first piece is checked",
    );
    expect(within(card).queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("a file sits under what it does, shows its counts and opens a diff view", async () => {
    show(full);
    const row = screen.getByRole("button", { name: /alerts\.ts/ });
    expect(row.textContent).toContain("+4");
    expect(row.textContent).toContain("−1");
    // Only a new file is tagged; an edited one needs no word.
    expect(row.textContent).not.toContain("edited");
    expect(row.closest(".fcard")?.querySelector("h3")?.textContent).toBe(
      "The route",
    );
    await userEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("new line").closest(".dl")?.className).toContain(
      "add",
    );
    expect(screen.getByText("old line").closest(".dl")?.className).toContain(
      "del",
    );
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
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /a\.ts/ }));
    expect(screen.getByText("two").closest(".dl")?.className).toContain("add");
  });

  it("a file changed through a command shows its diff", async () => {
    const p = part({
      id: "x",
      title: "X",
      files: [
        {
          path: "src/b.css",
          added: 1,
          removed: 0,
          isNew: false,
          eventIds: ["b"],
        },
      ],
    });
    render(
      <PartDetail
        cwd="/p"
        request={request([p])}
        part={p}
        events={[
          ev("b", {
            tool_name: "Bash",
            tool_response: {
              stdout: "",
              bashEditDiff: {
                files: [
                  {
                    filePath: "/p/src/b.css",
                    hunks: [
                      {
                        oldStart: 1,
                        oldLines: 0,
                        newStart: 1,
                        newLines: 1,
                        lines: ["+--l2: #A6F4DC;"],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /b\.css/ }));
    expect(screen.getByText("--l2: #A6F4DC;")).toBeTruthy();
  });

  it("a non-assumption choice stays a choice; an assumption is left open", () => {
    show(full);
    const choices = section("Choices");
    expect(within(choices).getByText("Use polling")).toBeTruthy();
    expect(within(choices).queryByText("Ten second delay")).toBeNull();
    const open = section("Left open");
    const li = within(open)
      .getByText("Ten second delay")
      .closest("li") as HTMLElement;
    expect(
      within(li).getByText("Claude's assumption. You never said this."),
    ).toBeTruthy();
  });

  it("a helper's brief opens as formatted text, not code", async () => {
    show(full);
    const who = section("Who's on it");
    expect(within(who).getByText("Agent 1 · writes tests")).toBeTruthy();
    await userEvent.click(within(who).getByRole("button", { name: "Brief" }));
    const brief = within(who).getByText("Write the tests for the endpoint");
    expect(brief.closest(".md")).toBeTruthy();
    expect(brief.closest("pre")).toBeNull();
  });

  it("empty sections are hidden", () => {
    show(part({ id: "bare", title: "Bare part" }));
    for (const h of [
      "What it was for",
      "How it went",
      "Files, by what they do",
      "Left open",
      "Choices",
      "Checked",
      "Words used here",
      "What goes in and out",
      "Who's on it",
    ])
      expect(screen.queryByRole("region", { name: h })).toBeNull();
    expect(screen.queryByRole("group", { name: "Summary" })).toBeNull();
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it("a part with no detail says so under the title", () => {
    show(part({ id: "bare", title: "Bare part" }));
    expect(
      screen.getByText("Claude has not described this part yet."),
    ).toBeTruthy();
    cleanup();
    show(full);
    expect(
      screen.queryByText("Claude has not described this part yet."),
    ).toBeNull();
  });

  it("an inferred part is tagged and its files read as paths a person knows", async () => {
    const tmp =
      "/private/tmp/claude-501/-x-app/27a000a1-7dbc-4dd1-ab83-961149fc03ae";
    const files = Array.from({ length: 9 }, (_, i) => ({
      path: `${tmp}/scratchpad/f${i}.css`,
      added: 1,
      removed: 0,
      isNew: true,
      eventIds: [],
    }));
    const p = part({
      id: "task:1",
      title: "Task 1: Lit plate tokens",
      status: "done",
      files,
      steps: [{ ts: "t", text: "Built", status: "done", eventIds: [] }],
    });
    render(
      <PartDetail
        cwd="/x/app"
        request={request([p], { planInferred: true })}
        part={p}
        events={events}
      />,
    );
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("Lit plate tokens");
    expect(
      screen.getByRole("group", { name: "Where it sits" }).textContent,
    ).toContain("inferred");
    // The folder they share is said once, readable; each row keeps its full path as its title.
    const box = screen.getByRole("region", { name: "Files, by what they do" });
    expect(within(box).getByRole("heading", { level: 2 }).textContent).toBe(
      "Files, by what they do 9in scratchpad",
    );
    const shown = within(box).getByText("f0.css");
    expect(shown.getAttribute("title")).toBe(`${tmp}/scratchpad/f0.css`);
    expect(screen.queryByText("f8.css")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show all 9" }));
    expect(screen.getByText("f8.css")).toBeTruthy();
    expect(
      screen.queryByText("Claude has not described this part yet."),
    ).toBeNull();
  });

  it("three failures read as stuck", () => {
    show({ ...full, failures: 3 });
    expect(screen.getByText("Stuck")).toBeTruthy();
  });

  it("zero counts are faint, non-zero ones keep their colour", () => {
    const p = part({
      id: "z",
      title: "Z",
      files: [
        { path: "a.ts", added: 0, removed: 0, isNew: false, eventIds: [] },
        { path: "b.ts", added: 2, removed: 3, isNew: false, eventIds: [] },
      ],
    });
    show(p);
    const cls = (path: string) =>
      [
        ...(screen.getByRole("button", { name: new RegExp(path) }).children ??
          []),
      ]
        .slice(1, 3)
        .map((c) => c.className);
    expect(cls("a\\.ts")).toEqual(["pd-add zero", "pd-del zero"]);
    expect(cls("b\\.ts")).toEqual(["pd-add", "pd-del"]);
  });

  it("opening another part closes the open panels", async () => {
    const other = part({
      id: "other",
      title: "Other",
      steps: [
        { ts: "t", text: "A", status: "done", eventIds: ["e1"] },
        { ts: "t", text: "B", status: "done", eventIds: ["e2"] },
      ],
    });
    const r = request([full, other]);
    const mk = (p: PartView) => (
      <PartDetail request={r} part={p} events={events} />
    );
    const { rerender } = render(mk(full));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Details" })[0] as HTMLElement,
    );
    rerender(mk(other));
    for (const b of screen.getAllByRole("button", { name: "Details" }))
      expect(b.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("task page", () => {
  it("the band shows the time span, helpers, fix rounds and commits", () => {
    showTask1();
    const band = screen.getByRole("group", { name: "Summary" });
    const t = band.textContent ?? "";
    expect(t).toContain(`${clock(at(10))} to ${clock(at(15))}`);
    expect(t).toContain("3 helpers");
    expect(t).toContain("1 fix round");
    expect(within(band).getByText("df095803a")).toBeTruthy();
    expect(within(band).getByText("2b3689eb3")).toBeTruthy();
  });

  it("what it was for falls back to the first helper's brief", () => {
    showTask1();
    const why = section("What it was for");
    expect(why.textContent).toContain(
      "This is the first task: it adds the design tokens",
    );
    expect(within(why).getByText("From the helper's brief")).toBeTruthy();
    expect(why.querySelector("code")?.textContent).toBe("index.css");
    expect(why.textContent).not.toContain("`");
  });

  it("a recap's aim wins; the recap is said once, beside the chips", () => {
    const t = task1();
    t.p.aim = { aim: "Add the Lit plate tokens", doneWhen: "tests pass" };
    t.r.recap = true;
    showTask1(t);
    const why = section("What it was for");
    expect(why.textContent).toContain("Add the Lit plate tokens");
    expect(why.textContent).not.toContain("This is the first task");
    expect(why.querySelector(".source")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Where it sits" }).textContent,
    ).toContain("Recap by Claude");
  });

  it("how it went: one card per step with model, time, verdict and Claude's message", () => {
    showTask1();
    const cards = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    });
    expect(
      cards.map((c) => c.querySelector(".step-title")?.textContent),
    ).toEqual([
      "Built by Agent 1",
      "Reviewed by Agent 2",
      "Rechecked by Agent 3",
    ]);
    const [built, reviewed, rereviewed] = cards as HTMLElement[];
    expect(built?.textContent).toContain(
      `Sonnet · ${clock(at(10))} to ${clock(at(11))}`,
    );
    expect(
      within(built as HTMLElement).getByText("Done, with concerns"),
    ).toBeTruthy();
    // No message from that moment: the report's lead paragraph.
    expect(built?.textContent).toContain("The new token tests pass.");
    expect(reviewed?.textContent).toContain(
      `Opus · ${clock(at(12))} to ${clock(at(13))}`,
    );
    expect(
      within(reviewed as HTMLElement).getByText("Issues found"),
    ).toBeTruthy();
    // Claude's message from that moment, as formatted text.
    expect(reviewed?.querySelector("strong")?.textContent).toBe("gain");
    expect(
      within(rereviewed as HTMLElement).getByText("Approved"),
    ).toBeTruthy();
  });

  it("the helper's full report opens as formatted Markdown in a readable panel", async () => {
    showTask1();
    const built = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    })[0] as HTMLElement;
    const btn = within(built).getByRole("button", {
      name: "Helper's report",
    });
    expect(built.querySelector(".report-panel")).toBeNull();
    await userEvent.click(btn);
    const panel = built.querySelector(".report-panel") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(
      within(panel).getByRole("heading", { name: "Summary" }),
    ).toBeTruthy();
    expect(panel.querySelector("ul li code")?.textContent).toBe("--l2");
    expect(panel.querySelector("pre")).toBeNull();
    expect(panel.textContent).not.toContain("**");
  });

  it("a running helper with no report reads as running, with no report button", () => {
    const t = task1();
    const a = t.r.agents[2] as AgentView;
    a.status = "running";
    delete a.report;
    showTask1(t);
    const last = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    })[2] as HTMLElement;
    expect(within(last).getByText("Running")).toBeTruthy();
    expect(
      within(last).queryByRole("button", { name: "Helper's report" }),
    ).toBeNull();
  });

  it("left open lists the concerns from reports", () => {
    showTask1();
    const open = section("Left open");
    expect(open.textContent).toContain("Opacity steps on --l2 won't work");
    expect(open.textContent).toContain("One test on staging already fails");
  });

  it("left open, the band's commits and fix rounds are hidden when there are none", () => {
    const t = task1({
      agents: [
        {
          report: {
            status: "completed",
            summary: "",
            text: "Built.",
            ts: at(11),
            interim: false,
          },
        },
        {},
        {},
      ],
    });
    // Built and reviewed once, with no re-review helper: no fix round.
    t.p.steps = t.p.steps.slice(0, 2);
    t.p.agents = ["a1", "a2"];
    t.r.agents = t.r.agents.slice(0, 2).map((a) => ({
      ...a,
      ...(a.report ? { report: { ...a.report, text: "Built." } } : {}),
    }));
    showTask1(t);
    expect(screen.queryByRole("region", { name: "Left open" })).toBeNull();
    const band = screen.getByRole("group", { name: "Summary" });
    expect(band.textContent).not.toContain("fix round");
    expect(band.textContent).not.toContain("commit");
  });

  it("a recapped task reads as one list: helper cards led by the recap's steps", async () => {
    const t = task1();
    t.r.recap = true;
    t.r.planInferred = false;
    const recap = (text: string) => ({
      ts: at(5),
      text,
      status: "done" as const,
      eventIds: ["n1"],
    });
    t.p.steps = [
      recap("Builder added the tokens"),
      recap("Review found the weak values; fixed"),
      recap("Recheck passed; I confirmed the values"),
      recap("Done after one fix round."),
    ];
    showTask1(t);
    const how = section("How it went");
    const items = within(how).getAllByRole("listitem", { name: /step/ });
    expect(items).toHaveLength(4);
    const lead = (k: number) =>
      items[k]?.querySelector(".step-lead")?.textContent;
    expect(lead(0)).toBe("Builder added the tokens");
    expect(items[0]?.textContent).toContain("Built by Agent 1");
    expect(items[0]?.textContent).toContain(
      `Sonnet · ${clock(at(10))} to ${clock(at(11))}`,
    );
    expect(lead(1)).toBe("Review found the weak values; fixed");
    expect(items[1]?.textContent).toContain("Reviewed by Agent 2");
    expect(lead(2)).toBe("Recheck passed; I confirmed the values");
    expect(items[2]?.textContent).toContain("Rechecked by Agent 3");
    // The recap's closing line stands as Claude's step, with no made-up time.
    expect(items[3]?.querySelector(".step-title")?.textContent).toBe("Claude");
    expect(items[3]?.querySelector(".step-lead")?.textContent).toBe(
      "Done after one fix round.",
    );
    expect(items[3]?.querySelector(".step-who")).toBeNull();
    expect(within(items[3] as HTMLElement).getByText("Done")).toBeTruthy();
    // No Details that would only repeat a recap step, and no second helper list.
    expect(within(how).queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Who's on it" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Who worked on it" }),
    ).toBeNull();
    // The band counts the fix round from the helpers, and leaves out made-up times.
    const band = screen.getByRole("group", { name: "Summary" });
    expect(band.textContent).toContain("1 fix round");
    expect(band.textContent).toContain(`${clock(at(10))} to ${clock(at(15))}`);
    await userEvent.click(
      within(items[0] as HTMLElement).getByRole("button", {
        name: "Helper's report",
      }),
    );
    expect(items[0]?.querySelector(".report-panel .md")).toBeTruthy();
  });

  it("a helper the recap's steps do not name still gets its card, in time order", () => {
    const t = task1();
    t.r.recap = true;
    t.p.steps = [
      {
        ts: at(5),
        text: "Done after one fix round.",
        status: "done",
        eventIds: [],
      },
    ];
    showTask1(t);
    const items = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    });
    // The recap's closing line goes last, after every helper.
    expect(
      items.map((li) => li.querySelector(".step-title")?.textContent),
    ).toEqual([
      "Built by Agent 1",
      "Reviewed by Agent 2",
      "Rechecked by Agent 3",
      "Claude",
    ]);
    expect(items[3]?.querySelector(".step-lead")?.textContent).toBe(
      "Done after one fix round.",
    );
  });

  it("who's on it reads who worked on it once the task is done", () => {
    show({ ...full, status: "done" });
    expect(
      screen.getByRole("region", { name: "Who worked on it" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Who's on it" })).toBeNull();
  });

  it("a helper card never shows the prompt: message, then report, then a brief about the work", () => {
    const t = task1();
    t.r.recap = true;
    t.p.steps = [];
    const [a1, a2, a3] = t.r.agents as AgentView[];
    // a1: no message linked, a report: its lead paragraph.
    // a3: no message, no report, a brief that only addresses the helper: nothing.
    delete (a3 as AgentView).report;
    (a3 as AgentView).brief =
      "You are re-reviewing one task's fix round. A previous review produced findings.";
    (a3 as AgentView).prompt =
      "You are re-reviewing one task's fix round. A previous review produced findings.";
    // a2 keeps the message linked to it.
    void a1;
    void a2;
    showTask1(t);
    // On a recapped task the helper cards are How it went.
    const who = section("How it went");
    const card = (n: number) =>
      within(who).getAllByRole("listitem", { name: /step/ })[
        n - 1
      ] as HTMLElement;
    expect(card(1).querySelector(".step-text")?.textContent).toBe(
      "The new token tests pass.",
    );
    expect(card(2).querySelector(".step-text")?.textContent).toContain(
      "The review found one real problem",
    );
    expect(card(3).querySelector(".step-text")).toBeNull();
    expect(who.textContent).not.toContain("You are re-reviewing");
  });

  it("a helper with no message or report shows its brief when it is about the work", () => {
    const t = task1();
    t.p.steps = [];
    const a1 = t.r.agents[0] as AgentView;
    delete a1.report;
    showTask1(t);
    const who = section("Who worked on it");
    expect(
      within(who)
        .getByRole("listitem", { name: "helper 1" })
        .querySelector(".step-text")?.textContent,
    ).toContain("This is the first task");
  });

  it("a helper card shows Claude's first word after the report, not a later aside", () => {
    const t = task1();
    t.r.messages = [
      ...(t.r.messages ?? []),
      {
        id: "m2",
        ts: at(14),
        text: "Logged on the tracker. Waiting for the fix.",
        agent: "a2",
      },
    ];
    showTask1(t);
    const reviewed = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    })[1] as HTMLElement;
    expect(reviewed.querySelector(".step-text")?.textContent).toContain(
      "The review found one real problem",
    );
  });

  it("done-when has its own label", () => {
    show(full);
    const why = section("What it was for");
    const label = within(why).getByText("Done when");
    expect(label.className).toContain("lbl-inline");
    expect(label.parentElement?.textContent).toBe("Done when the test passes");
  });

  it("a helper shown as a step card is not listed again under who's on it", () => {
    showTask1();
    expect(screen.queryByRole("region", { name: "Who's on it" })).toBeNull();
  });
});

describe("task page (reshape)", () => {
  /** Task 1 with its rounds, span and neighbours, the way core fills them. */
  function reshaped(over: Partial<PartView> = {}) {
    const t = task1();
    const roles = ["build", "review", "recheck"] as const;
    t.r.agents = t.r.agents.map((a, i) => ({
      ...a,
      role: roles[i] ?? "other",
      subject: "Task 1",
      round: i < 2 ? 1 : 2,
    }));
    Object.assign(t.p, { rounds: 1, span: { start: at(10), end: at(16) } });
    Object.assign(t.p, over);
    const hero = part({
      id: "hero",
      title: "Task 2: HeroMoney",
      status: "now",
      links: [{ to: "task:1", label: "reads" }],
    });
    const plate = part({
      id: "plate",
      title: "Dot field",
      links: [{ to: "task:1", label: "reads" }],
    });
    t.r.parts = [t.p, hero, plate];
    const task = (id: string, title: string, p: string) => ({
      id,
      title,
      part: p,
      status: "done" as const,
      agents: [],
    });
    t.r.phases = [
      {
        id: "p0",
        title: "Phase 0: foundation",
        status: "done",
        tasks: [
          task("t1", "Task 1: Lit plate tokens", "task:1"),
          { ...task("t2", "Task 2: HeroMoney", "hero"), status: "now" },
          task("t3", "Task 3: dot field", "plate"),
        ],
      },
    ];
    for (const m of t.r.messages ?? []) m.task = "t1";
    return t;
  }
  const showIt = (t = reshaped(), p = t.p) =>
    render(
      <PartDetail
        sessionId="s1"
        requestNumber={7}
        request={t.r}
        part={p}
        events={t.calls}
      />,
    );
  const outcome = () =>
    (document.querySelector(".tt .verdict") as HTMLElement).textContent;
  const marks = () =>
    [...document.querySelectorAll(".rounds .rd")].map((m) => m.textContent);

  it("the title line carries the outcome word from status and rounds", () => {
    showIt();
    expect(outcome()).toBe("Done after one fix round");
    cleanup();
    showIt(reshaped({ rounds: 2 }));
    expect(outcome()).toBe("Done after two fix rounds");
    cleanup();
    showIt(reshaped({ rounds: 0 }));
    expect(outcome()).toBe("Done");
    cleanup();
    showIt(reshaped({ status: "now" }));
    expect(outcome()).toBe("In progress");
  });

  it("the facts row reads the time span from core, with how long it took", () => {
    showIt();
    const band = screen.getByRole("group", { name: "Summary" });
    expect(band.textContent).toContain(
      `${clock(at(10))} to ${clock(at(16))}, 6 m`,
    );
    expect(band.textContent).toContain("3 helpers");
  });

  it("round markers sit above the lanes, named by what each round did", () => {
    showIt();
    expect(marks()).toEqual([
      "Round 1 · build and review",
      "Round 2 · recheck",
    ]);
    cleanup();
    // One round needs no marker.
    const t = reshaped();
    for (const a of t.r.agents) a.round = 1;
    showIt(t);
    expect(document.querySelector(".rounds")).toBeNull();
  });

  it("a builder resumed after the review fixes in the next round", () => {
    const t = reshaped();
    const send = {
      ...ev("s1", { tool_name: "SendMessage", tool_input: { to: "a1" } }),
      hook: "PreToolUse" as const,
      ts: at(13),
    };
    t.calls.push(send);
    showIt(t);
    expect(marks()).toEqual([
      "Round 1 · build and review",
      "Round 2 · fix and recheck",
    ]);
  });

  it("Claude's messages about the task are dots on Claude's lane", () => {
    const t = reshaped();
    t.r.messages = [
      ...(t.r.messages ?? []),
      {
        id: "m2",
        ts: at(16),
        text: "Task 1 is done and verified.",
        task: "t1",
      },
      { id: "m3", ts: at(16), text: "Unrelated: the server restarted." },
    ];
    showIt(t);
    const lanes = within(
      screen.getByRole("list", { name: "Timeline" }),
    ).getAllByRole("listitem");
    const claude = lanes.at(-1) as HTMLElement;
    expect(claude.querySelector(".lane-name")?.textContent).toBe(
      "Claude2 messages",
    );
    const dots = [...claude.querySelectorAll(".cdot")];
    expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
      `${clock(at(13))}: The review found one real problem: the gain colours were weak.`,
      `${clock(at(16))}: Task 1 is done and verified.`,
    ]);
    expect(dots.map((d) => d.getAttribute("class"))).toEqual([
      "cdot bad",
      "cdot good",
    ]);
  });

  it("the inferred line shows only on a task Claude never described", () => {
    const line =
      "Claude hasn't described this task itself. This page is read from its helpers, files and messages.";
    showIt();
    expect(screen.queryByText(line)).toBeNull();
    cleanup();
    showIt(reshaped({ inferred: true }));
    expect(screen.getByText(line)).toBeTruthy();
  });

  it("an aim read from the record says where it came from; Claude's own aim says nothing", () => {
    showIt(
      reshaped({
        aim: {
          aim: "It adds the design tokens every later part reads, in `index.css`.",
          doneWhen: "Task 1 is done after one round of fixes.",
          inferred: true,
        },
      }),
    );
    const why = section("What it was for");
    expect(within(why).getByText("From the builder's brief")).toBeTruthy();
    expect(within(why).getByText("read from how it ended")).toBeTruthy();
    cleanup();
    const t = reshaped();
    (t.r.agents[1] as AgentView).brief =
      "Review the chat's styles and small parts for the redesign.";
    t.p.aim = {
      aim: "The chat's styles and small parts for the redesign.",
      doneWhen: "",
      inferred: true,
    };
    delete (t.r.agents[0] as AgentView).brief;
    showIt(t);
    expect(
      within(section("What it was for")).getByText("From the reviewer's brief"),
    ).toBeTruthy();
    expect(screen.queryByText("read from how it ended")).toBeNull();
    cleanup();
    showIt(
      reshaped({ aim: { aim: "Add the tokens", doneWhen: "tests pass" } }),
    );
    const own = section("What it was for");
    expect(own.querySelector(".source")).toBeNull();
    expect(own.textContent).toBe("Add the tokensDone when tests pass");
  });

  it("previous and next follow the plan's order and link to their task pages", () => {
    const t = reshaped();
    showIt(t, t.r.parts[1]);
    const [nav] = screen.getAllByRole("navigation", { name: "Tasks" });
    const prev = within(nav as HTMLElement).getByRole("link", {
      name: /Previous/,
    });
    const next = within(nav as HTMLElement).getByRole("link", {
      name: /Next/,
    });
    expect(prev.textContent).toContain("Task 1 · Lit plate tokens");
    expect(prev.getAttribute("href")).toBe("/s/s1/r/r1?open=task:task:1");
    expect(next.textContent).toContain("Task 3 · Dot field");
    expect(next.getAttribute("href")).toBe("/s/s1/r/r1?open=task:plate");
    cleanup();
    showIt();
    const [first] = screen.getAllByRole("navigation", { name: "Tasks" });
    const f = within(first as HTMLElement);
    expect(f.queryByRole("link", { name: /Previous/ })).toBeNull();
    expect(f.getByRole("link", { name: /Next/ }).textContent).toContain(
      "Task 2 · HeroMoney (running)",
    );
    expect(
      f.getByRole("link", { name: "← Request 7" }).getAttribute("href"),
    ).toBe("/s/s1/r/r1?open=story");
  });

  it("the flow link says how many parts use this one and selects it on the flow board", () => {
    showIt();
    const flow = screen.getByRole("link", { name: "Flow: 2 parts use this" });
    expect(flow.getAttribute("href")).toBe("/s/s1/r/r1?open=flow&part=task%3A1");
    cleanup();
    const t = reshaped();
    showIt(t, t.r.parts[1]);
    expect(
      screen.getByRole("link", { name: "Flow: uses 1 part" }),
    ).toBeTruthy();
    cleanup();
    t.r.parts[2] = { ...(t.r.parts[2] as PartView), links: [] };
    showIt(t, t.r.parts[2]);
    expect(screen.queryByRole("link", { name: /^Flow/ })).toBeNull();
  });

  it("a bare part draws no nav, no flow link, no rounds and no inferred line", () => {
    const bare = part({ id: "bare", title: "Bare" });
    render(
      <PartDetail
        sessionId="s1"
        request={request([bare], { phases: [] })}
        part={bare}
        events={[]}
      />,
    );
    expect(screen.queryByRole("navigation", { name: "Tasks" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector(".rounds")).toBeNull();
    expect(document.querySelector(".pd-read")).toBeNull();
    expect(screen.queryByRole("region", { name: "Choices" })).toBeNull();
  });

  it("a step reads who, when and badge; a judged helper with no verdict shows its result", () => {
    const t = reshaped();
    const a3 = t.r.agents[2] as AgentView;
    a3.endedAt = at(15);
    delete a3.report;
    showIt(t);
    const cards = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    });
    const hd = (k: number) =>
      [...(cards[k]?.querySelector(".step-hd")?.children ?? [])].map(
        (c) => c.textContent,
      );
    expect(hd(0)).toEqual([
      "Built by Agent 1",
      `Sonnet · ${clock(at(10))} to ${clock(at(11))}`,
      "Done, with concerns",
    ]);
    expect(hd(2)).toEqual([
      "Rechecked by Agent 3",
      `Sonnet · ${clock(at(14))} to ${clock(at(15))}`,
      "Passed",
    ]);
  });

  it("files sit under their role with a capital and no closing stop", () => {
    const file = (path: string, role: string, roleInferred = false) => ({
      path,
      role,
      roleInferred,
      added: 1,
      removed: 0,
      isNew: false,
      eventIds: [],
    });
    showIt(
      reshaped({
        files: [
          file("a.css", "Holds the token sets."),
          file("b.html", "source", true),
        ],
      }),
    );
    expect(
      [...document.querySelectorAll(".fcard h3")].map((h) => h.textContent),
    ).toEqual(["Holds the token sets", "Source"]);
  });

  it("files grouped as tests by path join the one Tests card", () => {
    const file = (path: string, role?: string) => ({
      path,
      ...(role ? { role, roleInferred: true } : {}),
      added: 1,
      removed: 0,
      isNew: false,
      eventIds: [],
    });
    showIt(
      reshaped({
        files: [file("e2e/harness.js", "tests"), file("a.test.ts")],
      }),
    );
    expect(
      [...document.querySelectorAll(".fcard h3")].map((h) => h.textContent),
    ).toEqual(["Tests"]);
  });

  it("a step from a message a helper card already shows is not drawn twice, and has no Details", () => {
    const t = reshaped({ inferred: true });
    t.r.messages = [
      ...(t.r.messages ?? []),
      { id: "m9", ts: at(15), text: "Task 1 passed its recheck." },
    ];
    t.p.steps = [
      ...t.p.steps,
      {
        ts: at(13),
        text: "The review found one",
        status: "done",
        eventIds: ["m1"],
      },
      {
        ts: at(15),
        text: "Task 1 passed its recheck.",
        status: "done",
        eventIds: ["m9"],
      },
    ];
    showIt(t);
    const cards = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    });
    expect(cards).toHaveLength(4);
    const last = cards[3] as HTMLElement;
    expect(last.querySelector(".step-title")?.textContent).toBe("Claude");
    expect(last.querySelector(".step-text")?.textContent).toBe(
      "Task 1 passed its recheck.",
    );
    expect(within(last).queryByRole("button", { name: "Details" })).toBeNull();
    // The step's message is one of Claude's dots too.
    expect(document.querySelectorAll(".cdot")).toHaveLength(2);
  });

  it("core's verdict on a recheck wins over the timeline's guess, on the bar and the step", () => {
    const t = reshaped();
    t.p.status = "done";
    const a3 = t.r.agents[2] as AgentView;
    a3.endedAt = at(15);
    delete a3.report;
    (t.p.steps[2] as { text: string }).text = "Sent back";
    showIt(t);
    const lanes = within(
      screen.getByRole("list", { name: "Timeline" }),
    ).getAllByRole("listitem");
    expect(lanes[2]?.querySelector(".run")?.className).toContain("bad");
    expect(lanes[2]?.querySelector(".run")?.textContent).toBe("Sent back");
    const card = within(section("How it went")).getAllByRole("listitem", {
      name: /step/,
    })[2] as HTMLElement;
    expect(within(card).getByText("Sent back").className).toBe("pill bad");
  });

  it("the band names three commits and counts the rest", () => {
    const t = reshaped();
    const hashes = ["aaaaaaa1", "bbbbbbb2", "ccccccc3", "ddddddd4", "eeeeeee5"];
    const a1 = t.r.agents[0] as AgentView;
    a1.report = {
      ...(a1.report as NonNullable<AgentView["report"]>),
      text: `Commits: ${hashes.join(", ")}`,
    };
    showIt(t);
    const band = screen.getByRole("group", { name: "Summary" });
    expect(band.textContent).toContain(
      "commits aaaaaaa1 bbbbbbb2 ccccccc3 and 3 more",
    );
  });

  it("many helpers share one lane per role, and rounds of many subjects draw no markers", () => {
    const t = reshaped();
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...(t.r.agents[i % 2] as AgentView),
      id: `h${i}`,
      subject: `Task ${i}`,
      round: 1 + (i % 3),
      startedAt: at(10 + i),
    }));
    t.r.agents = many;
    t.p.agents = many.map((a) => a.id);
    t.p.steps = [];
    showIt(t);
    const names = [...document.querySelectorAll(".lanes .lane-name")].map(
      (n) => n.textContent,
    );
    expect(names.slice(0, 2)).toEqual([
      "Builders6 helpers",
      "Reviewers6 helpers",
    ]);
    expect(document.querySelector(".rounds")).toBeNull();
    expect(document.querySelector(".how .hh-note")?.textContent).toBe(
      "one lane per role, Claude's messages at the bottom",
    );
  });
});
