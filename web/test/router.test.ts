import { describe, expect, it, vi } from "vitest";
import {
  closedHere,
  floorPath,
  helperPath,
  matchRoute,
  navigate,
  partPath,
  redirectOf,
  requestPath,
  sessionPath,
} from "../src/router";

describe("matchRoute", () => {
  it("reads a session address as a floor of the office and what its panel shows", () => {
    expect(matchRoute("/s/abc")).toEqual({ name: "session", sessionId: "abc" });
    expect(matchRoute("/s/abc?open=journey")).toEqual({
      name: "session",
      sessionId: "abc",
      open: "journey",
    });
    expect(matchRoute("/s/abc/r/q?open=task:p%2F1")).toEqual({
      name: "session",
      sessionId: "abc",
      requestId: "q",
      open: "task:p/1",
    });
    expect(matchRoute("/s/abc/r/q")).toEqual({
      name: "session",
      sessionId: "abc",
      requestId: "q",
    });
  });
  it("parses the other routes", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
    expect(matchRoute("/device?code=ABCD-1234")).toEqual({
      name: "device",
      code: "ABCD-1234",
    });
    expect(matchRoute("/settings")).toEqual({ name: "settings" });
    expect(matchRoute("/nope")).toEqual({ name: "notFound" });
    expect(matchRoute("/s/%E0%A4/r/q")).toEqual({ name: "notFound" });
    expect(matchRoute("/s/abc/r/q/x/y/z")).toEqual({ name: "notFound" });
  });
});

describe("the path helpers give office addresses", () => {
  it("names the floor, then what the panel shows", () => {
    expect(sessionPath("a b")).toBe("/s/a%20b");
    expect(sessionPath("a", "timeline")).toBe("/s/a?open=timeline");
    expect(requestPath("a", "q")).toBe("/s/a/r/q?open=story");
    expect(requestPath("a", "q", "flow")).toBe("/s/a/r/q?open=flow");
    expect(partPath("a", "q", "p 1")).toBe("/s/a/r/q?open=task:p%201");
    expect(helperPath("a", "q", "x")).toBe("/s/a/r/q?open=helper:x");
    expect(floorPath("a", undefined, null)).toBe("/s/a");
  });
  it("reads back what it wrote", () => {
    expect(matchRoute(partPath("a", "q/1", "p:1"))).toEqual({
      name: "session",
      sessionId: "a",
      requestId: "q/1",
      open: "task:p:1",
    });
  });
});

describe("old addresses", () => {
  it("land where they meant, in the office", () => {
    expect(redirectOf("/s/a/flow?r=q")).toBe("/s/a?open=timeline&r=q");
    expect(redirectOf("/s/a/office")).toBe("/s/a");
    expect(redirectOf("/s/a/r/q/office")).toBe("/s/a/r/q");
    expect(redirectOf("/s/a/r/q/files")).toBe("/s/a/r/q?open=files");
    expect(redirectOf("/s/a/r/q/flow?part=p")).toBe("/s/a/r/q?open=flow&part=p");
    expect(redirectOf("/s/a/r/q/p/p1#x")).toBe("/s/a/r/q?open=task:p1#x");
  });
  it("leaves a current address alone", () => {
    expect(redirectOf("/s/a")).toBeNull();
    expect(redirectOf("/s/a/r/q?open=story")).toBeNull();
    expect(redirectOf("/settings")).toBeNull();
  });
});

describe("navigate", () => {
  it("pushes an entry, so Back walks every move", () => {
    const before = history.length;
    navigate("/s/x?open=story");
    navigate("/s/x?open=tasks");
    expect(location.pathname + location.search).toBe("/s/x?open=tasks");
    expect(history.length).toBe(before + 2);
  });
  it("marks an entry whose panel was closed by hand", () => {
    navigate("/s/x", { closed: true });
    expect(closedHere()).toBe(true);
    navigate("/s/x?open=story");
    expect(closedHere()).toBe(false);
  });
  it("starts another page at its top, but not a move within the page", () => {
    navigate("/s/a/r/b");
    const top = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    navigate("/s/a/r/c");
    expect(top).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledWith(0, 0);
    navigate("/s/a/r/c?open=flow");
    navigate("/s/a/r/c#phase-p1");
    expect(top).toHaveBeenCalledTimes(1);
    top.mockRestore();
  });
});
