import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const ME = { id: "u1", login: "ada", name: "Ada", avatarUrl: null };

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const r = routes[`${init.method ?? "GET"} ${url}`];
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
    expect(sessionStorage.getItem("murmur:pendingDevice")).toBe("ABCD-1234");
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
});
