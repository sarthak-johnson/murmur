import type { RequestView, SessionView } from "@murmur/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowBoard } from "../src/flow/FlowBoard";
import { Live, roomInJsdom } from "./officeShell";

roomInJsdom();

import { cleanPrompt } from "../src/session";

const day = (d: number, min = 0) =>
  new Date(Date.UTC(2026, 10, d, 12, min)).toISOString();

function request(r: Partial<RequestView> & { id: string }): RequestView {
  return {
    prompt: "do it",
    startedAt: day(2),
    kind: "feature",
    kindInferred: false,
    goal: "",
    phases: [],
    planInferred: false,
    parts: [],
    looseFiles: [],
    now: null,
    agents: [],
    assumptions: [],
    flags: [],
    finished: true,
    tally: { helpers: 0, files: 0, commands: 0 },
    messages: [],
    state: "done",
    ...r,
  };
}

const PASTED =
  'Umang sent me this\n\n<pasted_content id="484d">\nMessage for Sarthak\n▎ Hey\n</pasted_content id="484d">\nCan you check?';

beforeEach(() => {
  history.replaceState(null, "", "/");
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("cleaned prompts", () => {
  it("pasted blocks read (pasted text), image markers (image)", () => {
    expect(cleanPrompt(PASTED)).toBe(
      "Umang sent me this (pasted text) Can you check?",
    );
    expect(cleanPrompt("[Image #1]")).toBe("(image)");
    expect(cleanPrompt("Look [Image #2] and [Image #3] please")).toBe(
      "Look (image) and (image) please",
    );
    // An unclosed block, or one cut short, runs to the end.
    expect(cleanPrompt('Umang replied <pasted_content id="1">\nabc')).toBe(
      "Umang replied (pasted text)",
    );
    expect(cleanPrompt("Umang replied <pasted_content")).toBe(
      "Umang replied (pasted text)",
    );
    expect(cleanPrompt("  plain\n\ntext ")).toBe("plain text");
  });
});

const steps = () =>
  [...document.querySelectorAll(".rs-step")].map(
    (s) => s.querySelector(".rs-k")?.textContent,
  );

describe("a flow for every request", () => {
  it("a request with only a reply draws You asked and Ended", () => {
    render(
      <FlowBoard
        sessionId="s1"
        request={request({ id: "r1", prompt: "yes", outcome: "Understood." })}
      />,
    );
    expect(screen.queryByText(/The flow appears/)).toBeNull();
    expect(steps()).toEqual(["You asked", "Ended"]);
    expect(document.querySelector(".rs-step")?.textContent).toContain("yes");
    expect(document.querySelectorAll(".rs-step")[1]?.textContent).toContain(
      "Understood.",
    );
  });

  it("draws only the steps that have something: looked, did, with file names", () => {
    render(
      <FlowBoard
        sessionId="s1"
        request={request({
          id: "r4",
          kind: "question",
          prompt: PASTED,
          outcome: "You're right, you didn't approve the design.",
          activity: {
            reads: 12,
            searches: 3,
            edits: 2,
            commands: 4,
            web: 1,
            tools: 0,
          },
          tally: { helpers: 1, files: 2, commands: 4 },
          looseFiles: [
            {
              path: "/x/app/src/fonts.ts",
              added: 3,
              removed: 1,
              isNew: false,
              eventIds: [],
            },
            {
              path: "/x/app/src/theme.css",
              added: 9,
              removed: 0,
              isNew: false,
              eventIds: [],
            },
          ],
        })}
      />,
    );
    expect(steps()).toEqual([
      "You asked",
      "Claude looked",
      "Claude did",
      "Ended",
    ]);
    const [asked, looked, did] = [...document.querySelectorAll(".rs-step")];
    expect(asked?.textContent).toContain(
      "Umang sent me this (pasted text) Can you check?",
    );
    expect(asked?.textContent).not.toContain("pasted_content");
    expect(looked?.textContent).toContain("12 reads");
    expect(looked?.textContent).toContain("3 searches");
    expect(looked?.textContent).toContain("1 web lookup");
    expect(did?.textContent).toContain("fonts.ts");
    expect(did?.textContent).toContain("theme.css");
    expect(did?.textContent).toContain("4 commands");
    expect(did?.textContent).toContain("1 helper");
  });

  it("a request still going ends in Now, not Ended", () => {
    render(
      <FlowBoard
        sessionId="s1"
        request={request({
          id: "r9",
          prompt: "[Image #1]",
          finished: false,
          state: "running",
        })}
      />,
    );
    expect(steps()).toEqual(["You asked", "Now"]);
    expect(document.querySelector(".rs-step")?.textContent).toContain(
      "(image)",
    );
  });
});

function session(kindInferred: boolean): SessionView {
  return {
    sessionId: "s1",
    cwd: "/x/app",
    title: "yes",
    startedAt: day(2),
    lastEventAt: day(2, 30),
    ended: true,
    needsYou: null,
    requests: [
      request({
        id: "r1",
        prompt: PASTED,
        kind: "question",
        kindInferred,
        outcome: "Understood.",
      }),
      request({ id: "r2", startedAt: day(2, 10), kind: "bug", kindInferred }),
    ],
  };
}

describe("honest labels", () => {
  it("the journey shows a kind chip only where Claude named the kind", () => {
    render(
      <Live
        sessionId="s1"
        view={session(true)}
        status="live"
        lastLooked={null}
      />,
    );
    const line = document.querySelector(".jr-line") as HTMLElement;
    expect(line.querySelectorAll(".label-chip")).toHaveLength(0);
    const from = document.querySelector(".jr-end.from") as HTMLElement;
    expect(from.textContent).not.toContain("Question");
    expect(from.querySelector(".jr-q")?.textContent).toBe(
      "Umang sent me this (pasted text) Can you check?",
    );
    cleanup();
    render(
      <Live
        sessionId="s1"
        view={session(false)}
        status="live"
        lastLooked={null}
      />,
    );
    expect(
      [...document.querySelectorAll(".jr-line .label-chip")].map(
        (c) => c.textContent,
      ),
    ).toEqual(["Question", "Bug hunt"]);
  });

  it("the request header shows no guessed kind, and a prompt title reads cleaned", () => {
    render(
      <Live
        sessionId="s1"
        view={session(true)}
        requestId="r1"
        status="live"
        lastLooked={null}
      />,
    );
    const main = screen.getByRole("main");
    expect(main.querySelector(".over .label-chip")).toBeNull();
    expect(main.textContent).not.toContain("inferred");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Umang sent me this (pasted text) Can you check?",
    );
    cleanup();
    render(
      <Live
        sessionId="s1"
        view={session(false)}
        requestId="r1"
        status="live"
        lastLooked={null}
      />,
    );
    expect(
      screen.getByRole("main").querySelector(".over .label-chip")?.textContent,
    ).toBe("Question");
  });
});
