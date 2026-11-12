import { readFileSync } from "node:fs";
import type { RequestView, SessionView } from "@murmur/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live, roomInJsdom } from "./officeShell";

roomInJsdom();

const css = readFileSync("src/theme.css", "utf8");

/** Every rule inside the `prefers-reduced-motion: reduce` blocks, as one string. */
function reducedRules(): string {
  const out: string[] = [];
  const re = /@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{/g;
  for (const m of css.matchAll(re)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    while (depth && i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out.join("\n");
}

const day = (d: number, min = 0) =>
  new Date(Date.UTC(2026, 10, d, 12, min)).toISOString();

function request(r: Partial<RequestView> & { id: string }): RequestView {
  return {
    prompt: "do it",
    startedAt: day(2),
    kind: "feature",
    kindInferred: false,
    goal: "Some work",
    phases: [],
    planInferred: false,
    parts: [],
    looseFiles: [],
    now: null,
    agents: [],
    assumptions: [],
    flags: [],
    finished: true,
    tally: { helpers: 1, files: 1, commands: 1 },
    messages: [],
    state: "done",
    ...r,
  };
}

const view = (): SessionView => ({
  sessionId: "s1",
  cwd: "/x/p",
  title: "Make it work",
  startedAt: day(2),
  lastEventAt: day(3),
  ended: false,
  needsYou: null,
  requests: [
    request({ id: "r1" }),
    // An older request whose helper still runs, and the newest one: both running.
    request({ id: "r2", startedAt: day(2, 30), state: "running" }),
    request({ id: "r3", startedAt: day(3), state: "running", finished: false }),
  ],
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("one loop on screen", () => {
  const show = (requestId?: string) =>
    render(
      <Live
        sessionId="s1"
        view={view()}
        status="live"
        lastLooked={null}
        {...(requestId ? { requestId } : {})}
      />,
    );

  it("on the journey only the running station pulses, not the rail", () => {
    show();
    const pulses = document.querySelectorAll(".pulse");
    expect(pulses).toHaveLength(1);
    expect(pulses[0]?.closest(".jr-st")).toBeTruthy();
    expect(pulses[0]?.closest(".rail")).toBeNull();
  });

  it("the requests rail never pulses: the room is the live thing", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });
    show("r1");
    expect(document.querySelector(".of-rail")).toBeTruthy();
    expect(document.querySelectorAll(".of-rail .pulse")).toHaveLength(0);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
  });

  it("only the pulse class loops", () => {
    const loops = [...css.matchAll(/animation:[^;]*infinite/g)].length;
    const pulses = [
      ...css.matchAll(/animation:\s*pulse 2\.4s ease-in-out infinite/g),
    ].length;
    expect(loops).toBe(pulses);
  });
});

describe("entrances run once", () => {
  const show = (v: SessionView) => (
    <Live sessionId="s-enter" view={v} status="live" lastLooked={null} />
  );
  const rising = () =>
    [...document.querySelectorAll(".jr-in")].map((el) =>
      el.classList.contains("jr-st")
        ? (el.querySelector(".jr-card") as HTMLElement).getAttribute("href")
        : el.className,
    );

  it("rise on first load, never again on a live update or coming back, except a new station", () => {
    const { unmount } = render(show(view()));
    expect(rising()).toEqual([
      "jr-ends jr-in",
      "/s/s-enter/r/r1?open=story",
      "/s/s-enter/r/r2?open=story",
      "/s/s-enter/r/r3?open=story",
    ]);
    unmount();
    // Back on the journey: nothing replays.
    const again = render(show(view()));
    expect(rising()).toEqual([]);
    // A request arrives live: only its station rises.
    const more = view();
    more.requests.push(request({ id: "r4", startedAt: day(3, 30) }));
    again.rerender(show(more));
    expect(rising()).toEqual(["/s/s-enter/r/r4?open=story"]);
  });
});

describe("reduced motion", () => {
  const reduced = reducedRules();

  it("the pulse becomes a static ring", () => {
    expect(reduced).toMatch(/\.mk\.pulse\s*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.mk\.pulse\s*\{[^}]*box-shadow/);
  });

  it("the journey's rises become fades and its lines are drawn at once", () => {
    expect(reduced).toMatch(/\.jr-in[^{]*\{[^}]*animation:\s*fade-in 150ms/);
    expect(reduced).toMatch(/\.jr-seg::before[^{]*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.jr-join::before[^{]*\{[^}]*animation:\s*none/);
  });

  it("a chapter jump does not glide", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const jump = vi.fn();
    Element.prototype.scrollIntoView = jump;
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      addEventListener() {},
      removeEventListener() {},
    }));
    history.pushState(null, "", "/s/s1");
    const v = view();
    v.journey = {
      chapters: [
        { title: "A", requestIds: ["r1"], state: "done" },
        { title: "B", requestIds: ["r2", "r3"], state: "running" },
      ],
      pauses: [],
      decisions: [],
      totals: { helpers: 0, files: 0, commands: 0, sentBack: 0, pauses: 0 },
    };
    render(<Live sessionId="s1" view={v} status="live" lastLooked={null} />);
    await userEvent.click(
      document.querySelector('a[href="#chapter-2"]') as HTMLElement,
    );
    expect(jump).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(location.hash).toBe("#chapter-2");
  });
});
