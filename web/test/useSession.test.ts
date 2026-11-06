import type { MurmurEvent } from "@murmur/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api";
import { useSession } from "../src/useSession";

class FakeES {
  static all: FakeES[] = [];
  closed = false;
  handlers: Record<string, (e: { data: string }) => void> = {};
  onerror: (() => void) | null = null;
  constructor() {
    FakeES.all.push(this);
  }
  addEventListener(n: string, h: (e: { data: string }) => void) {
    this.handlers[n] = h;
  }
  close() {
    this.closed = true;
  }
  push(evs: MurmurEvent[]) {
    this.handlers.events?.({ data: JSON.stringify(evs) });
  }
}

const ev = (
  id: string,
  ts: string,
  hook = "UserPromptSubmit",
): MurmurEvent => ({
  id,
  sessionId: "s1",
  machineId: "m1",
  cwd: "/x",
  ts,
  hook: hook as MurmurEvent["hook"],
  payload: { prompt: id },
});
const A = ev("a", "2026-01-01T00:00:01.000Z");
const B = ev("b", "2026-01-01T00:00:02.000Z");
const C = ev("c", "2026-01-01T00:00:03.000Z");

let events: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  FakeES.all = [];
  vi.spyOn(api, "stream").mockImplementation(
    () => new FakeES() as unknown as EventSource,
  );
  events = vi.spyOn(api, "events");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const flush = () =>
  act(async () => void (await vi.advanceTimersByTimeAsync(0)));

describe("useSession", () => {
  it("stream events extend the view", async () => {
    events.mockResolvedValueOnce({ events: [A], hasMore: false });
    const { result } = renderHook(() => useSession("s1"));
    expect(result.current.view).toBeNull();
    expect(result.current.status).toBe("loading");
    await flush();
    expect(result.current.status).toBe("live");
    const before = result.current.view;
    expect(before).not.toBeNull();
    act(() => FakeES.all[0]?.push([B, A]));
    expect(result.current.view).not.toEqual(before);
    expect(result.current.viewAt(A.ts)).toEqual(before);
  });

  it("pages through hasMore before opening the stream", async () => {
    events
      .mockResolvedValueOnce({ events: [A], hasMore: true })
      .mockResolvedValueOnce({ events: [B], hasMore: false });
    renderHook(() => useSession("s1"));
    await flush();
    expect(events).toHaveBeenNthCalledWith(2, "s1", A.ts, "a");
    expect(FakeES.all).toHaveLength(1);
  });

  it("reconnect fetches only after the cursor, with backoff", async () => {
    events.mockResolvedValueOnce({ events: [A, B], hasMore: false });
    const { result } = renderHook(() => useSession("s1"));
    await flush();
    events.mockRejectedValueOnce(new Error("net"));
    events.mockResolvedValueOnce({ events: [C], hasMore: false });
    act(() => FakeES.all[0]?.onerror?.());
    expect(result.current.status).toBe("reconnecting");
    expect(FakeES.all[0]?.closed).toBe(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(events).toHaveBeenLastCalledWith("s1", B.ts, "b");
    expect(FakeES.all).toHaveLength(1); // fetch failed, still waiting
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
    expect(events).toHaveBeenCalledTimes(3);
    expect(FakeES.all).toHaveLength(2);
    expect(result.current.status).toBe("live");
  });

  it("404 sets error", async () => {
    events.mockRejectedValueOnce(new ApiError(404, "not_found"));
    const { result } = renderHook(() => useSession("s1"));
    await flush();
    expect(result.current.status).toBe("error");
  });

  it("closes the stream on unmount", async () => {
    events.mockResolvedValueOnce({ events: [], hasMore: false });
    const { unmount } = renderHook(() => useSession("s1"));
    await flush();
    unmount();
    expect(FakeES.all[0]?.closed).toBe(true);
  });
});
