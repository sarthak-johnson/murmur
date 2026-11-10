import type {
  AgentView,
  MessageView,
  MurmurEvent,
  PartView,
  PhaseView,
  RequestView,
  SessionView,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live as Page } from "../src/pages/Session";
import {
  clock,
  commitsIn,
  concernsIn,
  duration,
  firstSentence,
  fixRounds,
  moment,
  outcome,
  reportLead,
  sentBack,
  verdictOf,
} from "../src/story";

/** A request's own page: the newest request unless the test names one. */
function Live(p: React.ComponentProps<typeof Page>) {
  return <Page {...p} requestId={p.requestId ?? p.view?.requests.at(-1)?.id} />;
}

afterEach(() => {
  cleanup();
  // The Story or Map choice is kept per viewer; each test starts fresh.
  localStorage.clear();
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ decisions: [] }),
        }) as Response,
    ),
  );
});

const at = (min: number) =>
  new Date(Date.UTC(2026, 10, 6, 10, min)).toISOString();

function part(p: Partial<PartView> & { id: string; title: string }): PartView {
  return {
    status: "done",
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

const step = (text: string, agentId?: string, min = 10) => ({
  ts: at(min),
  text,
  status: "done" as const,
  eventIds: [],
  ...(agentId ? { agentId } : {}),
});

function agent(id: string, a: Partial<AgentView> = {}): AgentView {
  return {
    id,
    type: "general-purpose",
    description: id,
    prompt: "",
    status: "done",
    startedAt: at(10),
    ...a,
  };
}

const msg = (id: string, min: number, text: string, m = {}): MessageView => ({
  id,
  ts: at(min),
  text,
  ...m,
});

const messages: MessageView[] = [
  msg(
    "m0",
    6,
    "Approved, so I'm starting. Here's the order: install dependencies first.",
  ),
  msg(
    "m1",
    10,
    "One builder at a time, **not** two: the foundation tasks all edit the same few files.",
  ),
  msg(
    "m2",
    13,
    "The review found one real problem: the plate's gain and loss colours used the weaker values.",
    { task: "task:1", agent: "a2" },
  ),
  msg("m3", 14, "I also added an eleventh task to Phase 0."),
  msg("m4", 15, "Task 1 is done and verified. I confirmed the values myself.", {
    task: "task:1",
  }),
];

function request(r: Partial<RequestView> = {}): RequestView {
  return {
    id: "r1",
    prompt: "Yes please go ahead",
    startedAt: at(5),
    kind: "feature",
    kindInferred: true,
    goal: "Yes please go ahead",
    phases: [
      {
        id: "did",
        title: "What Claude did",
        status: "done",
        tasks: [
          {
            id: "task:1",
            title: "Task 1: Lit plate tokens",
            part: "task:1",
            status: "done",
            agents: [],
          },
          {
            id: "task:2",
            title: "Task 2: HeroMoney",
            part: "task:2",
            status: "done",
            agents: [],
          },
          {
            id: "task:3",
            title: "Task 3: Dot field",
            part: "task:3",
            status: "done",
            agents: [],
          },
        ],
      },
    ],
    planInferred: true,
    parts: [
      part({
        id: "task:1",
        title: "Task 1: Lit plate tokens",
        agents: ["a1", "a2", "a3"],
        steps: [
          step("Built", "a1"),
          step("Reviewed", "a2", 12),
          step("Re-reviewed", "a3", 14),
        ],
      }),
      part({
        id: "task:2",
        title: "Task 2: HeroMoney",
        agents: ["a4"],
        steps: [step("Built", "a4", 16)],
      }),
      part({ id: "task:3", title: "Task 3: Dot field", steps: [] }),
    ],
    looseFiles: [],
    now: null,
    agents: [
      agent("a1"),
      agent("a2"),
      agent("a3"),
      agent("a4", {
        report: {
          status: "completed",
          summary: 'Agent "Build Task 2" finished',
          text: "Status: DONE_WITH_CONCERNS\n\nBuilt it.",
          verdict: "DONE_WITH_CONCERNS",
          ts: at(18),
          interim: false,
        },
      }),
    ],
    assumptions: [],
    flags: [],
    finished: true,
    tally: { helpers: 4, files: 3, commands: 12 },
    messages,
    ...r,
  };
}

function session(req: RequestView, s: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "s1",
    cwd: "/x/app",
    title: "app",
    startedAt: at(0),
    lastEventAt: at(40),
    ended: false,
    requests: [req],
    needsYou: null,
    ...s,
  };
}

const ev = (min: number): MurmurEvent => ({
  id: `e${min}`,
  sessionId: "s1",
  machineId: "m",
  cwd: "/x/app",
  ts: at(min),
  hook: "Stop",
  payload: {},
});

function show(view: SessionView, events: MurmurEvent[] = []) {
  return render(
    <Live
      sessionId="s1"
      view={view}
      events={events}
      status="live"
      lastLooked={null}
    />,
  );
}

const story = () => screen.getByRole("region", { name: "What happened" });
const storyTexts = () =>
  within(story())
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".story-text")?.textContent ?? "");

