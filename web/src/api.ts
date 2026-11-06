import type { MurmurEvent } from "@murmur/core";

export interface Me {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}
export interface SessionRow {
  sessionId: string;
  cwd: string;
  title: string | null;
  machineName: string;
  startedAt: string;
  lastEventAt: string;
  ended: boolean;
}
export interface Machine {
  machineId: string;
  machineName: string;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface Decision {
  key: string;
  decision: string;
}

/** Fired on window when any call other than /api/me gets a 401. */
export const UNAUTHORIZED = "murmur:unauthorized";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (method !== "GET") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    // /api/me answers 401 for signed-out visitors; the app handles that itself.
    if (res.status === 401 && path !== "/api/me")
      window.dispatchEvent(new Event(UNAUTHORIZED));
    throw new ApiError(res.status, data.error ?? "error");
  }
  return data as T;
}

const id = encodeURIComponent;

export const api = {
  /** null when signed out. */
  async me(): Promise<Me | null> {
    try {
      return await call<Me>("GET", "/api/me");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  logout: () => call<unknown>("POST", "/auth/logout"),
  approveDevice: (userCode: string) =>
    call<{ ok: true }>("POST", "/api/device/approve", { userCode }),
  sessions: () => call<{ sessions: SessionRow[] }>("GET", "/api/sessions"),
  events: (sessionId: string, after?: string, afterId?: string) => {
    const q = new URLSearchParams();
    if (after) q.set("after", after);
    if (afterId) q.set("afterId", afterId);
    return call<{ events: MurmurEvent[]; hasMore: boolean }>(
      "GET",
      `/api/sessions/${id(sessionId)}/events?${q}`,
    );
  },
  /** Live updates; the caller owns closing it. */
  stream: (sessionId: string) =>
    new EventSource(`/api/sessions/${id(sessionId)}/stream`),
  assumptions: (sessionId: string) =>
    call<{ decisions: Decision[] }>(
      "GET",
      `/api/sessions/${id(sessionId)}/assumptions`,
    ),
  setAssumption: (sessionId: string, key: string, decision: string) =>
    call<unknown>("PUT", `/api/sessions/${id(sessionId)}/assumptions`, {
      key,
      decision,
    }),
  deleteSession: (sessionId: string) =>
    call<unknown>("DELETE", `/api/sessions/${id(sessionId)}`),
  settings: () => call<{ retentionDays: number }>("GET", "/api/settings"),
  setSettings: (retentionDays: number) =>
    call<unknown>("PUT", "/api/settings", { retentionDays }),
  machines: () => call<{ machines: Machine[] }>("GET", "/api/machines"),
  revokeMachine: (machineId: string) =>
    call<unknown>("DELETE", `/api/machines/${id(machineId)}`),
  deleteAccount: () => call<unknown>("DELETE", "/api/account"),
};
