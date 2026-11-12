import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const ME = { id: "u1", login: "ada", name: "Ada", avatarUrl: null };

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const all: typeof routes = {
        "GET /auth/options": { body: { github: true, dev: false } },
        ...routes,
      };
      const r = all[`${init.method ?? "GET"} ${url}`];
      if (!r) throw new Error(`unexpected ${url}`);
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.body } as Response;
    }),
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("signed out on /device stores the code and shows login", async () => {
    history.pushState(null, "", "/device?code=ABCD-1234");
    mockFetch({
      "GET /api/me": { status: 401, body: { error: "unauthorized" } },
    });
    render(<App />);
    expect(
      await screen.findByRole("link", { name: "Sign in with GitHub" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(sessionStorage.getItem("murmur:pendingDevice")).toBe("ABCD-1234"),
    );
  });

  it("signed in on / goes to the pending device page and clears the key", async () => {
    sessionStorage.setItem("murmur:pendingDevice", "ABCD-1234");
    history.pushState(null, "", "/");
    mockFetch({
      "GET /api/me": { body: ME },
      "GET /api/sessions": { body: { sessions: [] } },
    });
    render(<App />);
    expect(await screen.findByText("Connect this machine?")).toBeTruthy();
    expect(location.pathname + location.search).toBe("/device?code=ABCD-1234");
    expect(sessionStorage.getItem("murmur:pendingDevice")).toBeNull();
  });

  it("a 401 from the sessions list returns to the login page", async () => {
    history.pushState(null, "", "/");
    mockFetch({
      "GET /api/me": { body: ME },
      "GET /api/sessions": { status: 401, body: { error: "unauthorized" } },
    });
    render(<App />);
    expect(
      await screen.findByRole("link", { name: "Sign in with GitHub" }),
    ).toBeTruthy();
  });

  it("paints the office's shell before /api/me answers", () => {
    history.pushState(null, "", "/s/s1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const { container } = render(<App />);
    expect(screen.getByText("Murmur")).toBeTruthy();
    // Mirrors the loaded office: its bar, the stage, its replay bar.
    const office = container.querySelector(".office");
    expect(
      [...(office?.children ?? [])].map((c) => c.className.split(" ")[0]),
    ).toEqual(["of-top", "of-body", "of-replay"]);
    expect(screen.getByRole("status").textContent).toBe("Opening the office…");
  });

  it("a failed /api/me retries instead of showing the login page", async () => {
    history.pushState(null, "", "/");
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/me" && ++n === 1)
          return { ok: false, status: 502, json: async () => ({}) } as Response;
        const body = url === "/api/me" ? ME : { sessions: [] };
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    render(<App />);
    expect(
      await screen.findByText("Could not reach Murmur. Retrying…"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Sign in with GitHub" }),
    ).toBeNull();
    expect(await screen.findByText("ada", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("Could not reach Murmur. Retrying…")).toBeNull();
  });

  it("an old task address opens in the office, with the account links in its menu", async () => {
    history.pushState(null, "", "/s/s1/r/r1/p/x");
    mockFetch({
      "GET /api/me": { body: ME },
      "GET /api/sessions/s1/events?": {
        body: { events: [], hasMore: false },
      },
    });
    vi.stubGlobal(
      "EventSource",
      class {
        // Subscribed at once, with nothing new to send.
        addEventListener(type: string, fn: () => void) {
          if (type === "ready") setTimeout(fn);
        }
        close() {}
      },
    );
    const { container } = render(<App />);
    expect(location.pathname + location.search).toBe("/s/s1/r/r1?open=task:x");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Waiting for the first prompt in this session.",
      ),
    );
    expect(container.querySelector(".office .of-top")).toBeTruthy();
    expect(container.querySelector(".header")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByText("ada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete session" })).toBeTruthy();
    expect(
      within(screen.getByRole("navigation", { name: "Account" })).getByRole(
        "button",
        { name: "Sign out" },
      ),
    ).toBeTruthy();
  });
});