describe("moment badges", () => {
  it("are decided from the first sentence only, and conservatively", () => {
    // Problem found: a review or test that found a problem, or something failed.
    expect(moment("The review found one real problem: the colours.")).toBe(
      "problem",
    );
    expect(moment("The reviewer found a small layout problem.")).toBe(
      "problem",
    );
    expect(moment("The build failed twice.")).toBe("problem");
    // Fixing: something is sent back.
    expect(moment("Sent back to the same builder.")).toBe("fixing");
    expect(moment("I'm sending it back to fix the comment.")).toBe("fixing");
    expect(moment("Task 2 goes back to the builder with two notes.")).toBe(
      "fixing",
    );
    // Done: a task or phase is done or passed.
    expect(moment("Task 1 is done, with a few concerns noted.")).toBe("done");
    expect(moment("Task 21, the plate at the top, is done.")).toBe("done");
    expect(moment("Phase 0 is finished: all 11 tasks are built.")).toBe("done");
    expect(moment("Task 3 passed its re-review.")).toBe("done");
    // Decision: an explicit change of plan, or a choice with its reason.
    expect(
      moment("One builder at a time, not two: they edit the same files."),
    ).toBe("decision");
    expect(moment("I used tokens rather than raw colours.")).toBe("decision");
    expect(
      moment(
        "To keep things lean, I'm saving the instructions once instead of pasting them.",
      ),
    ).toBe("decision");
    expect(moment("I decided to keep the old chart.")).toBe("decision");
    expect(moment("I also added an eleventh task to Phase 0.")).toBe("plan");
    // Otherwise no badge.
    for (const t of [
      "The build has started. The colours task is running on Sonnet now.",
      "Still waiting: Task 20's second fix round is running its full suite.",
      "Applying the re-review's small fixes and the bolder hero weight myself:",
      "A commit I fixed: my first commit carried a co-author line.",
      "The recheck passed, but the reviewer only skimmed part of the diff.",
      "Task 1 is now in review. Once it passes, I'll start Task 2.",
      "Reading the prototype next. The review found a problem earlier.",
      "Tests pass and nothing is done yet.",
      "Task 20's full test suite passed (3,351 tests, none failed).",
      "The money fix works: it now takes 0.6 seconds instead of about 20.",
    ])
      expect(moment(t), t).toBeUndefined();
  });
});

