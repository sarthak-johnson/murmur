import {
  type HookName,
  MAP_TOOL,
  type MurmurEvent,
  reduce,
} from "@murmur/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { frames, Routed, roomInJsdom } from "./officeShell";

roomInJsdom();
afterEach(() => {
  cleanup();
  localStorage.clear();
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
/** An Edit of `path` that adds and removes the lines given. */
const edit = (n: number, path: string, lines: string[], agent?: string) =>
  at(n, "PostToolUse", {
    tool_name: "Edit",
    tool_use_id: `t${n}`,
    tool_input: { file_path: `/p/${path}` },
    tool_response: {
      filePath: `/p/${path}`,
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines },
      ],
    },
    ...(agent ? { agent_id: agent } : {}),
  });

const MAP = {
  kind: "feature",
  goal: "Add alerts",
  phases: [
    {
      id: "1",
      title: "Build",
      tasks: [{ id: "t1", title: "Alert table", part: "db" }],
    },
  ],
  parts: [{ id: "db", title: "Alert table", phase: "1" }],
};

/** Two requests change src/app.ts; the second one's helper changes it and the schema. */
const events = [
  at(0, "UserPromptSubmit", { prompt: "tidy the app" }),
  edit(1, "src/app.ts", ["-old", "+tidy"]),
  at(2, "Stop", {}),
  at(3, "UserPromptSubmit", { prompt: "add price alerts" }),
  at(4, "PostToolUse", {
    tool_name: MAP_TOOL,
    tool_use_id: "t4",
    tool_input: MAP,
  }),
  at(5, "PreToolUse", {
    tool_name: "Agent",
    tool_use_id: "t5",
    tool_input: {
      description: "Build the alert table",
      prompt: "Please build the alert table",
      subagent_type: "general-purpose",
    },
  }),
  at(6, "SubagentStart", { agent_id: "a1", agent_type: "general-purpose" }),
  edit(7, "src/app.ts", ["+alerts", "+more"], "a1"),
  edit(8, "db/schema.sql", ["+create table alerts"], "a1"),
  at(9, "SubagentStop", { agent_id: "a1" }),
];
const view = reduce(events);

function show(path: string) {
  history.replaceState(null, "", path);
  return render(<Routed view={view} events={events} status="live" />);
}
const details = () =>
  within(screen.getByRole("complementary", { name: "Details" }));

describe("the session's files", () => {
  it("lists each file once with every request and task that changed it, its diff on a click", async () => {
    show("/s/s1?open=allfiles");
    await frames();
    const panel = details();
    expect(panel.getByText(/2 files changed, \+4 −1/)).toBeTruthy();
    const list = panel.getByRole("list", { name: "Every file" });
    const app = within(list)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.startsWith("src/app.ts")) as HTMLElement;
    const by = within(app).getByRole("list", { name: "Changed in" });
    expect(
      within(by)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      // Core groups request 1's own change by its folder: a part, not a numbered task.
      [
        "Request 1 · Changes in src",
        `/s/s1/r/${view.requests[0]?.id}?open=task:dir:src`,
      ],
      [
        "Request 2 · Task 1 · Alert table",
        `/s/s1/r/${view.requests[1]?.id}?open=task:t1`,
      ],
    ]);
    // The row opens the file's whole diff over the session.
    const row = within(app).getByRole("button", { name: /src\/app\.ts/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(row);
    expect(app.querySelector(".diff")?.textContent).toContain("tidy");
    expect(app.querySelector(".diff")?.textContent).toContain("alerts");
  });

  it("finds a file by its path", async () => {
    show("/s/s1?open=allfiles");
    await frames();
    await userEvent.type(details().getByRole("searchbox"), "schema");
    const rows = within(
      details().getByRole("list", { name: "Every file" }),
    ).getAllByRole("button");
    expect(rows.map((r) => r.textContent?.split("+")[0])).toEqual([
      "db/schema.sql",
    ]);
  });

  it("the old Requests tab address shows the Timeline", async () => {
    show("/s/s1?open=requests");
    await frames();
    expect(
      details()
        .getByRole("link", { name: "Timeline" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("a request's Files tab", () => {
  it("opens a file's diff from its row", async () => {
    show(`/s/s1?open=files`);
    await frames();
    const row = details().getByRole("button", { name: /db\/schema\.sql/ });
    await userEvent.click(row);
    expect(row.closest("li")?.querySelector(".diff")?.textContent).toContain(
      "create table alerts",
    );
  });
});

describe("a helper's close-up", () => {
  it("lists the files it changed with its own lines, each diff a click away", async () => {
    show("/s/s1?open=helper:a1");
    await frames();
    const files = details().getByRole("list", { name: "Files it changed" });
    const rows = within(files).getAllByRole("button");
    // Newest first, each with its own lines, not the earlier request's change to the file.
    expect(rows.map((r) => r.textContent)).toEqual([
      "db/schema.sql+1−0",
      "src/app.ts+2−0",
    ]);
    await userEvent.click(rows[1] as HTMLElement);
    const diff = rows[1]?.closest("li")?.querySelector(".diff")?.textContent;
    expect(diff).toContain("alerts");
    expect(diff).not.toContain("tidy");
  });
});
