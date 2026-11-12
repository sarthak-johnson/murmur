import { afterEach, beforeEach, vi } from "vitest";

/**
 * Date reads `iso` in every test of the file: a fixture stays as live as it was written,
 * whatever day the tests run (state.ts calls a session quiet after 15 minutes).
 */
export function clockAt(iso: string) {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse(iso), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
