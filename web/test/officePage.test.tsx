import {
  type HookName,
  MAP_TOOL,
  type MurmurEvent,
  NARRATE_TOOL,
  reduce,
} from "@murmur/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { frames, Routed, roomInJsdom } from "./officeShell";

roomInJsdom();
beforeAll(() => {
  // A laptop-sized stage, so the room draws at 2x and its desks get hit areas.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 1440;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 772;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
});

const BASE = Date.parse("2026-11-06T00:00:00.000Z");
const at = (
  n: number,
  hook: HookName,
  payload: Record<string, unknown> = {},
): MurmurEvent => ({
  id: `e${n}`,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/p",
  ts: new Date(BASE + n * 1000).toISOString(),
  hook,
  payload,
});
const tool = (n: number, name: string, input: unknown, hook: HookName) =>
  at(n, hook, { tool_name: name, tool_input: input, tool_use_id: `t${n}` });

const MAP = {
  kind: "feature",
  goal: "Add alerts",
  phases: [
    {
      id: "1",
      title: "Build",
      tasks: [{ id: "t1", title: "Task 1 alert table", part: "db" }],
    },
  ],
  parts: [{ id: "db", title: "Alert table", phase: "1" }],
};

/** An earlier question answered and done, then the alerts request with its helper at work. */
const events = [
  at(0, "UserPromptSubmit", { prompt: "what does the screener show" }),
  at(0.5, "Stop", {}),
  at(1, "UserPromptSubmit", { prompt: "add price alerts" }),
  tool(2, MAP_TOOL, MAP, "PostToolUse"),
  tool(3, NARRATE_TOOL, { task: "t1", taskStatus: "running" }, "PostToolUse"),
  tool(
    4,
    "Agent",
    {
      description: "Build Task 1 alert table",
      prompt: "Please build the alert table",
      subagent_type: "general-purpose",
      model: "sonnet",
    },
    "PreToolUse",
  ),
  at(5, "SubagentStart", { agent_id: "a1", agent_type: "general-purpose" }),
];
const view = reduce(events);
const [first, second] = view.requests;

function show(path = "/s/s1", status: "live" | "loading" = "live") {
  history.replaceState(null, "", path);
  return render(<Routed view={view} events={events} status={status} />);
}
const here = () => location.pathname + location.search;
const details = () => screen.queryByRole("complementary", { name: "Details" });

