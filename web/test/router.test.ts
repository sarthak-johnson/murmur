import { describe, expect, it } from "vitest";
import { matchRoute } from "../src/router";

describe("matchRoute", () => {
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
    expect(matchRoute("/s/abc")).toEqual({ name: "session", sessionId: "abc" });
    expect(matchRoute("/s/abc/r/q")).toEqual({
      name: "request",
      sessionId: "abc",
      requestId: "q",
    });
    expect(matchRoute("/nope")).toEqual({ name: "notFound" });
  });
});
