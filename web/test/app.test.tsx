import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("paints the header and the live skeleton before /api/me answers", () => {
    history.pushState(null, "", "/s/s1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const { container } = render(<App />);
    expect(screen.getByText("Murmur")).toBeTruthy();
    // Mirrors the loaded layout: requests placeholder first, then the main column.
    const page = container.querySelector(".live-page");
    expect(page?.children[0]?.className).toContain("sk-requests");
    expect(page?.children[1]?.className).toBe("live-main");
    expect(page?.children[1]?.querySelector(".skeleton")).toBeTruthy();
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

  it("the part route uses the wide header like the live screen", async () => {
    history.pushState(null, "", "/s/s1/r/r1/p/x");
    mockFetch({ "GET /api/me": { body: ME } });
    const { container } = render(<App />);
    await waitFor(() =>
      expect(container.querySelector(".header-in.wide")).toBeTruthy(),
    );
  });
});