describe("the office page", () => {
  it("says which request is on the floor, how it stands, and that it is live", async () => {
    // Moments after its last event: a live session, not a quiet one.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE + 10_000);
    show();
    await frames();
    const top = screen.getByRole("banner");
    expect(within(top).getByText("Request 2 of 2")).toBeTruthy();
    expect(top.textContent).toContain("Running");
    expect(top.textContent).toContain("Plan 0 of 1 done");
    expect(top.textContent).toContain("1 helper at work");
    expect(within(top).getByText("Live")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Follow the session live" }),
    ).toBeTruthy();
    // The brand goes to the lobby.
    expect(
      screen.getByRole("link", { name: "Murmur" }).getAttribute("href"),
    ).toBe("/");
  });

  it("is quiet when nothing has happened for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE + 3 * 3600_000 + 10_000);
    show();
    await frames();
    expect(
      within(screen.getByRole("banner")).getByText("Quiet · 3 h 00 m"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Jump to the latest moment" }),
    ).toBeTruthy();
  });

  it("is a replay when the stream is not live", async () => {
    show("/s/s1", "loading");
    await frames();
    expect(within(screen.getByRole("banner")).getByText("Replay")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Jump to the end" }),
    ).toBeTruthy();
  });

  it("opens a helper's close-up from its desk, its address saying so, and Escape climbs back", async () => {
    show();
    await frames();
    await userEvent.click(
      screen.getByRole("button", { name: /^Helper: Build Task 1 alert table/ }),
    );
    expect(here()).toBe("/s/s1?open=helper:a1");
    const panel = details() as HTMLElement;
    expect(
      within(panel).getByRole("heading", { name: "Build Task 1 alert table" }),
    ).toBeTruthy();
    expect(panel.textContent).toContain("Builder · Sonnet");
    // The breadcrumb says where this is and climbs.
    const crumbs = within(panel).getByRole("navigation", {
      name: "Where you are",
    });
    expect(crumbs.textContent).toBe(
      "SessionRequest 2Helper · Build Task 1 alert table",
    );
    // A close-up closes to the tab, then the panel closes.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(here()).toBe("/s/s1?open=story");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(here()).toBe("/s/s1");
    expect(details()).toBeNull();
  });

  it("each tab of the panel is its own address, and Back walks them", async () => {
    show("/s/s1?open=story");
    await frames();
    const panel = within(details() as HTMLElement);
    const tasks = within(
      panel.getByRole("navigation", { name: "This request" }),
    ).getByRole("link", { name: "Tasks" });
    expect(tasks.getAttribute("href")).toBe("/s/s1?open=tasks");
    await userEvent.click(tasks);
    expect(here()).toBe("/s/s1?open=tasks");
    expect(
      within(details() as HTMLElement)
        .getByRole("link", { name: "Tasks" })
        .getAttribute("aria-current"),
    ).toBe("page");
    await userEvent.click(
      within(details() as HTMLElement).getByRole("link", { name: "Journey" }),
    );
    expect(here()).toBe("/s/s1?open=journey");
    expect(
      within(details() as HTMLElement).getByRole("navigation", {
        name: "Where you are",
      }).textContent,
    ).toContain("Session · ");
    history.back();
    await waitFor(() => expect(here()).toBe("/s/s1?open=tasks"));
  });

  it("opens the panel from Details on the last tab, and closes it from its one close control", async () => {
    show();
    await frames();
    expect(details()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(here()).toBe("/s/s1?open=story");
    const panel = details() as HTMLElement;
    expect(
      within(panel)
        .getByRole("link", { name: "Story" })
        .getAttribute("aria-current"),
    ).toBe("page");
    // One way to close it in the panel: no second "Hide details".
    expect(screen.queryByRole("button", { name: "Hide details" })).toBeNull();
    await userEvent.click(
      within(panel).getByRole("button", { name: "Close details" }),
    );
    expect(details()).toBeNull();
  });

  it("moves focus into the panel it opens, back to Details on close, and not again on Back", async () => {
    show();
    await frames();
    const btn = screen.getByRole("button", { name: "Details" });
    await userEvent.click(btn);
    expect(details()?.contains(document.activeElement)).toBe(true);
    await userEvent.click(
      within(details() as HTMLElement).getByRole("button", {
        name: "Close details",
      }),
    );
    expect(details()).toBeNull();
    expect(document.activeElement).toBe(btn);
    // Back reopens it as it was, but the reader's focus stays where it is.
    history.back();
    await waitFor(() => expect(details()).toBeTruthy());
    await frames();
    expect(document.activeElement).toBe(btn);
  });

  it("returns focus to Details when a panel opened by its address closes", async () => {
    show("/s/s1?open=files");
    await frames();
    await userEvent.click(
      within(details() as HTMLElement).getByRole("button", {
        name: "Close details",
      }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Details" }),
    );
  });

  it("[ and ] step to the request before and after; an old one is pinned and says so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE + 10_000);
    show("/s/s1?open=tasks");
    await frames();
    fireEvent.keyDown(window, { key: "[" });
    expect(here()).toBe(`/s/s1/r/${first?.id}?open=tasks`);
    await frames();
    const top = screen.getByRole("banner");
    expect(within(top).getByText("Request 1 of 2")).toBeTruthy();
    expect(within(top).getByText("Pinned")).toBeTruthy();
    expect(within(top).queryByText("Live")).toBeNull();
    // The replay bar's clock does not call a pinned old floor "now" or "latest", its
    // slider says whose moment it shows, and its button is the way back to following.
    const bar = screen.getByRole("contentinfo");
    expect(bar.textContent).not.toContain("now");
    expect(bar.textContent).not.toContain("latest");
    expect(bar.textContent).toContain("request 1's last");
    expect(
      within(bar)
        .getByRole("slider", { name: "Replay time" })
        .getAttribute("aria-valuetext"),
    ).toContain("request 1 as it stands");
    expect(
      within(bar).getByRole("button", {
        name: "Back to following Claude, on request 2",
      }).textContent,
    ).toBe("Follow");
    expect(
      within(top).getByRole("button", { name: /Claude is on request 2/ }),
    ).toBeTruthy();
    // ] on the floor Claude is on follows the session again.
    fireEvent.keyDown(window, { key: "]" });
    expect(here()).toBe("/s/s1?open=tasks");
  });

  it("a pinned address for the floor Claude is on follows the session", async () => {
    show(`/s/s1/r/${second?.id}?open=files`);
    await frames();
    expect(here()).toBe("/s/s1?open=files");
  });

  it("the requests rail lists every request by day and pins one on a click, keeping the tab", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE + 10_000);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });
    show("/s/s1?open=flow");
    await frames();
    const rail = screen.getByRole("complementary", { name: "Requests rail" });
    const rows = within(rail).getAllByRole("link");
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, " ").trim())).toEqual(
      [
        expect.stringMatching(/^1What does the screener show.*Done$/),
        expect.stringMatching(/^2Add alerts.*Running.*1 helper$/),
      ],
    );
    expect(rows[1]?.getAttribute("aria-current")).toBe("true");
    await userEvent.click(rows[0] as HTMLElement);
    expect(here()).toBe(`/s/s1/r/${first?.id}?open=flow`);
    // Folded, it stays folded on the next visit.
    await userEvent.click(
      within(rail).getByRole("button", { name: "Fold the requests rail" }),
    );
    expect(localStorage.getItem("murmur:rail")).toBe("shut");
  });

  it("each replay tick names its request when it has the keyboard", async () => {
    show();
    await frames();
    const tick = screen.getByRole("button", {
      name: "Go to request 2: Add alerts",
    });
    act(() => tick.focus());
    expect(screen.getByRole("contentinfo").textContent).toContain(
      "2 Add alerts",
    );
    // The arrow keys walk to the other requests' ticks from the one tab stop.
    fireEvent.keyDown(tick, { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Go to request 1:/,
    );
  });

  it("a task's close-up keeps its request's pin on the floor Claude is on", async () => {
    show(`/s/s1/r/${second?.id}?open=task:t1`);
    await frames();
    // Task ids repeat across requests: following would show another request's t1 later.
    expect(here()).toBe(`/s/s1/r/${second?.id}?open=task:t1`);
    // Not pinned away: Claude is on this request.
    expect(document.querySelector(".of-top")?.textContent).not.toContain(
      "Pinned",
    );
    // Its tabs follow the session again.
    await userEvent.click(
      within(details() as HTMLElement).getByRole("link", { name: "Files" }),
    );
    await waitFor(() => expect(here()).toBe("/s/s1?open=files"));
  });

  it("the old office address lands on the room with the panel closed", async () => {
    localStorage.setItem("murmur:panel", "journey");
    show("/s/s1/office");
    await frames();
    expect(here()).toBe("/s/s1");
    expect(details()).toBeNull();
  });

  it("an old address lands on the office's own", async () => {
    show(`/s/s1/r/${first?.id}/p/db`);
    // The router replaces it before the office reads it.
    expect(here()).toBe(`/s/s1/r/${first?.id}?open=task:db`);
  });
});
