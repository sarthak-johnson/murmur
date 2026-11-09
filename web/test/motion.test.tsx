import { readFileSync } from "node:fs";
import type { RequestView, SessionView } from "@murmur/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live } from "../src/pages/Session";
import { navigate, useRoute } from "../src/router";

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
  delete (document as { startViewTransition?: unknown }).startViewTransition;
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

  it("on a request's page only the rail's newest running mark pulses", () => {
    show("r1");
    const pulses = document.querySelectorAll(".pulse");
    expect(pulses).toHaveLength(1);
    expect(pulses[0]?.closest(".stop")?.getAttribute("href")).toBe(
      "/s/s1/r/r3",
    );
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
      "/s/s-enter/r/r1",
      "/s/s-enter/r/r2",
      "/s/s-enter/r/r3",
    ]);
    unmount();
    // Back on the journey: nothing replays.
    const again = render(show(view()));
    expect(rising()).toEqual([]);
    // A request arrives live: only its station rises.
    const more = view();
    more.requests.push(request({ id: "r4", startedAt: day(3, 30) }));
    again.rerender(show(more));
    expect(rising()).toEqual(["/s/s-enter/r/r4"]);
  });
});

describe("reduced motion", () => {
  const reduced = reducedRules();

  it("the pulse becomes a static ring", () => {
    expect(reduced).toMatch(/\.mk\.pulse\s*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.mk\.pulse\s*\{[^}]*box-shadow/);
  });

  it("shared elements become a 150 ms crossfade", () => {
    expect(reduced).toMatch(
      /::view-transition-group\(page-title\)[^{]*\{[^}]*animation:\s*none/,
    );
    expect(reduced).toMatch(
      /::view-transition-old\(page-title\)[^{]*\{[^}]*150ms[^}]*vt-out/,
    );
    expect(reduced).toMatch(
      /::view-transition-new\(page-title\)[^{]*\{[^}]*150ms[^}]*vt-in/,
    );
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

/** A journey with two station cards, and a request page with its title. */
function Page() {
  const route = useRoute();
  return route.name === "session" ? (
    <main>
      <a href="/s/s1/r/r1" data-morph="">
        1
      </a>
      <a href="/s/s1/r/r2" data-morph="">
        2
      </a>
    </main>
  ) : (
    <h1 className="live-title">Request</h1>
  );
}

describe("the clicked card becomes the next page's title", () => {
  function setup() {
    const seen: (string | null)[] = [];
    const start = vi.fn((update: () => void) => {
      // What the browser snapshots as the old page.
      seen.push(
        document.querySelector(".vt-src")?.getAttribute("href") ?? null,
        document.documentElement.classList.contains("vt-morph") ? "morph" : "",
      );
      update();
      seen.push(
        document.querySelector(".vt-src")?.getAttribute("href") ?? null,
        document.documentElement.classList.contains("vt-morph") ? "morph" : "",
      );
      return { finished: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition: start });
    return { seen, start };
  }

  it("names the clicked card in the old page, the title in the new one", () => {
    history.pushState(null, "", "/s/s1");
    const card = document.createElement("a");
    card.setAttribute("href", "/s/s1/r/r2");
    card.setAttribute("data-morph", "");
    document.body.append(card);
    const { seen } = setup();
    navigate("/s/s1/r/r2", card);
    expect(seen).toEqual(["/s/s1/r/r2", "morph", null, ""]);
    card.remove();
  });

  it("a click on anything else is a plain page change", () => {
    history.pushState(null, "", "/s/s1");
    const link = document.createElement("a");
    link.setAttribute("href", "/settings");
    document.body.append(link);
    const { seen } = setup();
    navigate("/settings", link);
    expect(seen).toEqual([null, "", null, ""]);
    link.remove();
  });

  it("back runs the same path reversed, into the card it came from", async () => {
    history.pushState(null, "", "/s/s1");
    render(<Page />);
    act(() => navigate("/s/s1/r/r2"));
    const { seen, start } = setup();
    // The browser's back: the URL is already the journey's when popstate fires.
    history.replaceState(null, "", "/s/s1");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null, "", "/s/s1/r/r2", "morph"]);
    // Named only for the transition.
    expect(document.querySelector(".vt-src")).toBeNull();
    expect(document.documentElement.classList.contains("vt-morph")).toBe(false);
  });
});
