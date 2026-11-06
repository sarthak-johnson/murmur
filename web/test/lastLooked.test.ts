import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLastLooked } from "../src/lastLooked";

const KEY = "murmur:lastLooked:s1";
function setVisibility(v: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    value: v,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useLastLooked", () => {
  it("null on first visit", () => {
    expect(renderHook(() => useLastLooked("s1")).result.current).toBeNull();
  });

  it("last-looked is the time the tab was hidden", () => {
    localStorage.setItem(KEY, "2025-12-31T00:00:00.000Z");
    const { result } = renderHook(() => useLastLooked("s1"));
    expect(result.current).toBe("2025-12-31T00:00:00.000Z");
    act(() => setVisibility("hidden"));
    expect(localStorage.getItem(KEY)).toBe("2026-01-01T10:00:00.000Z");
    expect(result.current).toBe("2025-12-31T00:00:00.000Z"); // stable
    act(() => setVisibility("visible"));
    expect(result.current).toBe("2026-01-01T10:00:00.000Z");
  });

  it("window blur also counts, and storage failures are swallowed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useLastLooked("s1"));
    expect(() =>
      act(() => void window.dispatchEvent(new Event("blur"))),
    ).not.toThrow();
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(result.current).toBe("2026-01-01T10:00:00.000Z");
    vi.restoreAllMocks();
  });
});
