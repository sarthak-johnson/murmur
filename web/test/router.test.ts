import { afterEach, describe, expect, it, vi } from "vitest";
import {
  matchRoute,
  navigate,
  officePath,
  requestPath,
  sessionPath,
} from "../src/router";

describe("matchRoute", () => {
  it("parses the office, following the session or pinned to a request", () => {
    expect(matchRoute("/s/abc/office")).toEqual({
      name: "office",
      sessionId: "abc",
    });
    expect(matchRoute("/s/abc/r/q/office")).toEqual({
      name: "office",
      sessionId: "abc",
      requestId: "q",
    });
    expect(officePath("a b")).toBe("/s/a%20b/office");
    expect(officePath("a", "q")).toBe("/s/a/r/q/office");
    expect(matchRoute(officePath("a", "q/1"))).toEqual({
      name: "office",
      sessionId: "a",
      requestId: "q/1",
    });
  });
  it("parses part route", () => {
    expect(matchRoute("/s/abc/r/req1/p/part2")).toEqual({
      name: "part",
      sessionId: "abc",
      requestId: "req1",
      partId: "part2",
    });
  });
  it("parses the other routes", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
    expect(matchRoute("/device?code=ABCD-1234")).toEqual({
      name: "device",
      code: "ABCD-1234",
    });
    expect(matchRoute("/settings")).toEqual({ name: "settings" });
    expect(matchRoute("/s/abc")).toEqual({
      name: "session",
      sessionId: "abc",
      tab: "journey",
    });
    expect(matchRoute("/s/abc/r/q")).toEqual({
      name: "request",
      sessionId: "abc",
      requestId: "q",
      tab: "story",
    });
    expect(matchRoute("/nope")).toEqual({ name: "notFound" });
    expect(matchRoute("/s/%E0%A4/r/q")).toEqual({ name: "notFound" });
  });
  it("parses a request's tabs, and nothing else after it", () => {
    for (const tab of ["tasks", "flow", "files", "helpers"] as const)
      expect(matchRoute(`/s/abc/r/q/${tab}`)).toEqual({
        name: "request",
        sessionId: "abc",
        requestId: "q",
        tab,
      });
    // Story is the bare path, never a second URL for the same page.
    expect(matchRoute("/s/abc/r/q/story")).toEqual({ name: "notFound" });
    expect(matchRoute("/s/abc/r/q/map")).toEqual({ name: "notFound" });
  });
  it("parses the session's tabs: the journey is the bare path, the flow its own", () => {
    expect(matchRoute("/s/abc/flow?r=q")).toEqual({
      name: "session",
      sessionId: "abc",
      tab: "flow",
    });
    expect(matchRoute("/s/abc/journey")).toEqual({ name: "notFound" });
    expect(matchRoute("/s/abc/flow/x")).toEqual({ name: "notFound" });
    expect(sessionPath("a b")).toBe("/s/a%20b");
    expect(sessionPath("a", "journey")).toBe("/s/a");
    expect(sessionPath("a", "flow")).toBe("/s/a/flow");
  });
  it("builds a request's path per tab", () => {
    expect(requestPath("a b", "q")).toBe("/s/a%20b/r/q");
    expect(requestPath("a", "q", "story")).toBe("/s/a/r/q");
    expect(requestPath("a", "q", "flow")).toBe("/s/a/r/q/flow");
    expect(requestPath("a", "q", "tasks")).toBe("/s/a/r/q/tasks");
  });
});

describe("navigate", () => {
  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });
  it("is instant without View Transitions", () => {
    navigate("/s/x");
    expect(location.pathname).toBe("/s/x");
  });
  it("runs the route change inside a view transition where there is one", () => {
    const start = vi.fn((update: () => void) => update());
    Object.assign(document, { startViewTransition: start });
    navigate("/s/y/r/q/flow");
    expect(start).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe("/s/y/r/q/flow");
  });
  it("starts another page at its top, but not a move within the page", () => {
    navigate("/s/a/r/b");
    const top = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    navigate("/s/a/r/c");
    expect(top).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledWith(0, 0);
    navigate("/s/a/r/c#phase-p1");
    navigate("/s/a/r/c");
    expect(top).toHaveBeenCalledTimes(1);
    top.mockRestore();
  });
});
