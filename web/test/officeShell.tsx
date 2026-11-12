// The office as tests render it: jsdom has no 2d canvas and no ResizeObserver, so the room
// draws into a context that takes every call, and `Live` names a view the way the old
// request page's props did (a request's tab, a task, the session's journey or flow).
import type { MurmurEvent, SessionView } from "@murmur/core";
import { act, screen, within } from "@testing-library/react";
import { beforeAll, vi } from "vitest";
import { Office, OfficeShell } from "../src/office/Office";
import { useRoute } from "../src/router";
import type { SessionStatus } from "../src/useSession";

function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  const target: Record<string | symbol, unknown> = {
    canvas,
    measureText: (s: string) => ({ width: s.length * 7 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Gives jsdom what the room needs to draw: a canvas context and a ResizeObserver. */
export function roomInJsdom() {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        return fakeContext(this);
      } as unknown as HTMLCanvasElement["getContext"],
    );
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
}

export interface LiveProps {
  sessionId: string;
  requestId?: string | undefined;
  partId?: string | undefined;
  tab?: "story" | "tasks" | "flow" | "files" | "helpers" | undefined;
  sessionTab?: "journey" | "flow" | undefined;
  /** The panel's `open` itself, for a close-up the props above do not name. */
  open?: string | undefined;
  view: SessionView | null;
  events?: MurmurEvent[];
  status: SessionStatus;
  lastLooked: string | null;
}

/**
 * The office at the view the props name, as the old pages' props did: a task's close-up,
 * a named request's tab (its story by default), or with no request the session's journey
 * or timeline.
 */
export function Live(p: LiveProps) {
  // As the app: nothing is drawn from the first pages, which would show an old floor.
  if (!p.view || p.status === "loading")
    return <OfficeShell status={p.status} />;
  if (!p.view.requests.length)
    return (
      <OfficeShell
        status={p.status}
        note="Waiting for the first prompt in this session."
      />
    );
  const open =
    p.open ??
    (p.partId
      ? `task:${p.partId}`
      : !p.requestId
        ? p.sessionTab === "flow"
          ? "timeline"
          : "journey"
        : (p.tab ?? "story"));
  return (
    <Office
      sessionId={p.sessionId}
      pinnedId={p.requestId}
      open={open}
      view={p.view}
      events={p.events ?? []}
      status={p.status}
      lastLooked={p.lastLooked}
    />
  );
}

/**
 * The office driven by the address, as the app drives it: a click that moves (a tab, a
 * desk, Escape) changes what it shows. Call `history.replaceState` first to start at a URL.
 */
export function Routed(p: {
  view: SessionView;
  events?: MurmurEvent[];
  status: SessionStatus;
}) {
  const route = useRoute();
  if (route.name !== "session") return null;
  return (
    <Office
      sessionId={route.sessionId}
      pinnedId={route.requestId}
      open={route.open}
      view={p.view}
      events={p.events ?? []}
      status={p.status}
    />
  );
}

/** The panel: where every view of the session and its requests reads. */
export const panel = () =>
  within(screen.getByRole("complementary", { name: "Details" }));

/** Lets the room paint a few frames, so its overlay has its words and hit areas. */
export async function frames() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}
