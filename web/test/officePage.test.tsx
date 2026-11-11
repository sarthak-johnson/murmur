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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Office } from "../src/office/Office";

// jsdom has no 2d canvas: a context that takes every call and draws nothing.
function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  const target: Record<string | symbol, unknown> = {
    canvas,
    measureText: (s: string) => ({ width: s.length * 7 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return fakeContext(this);
    } as unknown as HTMLCanvasElement["getContext"],
  );
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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

const events = [
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

function show(status: "live" | "loading" = "live") {
  const view = reduce(events);
  return render(
    <Office
      sessionId="s1"
      pinnedId={undefined}
      view={view}
      events={events}
      status={status}
    />,
  );
}

/** Lets the room paint a few frames, so its overlay has its words and hit areas. */
async function frames() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

describe("the office page", () => {
  it("says which request is on the floor, how it stands, and that it is live", async () => {
    // Moments after its last event: a live session, not a quiet one.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE + 10_000);
    show();
    await frames();
    const top = screen.getByRole("banner");
    expect(within(top).getByText("Request 1 of 1")).toBeTruthy();
    expect(top.textContent).toContain("Running");
    expect(top.textContent).toContain("Plan 0 of 1 done");
    expect(top.textContent).toContain("1 helper at work");
    expect(within(top).getByText("Live")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Follow the session live" }),
    ).toBeTruthy();
  });

  it("is quiet when nothing has happened for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BASE + 3 * 3600_000);
    show();
    await frames();
    expect(
      within(screen.getByRole("banner")).getByText("Quiet · 3 h 0 m"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Jump to the latest moment" }),
    ).toBeTruthy();
  });

  it("is a replay when the stream is not live", async () => {
    show("loading");
    await frames();
    expect(within(screen.getByRole("banner")).getByText("Replay")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Jump to the end" }),
    ).toBeTruthy();
  });

  it("opens a helper's close-up from its desk, the request's tabs, and closes on Escape", async () => {
    show();
    await frames();
    await userEvent.click(
      screen.getByRole("button", { name: /^Helper: Build Task 1 alert table/ }),
    );
    const drawer = screen.getByRole("complementary", { name: "Details" });
    expect(
      within(drawer).getByRole("heading", { name: "Build Task 1 alert table" }),
    ).toBeTruthy();
    expect(drawer.textContent).toContain("Builder · Sonnet");
    await userEvent.click(
      within(drawer).getByRole("button", { name: "Tasks" }),
    );
    expect(
      within(drawer)
        .getByRole("button", { name: "Tasks" })
        .getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });

  it("opens the story from the Details button", async () => {
    show();
    await frames();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const drawer = screen.getByRole("complementary", { name: "Details" });
    expect(
      within(drawer)
        .getByRole("button", { name: "Story" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