describe("story helpers", () => {
  it("count tasks sent back after review and fix rounds", () => {
    expect(sentBack(request())).toBe(1);
    const p = part({
      id: "x",
      title: "X",
      steps: [
        step("Built"),
        step("Reviewed"),
        step("Fixed"),
        step("Re-reviewed"),
        step("Re-reviewed"),
      ],
    });
    expect(fixRounds(p)).toBe(2);
    expect(
      fixRounds(part({ id: "y", title: "Y", steps: [step("Built")] })),
    ).toBe(0);
  });

  it("formats a duration", () => {
    expect(duration(at(0), at(0))).toBe("under a minute");
    expect(duration(at(0), at(7))).toBe("7 m");
    expect(
      duration(at(0), new Date(Date.parse(at(0)) + 187 * 60_000).toISOString()),
    ).toBe("3 h 07 m");
  });

  it("finds commits in reports", () => {
    expect(
      commitsIn([
        "Status: DONE\nCommit: df095803a1b2\nOther: 1234567",
        "**Commits:** `2b3689eb3`, abcdef0",
        "Commit: df095803a1b2",
      ]),
    ).toEqual(["df095803a1b2", "2b3689eb3", "abcdef0"]);
    expect(commitsIn(["No commit was made"])).toEqual([]);
  });

  it("finds the bullets under a Concerns heading", () => {
    const text = [
      "Status: DONE_WITH_CONCERNS",
      "",
      "Built the tokens.",
      "",
      "**Concerns:**",
      "- Opacity steps on `--l2` won't work",
      "  because their alpha is baked in",
      "- One test already fails",
      "",
      "## Files",
      "- a.css",
    ].join("\n");
    expect(concernsIn(text)).toEqual([
      "Opacity steps on `--l2` won't work because their alpha is baked in",
      "One test already fails",
    ]);
    expect(concernsIn("## Concerns\n\nNone.")).toEqual([]);
    expect(concernsIn("Concerns: the light colours were a guess")).toEqual([
      "the light colours were a guess",
    ]);
    expect(concernsIn("All good.")).toEqual([]);
  });

  it("reads a verdict as a label and a tone", () => {
    const r = (verdict?: string, status = "completed") => ({
      status,
      summary: "",
      text: "",
      ts: at(0),
      interim: false,
      ...(verdict ? { verdict } : {}),
    });
    expect(verdictOf(r("DONE"))).toEqual({ label: "Done", tone: "done" });
    expect(verdictOf(r("DONE_WITH_CONCERNS"))).toEqual({
      label: "Done, with concerns",
      tone: "warn",
    });
    expect(verdictOf(r("BLOCKED"))).toEqual({ label: "Blocked", tone: "bad" });
    expect(verdictOf(r("NEEDS_CONTEXT"))).toEqual({
      label: "Needs context",
      tone: "warn",
    });
    expect(verdictOf(r("APPROVED"))).toEqual({
      label: "Approved",
      tone: "done",
    });
    expect(verdictOf(r(undefined, "failed"))).toEqual({
      label: "Failed",
      tone: "bad",
    });
    expect(verdictOf(r())).toBeUndefined();
    expect(verdictOf(undefined)).toBeUndefined();
  });

  it("takes a report's lead paragraph without its status lines", () => {
    expect(
      reportLead(
        "Status: DONE\nCommit: abc1234\n\n## Summary\n\nThe new tests pass.\n\nMore detail.",
      ),
    ).toBe("The new tests pass.");
  });

  it("gives each task a one-line outcome", () => {
    const req = request();
    const [t1, t2, t3] = req.phases[0]?.tasks ?? [];
    if (!t1 || !t2 || !t3) throw new Error("fixture");
    // The last linked message wins over a verdict.
    expect(outcome(req, t1)).toBe(
      "Task 1 is done and verified. I confirmed the values myself.",
    );
    // No message: the last helper's verdict.
    expect(outcome(req, t2)).toBe("Done, with concerns");
    expect(outcome(req, t3)).toBeUndefined();
    // A recap's line (its part's last step) wins over both.
    const recap = request({
      recap: true,
      planInferred: false,
      parts: req.parts.map((p) =>
        p.id === "task:1"
          ? { ...p, steps: [step("Done after 1 fix: the colours were weak")] }
          : p,
      ),
    });
    expect(outcome(recap, t1)).toBe("Done after 1 fix: the colours were weak");
  });

  it("formats a clock time as hours and minutes", () => {
    const d = new Date(at(6));
    const two = (n: number) => String(n).padStart(2, "0");
    expect(clock(at(6))).toBe(`${two(d.getHours())}:${two(d.getMinutes())}`);
  });
});

describe("request page, story first", () => {
  it("opens with the request, and Claude's opening line leads the story", () => {
    show(session(request()));
    expect(
      screen.getByRole("heading", { level: 1, name: "Yes please go ahead" }),
    ).toBeTruthy();
    // Once done the story reads oldest first, so the opening line comes first, with its time.
    const first = within(story()).getAllByRole("listitem")[0] as HTMLElement;
    expect(first.textContent).toContain("Approved, so I'm starting.");
    expect(first.textContent).toContain(clock(at(6)));
    expect(storyTexts().filter((t) => t.includes("Approved"))).toHaveLength(1);
  });

  it("the facts say when it was asked, tasks, helpers and sent back; the track says how long", () => {
    show(session(request()), [ev(5), ev(30)]);
    expect(within(screen.getByRole("banner")).getByText("Done")).toBeTruthy();
    expect(document.querySelector(".over")?.textContent).toContain(
      `asked Fri 6 Nov, ${clock(at(5))}`,
    );
    const band = screen.getByRole("group", { name: "Summary" });
    const t = band.textContent ?? "";
    expect(t).toContain("3 tasks");
    expect(t).toContain("1 sent back after review");
    expect(t).toContain("4 helpers");
    expect(t).toContain("3 files");
    expect(t).toContain("12 commands");
    const track = screen.getByRole("region", { name: "Phase track" });
    expect(track.querySelector(".trk-foot")?.textContent).toContain(
      "Took: 25 m",
    );
  });

  it("the bar says Running or Waiting, and the facts skip zero counts", () => {
    const running = request({
      finished: false,
      tally: { helpers: 0, files: 0, commands: 0 },
      parts: [],
      agents: [],
    });
    show(session(running));
    const bar = () => within(screen.getByRole("banner"));
    expect(bar().getByText("Running")).toBeTruthy();
    const band = screen.getByRole("group", { name: "Summary" });
    expect(band.textContent).not.toContain("helpers");
    expect(band.textContent).not.toContain("sent back");
    cleanup();
    show(
      session(running, {
        needsYou: { reason: "permission", text: "Allow Bash?", since: at(9) },
      }),
    );
    expect(bar().getByText("Waiting")).toBeTruthy();
    expect(bar().getByRole("link", { name: /Permission needed/ })).toBeTruthy();
  });

  it("the timeline runs oldest first once done, each task's messages in one row", () => {
    show(session(request()));
    const rows = [...story().querySelectorAll(".st-phase > ol > li")].map(
      (li) =>
        (
          li.querySelector(".st-run-t") ?? li.querySelector(".story-text")
        )?.textContent?.slice(0, 12),
    );
    expect(rows).toEqual([
      "Approved, so",
      "One builder ",
      "Task 1 · Lit",
      "I also added",
    ]);
  });

  it("the live phase runs newest first while the request runs", () => {
    const [phase] = request().phases;
    show(
      session(
        request({
          finished: false,
          phases: [{ ...(phase as PhaseView), status: "now" }],
        }),
      ),
    );
    expect(storyTexts().map((t) => t.slice(0, 12))).toEqual([
      "Task 1 is do",
      "I also added",
      "The review f",
      "One builder ",
      "Approved, so",
    ]);
  });

  it("each moment has its time, task chip and badge", async () => {
    // Live, so each message about Task 1 is its own row between the others.
    const [phase] = request().phases;
    show(
      session(
        request({
          finished: false,
          phases: [{ ...(phase as PhaseView), status: "now" }],
        }),
      ),
    );
    const items = within(story()).getAllByRole("listitem");
    const [done, plan, problem, decision] = items as HTMLElement[];
    expect(within(decision as HTMLElement).getByText("Decision")).toBeTruthy();
    expect(
      within(problem as HTMLElement).getByText("Problem found"),
    ).toBeTruthy();
    expect(within(plan as HTMLElement).getByText("Plan changed")).toBeTruthy();
    expect(within(done as HTMLElement).getByText("Done")).toBeTruthy();
    expect(
      within(problem as HTMLElement).getByText(clock(at(13))),
    ).toBeTruthy();
    // The chip names the task in its own words; the plan number is its title.
    const chip = within(problem as HTMLElement).getByRole("button", {
      name: "Lit plate tokens",
    });
    expect(chip.title).toBe("Task 1: Lit plate tokens");
    expect(within(decision as HTMLElement).queryByRole("button")).toBeNull();
    await userEvent.click(chip);
    expect(location.pathname).toBe("/s/s1/r/r1/p/task%3A1");
  });

  it("folds consecutive messages about one task into one row that opens in place", async () => {
    const run = [
      msg("m0", 6, "Starting."),
      msg("m1", 8, "Task 1 is being built on Sonnet.", { task: "task:1" }),
      msg("m2", 9, "Task 1 is in review.", { task: "task:1" }),
      msg("m3", 10, "Task 1 is done and verified.", { task: "task:1" }),
      msg("m4", 11, "The review found one real problem.", { task: "task:1" }),
      msg("m5", 12, "Waiting on the tracker."),
      msg("m6", 13, "Task 2 is built.", { task: "task:2" }),
    ];
    show(session(request({ messages: run })));
    const rows = [...story().querySelectorAll(".st-phase > ol > li")];
    expect(rows.map((r) => r.className.split(" ")[0])).toEqual([
      "st-msg",
      "st-run",
      "st-msg",
    ]);
    const [alone, block, single] = rows as HTMLElement[];
    const b = within(block as HTMLElement);
    const open = b.getAllByRole("button")[0] as HTMLElement;
    // The problem found is part of the run, and badges it; a message about nothing
    // named carries on the run before it.
    expect(open.textContent).toBe(
      "Task 1 · Lit plate tokensProblem foundbuilt, review found one real problem4 m · 3 helpers · 5 messages",
    );
    await userEvent.click(open);
    expect(
      [...(block as HTMLElement).querySelectorAll(".story-text")].map(
        (e) => e.textContent,
      ),
    ).toEqual([
      "Task 1 is being built on Sonnet.",
      "Task 1 is in review.",
      "Task 1 is done and verified.",
      "The review found one real problem.",
      "Waiting on the tracker.",
    ]);
    // A message before any task stands alone; a one-message task is a plain message.
    expect(alone?.querySelector(".task-chip")).toBeNull();
    expect(single?.textContent).toContain("Task 2 is built.");
    expect(single?.className).toContain("st-msg");
  });

  it("a message linked only to a helper belongs to that helper's task", () => {
    const run = [
      msg("m0", 6, "Starting."),
      msg("m1", 8, "Task 1 is in review.", { task: "task:1" }),
      // a2 reviewed Task 1 (its part lists a2): this report message joins the run.
      msg("m2", 9, "The reviewer asked for one change.", { agent: "a2" }),
      msg("m3", 10, "Task 1 is done.", { task: "task:1" }),
      // a4 is Task 2's helper; a lone message still shows its task chip.
      msg("m4", 11, "Built it with one note.", { agent: "a4" }),
    ];
    show(session(request({ messages: run })));
    const rows = [...story().querySelectorAll(".st-phase > ol > li")];
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("3 messages");
    expect(
      within(rows[2] as HTMLElement).getByRole("button", {
        name: "HeroMoney",
      }),
    ).toBeTruthy();
  });

  it("a run keeps its messages oldest first inside, while the live section runs newest first", async () => {
    const [phase] = request().phases;
    const run = [
      msg("m0", 6, "Starting."),
      msg("m1", 8, "Task 1 is being built.", { task: "task:1" }),
      msg("m2", 9, "Task 1 is in review.", { task: "task:1" }),
      msg("m3", 10, "Task 1 is done.", { task: "task:1" }),
      msg("m4", 11, "Waiting."),
    ];
    show(
      session(
        request({
          finished: false,
          phases: [{ ...(phase as PhaseView), status: "now" }],
          messages: run,
        }),
      ),
    );
    const rows = [...story().querySelectorAll(".st-phase > ol > li")];
    // The newest run is on top and open; "Waiting." carries on Task 1's run.
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole("button")[0]
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    const texts = [
      ...(rows[0] as HTMLElement).querySelectorAll(".story-text"),
    ].map((e) => e.textContent);
    expect(texts).toEqual([
      "Task 1 is being built.",
      "Task 1 is in review.",
      "Task 1 is done.",
      "Waiting.",
    ]);
    expect(rows[1]?.textContent).toContain("Starting.");
  });

  it("renders Markdown in messages as formatted text", () => {
    show(session(request()));
    const second = within(story()).getAllByRole("listitem")[1] as HTMLElement;
    expect(second.querySelector("strong")?.textContent).toBe("not");
    expect(second.textContent).not.toContain("**");
  });

  it("folds a long message after 8 lines, never a short one", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Point ${i}.`).join(
      "\n\n",
    );
    const short = Array.from({ length: 5 }, (_, i) => `Point ${i}.`).join(
      "\n\n",
    );
    show(
      session(
        request({
          messages: [msg("m0", 6, short), msg("m1", 8, long)],
        }),
      ),
    );
    expect(
      within(story()).getAllByRole("button", { name: "Show more" }),
    ).toHaveLength(1);
    await userEvent.click(
      within(story()).getByRole("button", { name: "Show more" }),
    );
    expect(
      within(story()).getByRole("button", { name: "Show less" }),
    ).toBeTruthy();
  });

  it("the track marks each task's state and opens its page", () => {
    show(session(request()));
    const track = screen.getByRole("region", { name: "Phase track" });
    const link = within(track).getByRole("link", {
      name: "Lit plate tokens, done",
    });
    expect(link.closest(".st")?.className).toBe("st done");
    expect(link.querySelector(".mk.done")).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/s/s1/r/r1/p/task%3A1");
  });

  it("the map is a tab beside the story, one click away", async () => {
    show(session(request()));
    const tabs = screen.getByRole("navigation", {
      name: "Views of this request",
    });
    expect(
      within(tabs)
        .getByRole("link", { name: "Story" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("region", { name: "Flow" })).toBeNull();
    await userEvent.click(within(tabs).getByRole("link", { name: "Flow" }));
    expect(location.pathname).toMatch(/\/flow$/);
  });

  it("a request with no messages draws no story, and the flow stays on its tab", () => {
    show(session(request({ messages: [], finished: false })));
    expect(screen.queryByRole("region", { name: "What happened" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Flow" })).toBeNull();
    expect(screen.getByRole("region", { name: "Now" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Summary" })).toBeTruthy();
    cleanup();
    const old = request();
    delete old.messages;
    show(session(old));
    expect(screen.queryByRole("region", { name: "What happened" })).toBeNull();
  });

  it("a request with only an opening line shows it as the story", () => {
    show(session(request({ messages: [msg("m0", 6, "On it.")] })));
    expect(storyTexts()).toEqual(["On it."]);
  });

  it("an inferred now from a command reads as its description and opens as a terminal block", async () => {
    const bash = (hook: MurmurEvent["hook"], extra = {}): MurmurEvent => ({
      ...ev(20),
      id: `b-${hook}`,
      hook,
      payload: {
        tool_name: "Bash",
        tool_use_id: "toolu_1",
        tool_input: {
          command: "cd /x/app && pnpm test 2>&1 | tail -3",
          description: "Run the frontend suite",
        },
        ...extra,
      },
    });
    show(
      session(
        request({
          finished: false,
          now: {
            text: "Running cd /x/app && pnpm",
            why: "",
            ts: at(20),
            inferred: true,
          },
        }),
      ),
      [
        bash("PreToolUse"),
        bash("PostToolUse", {
          tool_response: { stdout: "3 passed", stderr: "" },
        }),
      ],
    );
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Run the frontend suite")).toBeTruthy();
    await userEvent.click(within(now).getByRole("button", { name: "Details" }));
    expect(
      within(now).getByText("cd /x/app && pnpm test 2>&1 | tail -3"),
    ).toBeTruthy();
    expect(within(now).getByText("Succeeded")).toBeTruthy();
    expect(now.textContent).toContain("3 passed");
  });

  it("a finished request never shows a stale inferred now", () => {
    show(
      session(
        request({
          planInferred: false,
          messages: [],
          now: {
            text: "Running tail -3 /tmp/x",
            why: "",
            ts: at(20),
            inferred: true,
          },
        }),
      ),
    );
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).queryByText(/Running tail/)).toBeNull();
    expect(now.textContent).toContain("4 helpers");
  });

  it("a command with no description never shows raw: it reads as running a command", () => {
    const long = `tail -3 /private/tmp/claude-501/${"x".repeat(80)}/pw.out`;
    show(
      session(
        request({
          finished: false,
          messages: [],
          now: {
            text: `Running ${long.slice(0, 60)}`,
            why: "",
            ts: at(20),
            inferred: true,
          },
        }),
      ),
      [
        {
          ...ev(20),
          id: "b1",
          hook: "PreToolUse",
          payload: { tool_name: "Bash", tool_input: { command: long } },
        },
      ],
    );
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Running a command")).toBeTruthy();
    expect(now.textContent).not.toContain("tail -3");
  });

  it("a recapped request is labelled recap by Claude", () => {
    show(
      session(
        request({ recap: true, planInferred: false, kindInferred: false }),
      ),
    );
    expect(document.querySelector(".over")?.textContent).toContain(
      "recap by Claude",
    );
    expect(screen.queryByText("inferred")).toBeNull();
  });
});

describe("round 3", () => {
  it("badges skip guesses and negations, and e.g. does not end a sentence", () => {
    for (const t of [
      "The suite stopped early, which usually means one failed or flaked.",
      "It might have failed on the cache.",
      "If the build failed, rerun it.",
      "None of the tests failed.",
      "The review found no problems.",
      "The reviewer found nothing to fix.",
    ])
      expect(moment(t), t).toBeUndefined();
    expect(
      firstSentence("Small parts, e.g. the chips, moved. Then more."),
    ).toBe("Small parts, e.g. the chips, moved.");
    expect(
      moment("Parts, e.g. chips and pills, are done. Task 1 is done."),
    ).toBeUndefined();
  });

  it("fix rounds and sent back come from a recapped part's helpers", () => {
    const recapped = part({
      id: "tokens",
      title: "Lit plate tokens",
      agents: ["h1", "h2", "h3"],
      steps: [
        step("Builder added the tokens"),
        step("Done after one fix round."),
      ],
    });
    const helpers = [
      agent("h1", { description: "Implement Task 1: Lit plate tokens" }),
      agent("h2", { description: "Review Task 1 (spec + quality)" }),
      agent("h3", { description: "Re-review Task 1 fix round 1" }),
    ];
    expect(fixRounds(recapped, helpers)).toBe(1);
    expect(
      fixRounds(recapped, [
        agent("x1", { description: "Build Task 3" }),
        agent("x2", { description: "Review Task 3" }),
        agent("x3", { description: "Review Task 3 follow-ups" }),
      ]),
    ).toBe(1);
    expect(fixRounds(recapped, helpers.slice(0, 2))).toBe(0);
    const req = request({
      recap: true,
      planInferred: false,
      parts: [recapped],
      agents: helpers,
    });
    expect(sentBack(req)).toBe(1);
  });

  it("an opened run stays open while new messages arrive", async () => {
    const run = (n: number) => [
      msg("m0", 6, "Starting."),
      ...Array.from({ length: n }, (_, i) =>
        msg(`t${i}`, 8 + i, `Task 1 step ${i}.`, { task: "task:1" }),
      ),
    ];
    const live = (n: number) => (
      <Live
        sessionId="s1"
        view={session(request({ finished: false, messages: run(n) }))}
        events={[]}
        status="live"
        lastLooked={null}
      />
    );
    const { rerender } = render(live(4));
    await userEvent.click(
      within(story()).getByRole("button", { name: /4 messages/ }),
    );
    rerender(live(5));
    expect(
      within(story())
        .getByRole("button", { name: /5 messages/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    // The opening line, then the run's five.
    expect(story().querySelectorAll(".story-text")).toHaveLength(6);
  });

  it("a run's row keeps focus, says it is expanded, and folds back", async () => {
    const run = [
      msg("m0", 6, "Starting."),
      ...[0, 1, 2, 3].map((i) =>
        msg(`t${i}`, 8 + i, `Task 1 step ${i}.`, { task: "task:1" }),
      ),
    ];
    show(session(request({ messages: run })));
    const btn = within(story()).getByRole("button", { name: /4 messages/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(story().querySelectorAll(".story-text")).toHaveLength(1);
    await userEvent.click(btn);
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(story().querySelectorAll(".story-text")).toHaveLength(5);
    await userEvent.click(btn);
    expect(story().querySelectorAll(".story-text")).toHaveLength(1);
  });

  it("the page's first stop skips to the content", () => {
    show(session(request()));
    // The first link on the page, before the rail.
    const skip = screen.getAllByRole("link")[0] as HTMLElement;
    expect(skip.textContent).toBe("Skip to the content");
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.getElementById("plan")).toBeNull();
    expect(within(story()).queryByRole("link", { name: /Skip/ })).toBeNull();
  });

  it("a deep link to a request not loaded yet shows the skeleton, not the newest", () => {
    const view = session(request());
    const { container, rerender } = render(
      <Live
        sessionId="s1"
        requestId="r-later"
        view={view}
        events={[]}
        status="loading"
        lastLooked={null}
      />,
    );
    expect(container.querySelector(".skeleton")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    // Once loaded, an unknown id falls back to the newest request.
    rerender(
      <Live
        sessionId="s1"
        requestId="r-later"
        view={view}
        events={[]}
        status="live"
        lastLooked={null}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("the pill follows the request: done once Claude stopped and no helper runs", () => {
    const stop = { ...ev(20), id: "stop" };
    const open = request({
      finished: false,
      agents: [agent("a1")],
      now: {
        text: "Finished this request",
        why: "",
        ts: at(20),
        inferred: true,
      },
    });
    show(session(open), [ev(5), stop]);
    const bar = () => within(screen.getByRole("banner"));
    expect(bar().getByText("Done")).toBeTruthy();
    cleanup();
    show(
      session(
        request({ ...open, agents: [agent("a1", { status: "running" })] }),
      ),
      [ev(5), stop],
    );
    expect(bar().getByText("Running")).toBeTruthy();
  });

  it("in a finished request, unfinished tasks read as left open, not running", () => {
    const req = request({
      phases: [
        {
          id: "p1",
          title: "Phase 0",
          status: "done",
          tasks: [
            {
              id: "task:1",
              title: "Task 1: Lit plate tokens",
              part: "task:1",
              status: "done",
              agents: [],
            },
          ],
        },
        {
          id: "p2",
          title: "Phase 1",
          status: "now",
          tasks: [
            {
              id: "task:2",
              title: "Task 2: HeroMoney",
              part: "task:2",
              status: "now",
              agents: [],
            },
          ],
        },
      ],
    });
    show(session(req));
    const track = screen.getByRole("region", { name: "Phase track" });
    const station = within(track)
      .getByText("HeroMoney")
      .closest(".st") as HTMLElement;
    expect(station.className).toBe("st open");
    expect(station.textContent).toContain("left open");
    expect(
      [...track.querySelectorAll(".trk-seg")].map((s) => s.className),
    ).toEqual(["trk-seg done", "trk-seg open"]);
    expect(track.querySelector(".st.now")).toBeNull();
    expect(
      within(track).getByText(
        (_, e) =>
          e?.className === "cap" && e.textContent === "Lit plate tokens",
      ),
    ).toBeTruthy();
  });
});
