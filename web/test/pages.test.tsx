import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Device } from "../src/pages/Device";
import { Login } from "../src/pages/Login";
import { Sessions } from "../src/pages/Sessions";
import { Settings } from "../src/pages/Settings";

type Handler = (init: RequestInit) => { status?: number; body: unknown };
let routes: Record<string, Handler>;
let calls: { key: string; init: RequestInit }[];

beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const key = `${init.method ?? "GET"} ${url}`;
      calls.push({ key, init });
      const h = routes[key];
      if (!h) throw new Error(`unexpected ${key}`);
      const r = h(init);
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("pages", () => {
  it("sessions page shows the empty-state install line", async () => {
    routes["GET /api/sessions"] = () => ({ body: { sessions: [] } });
    render(<Sessions />);
    expect(
      await screen.findByText(
        (_, el) =>
          el?.tagName === "P" &&
          el.textContent ===
            "No sessions yet. In Claude Code run /plugin install murmur@murmur, then /murmur:login.",
      ),
    ).toBeTruthy();
  });

  it("sessions rows show title, folder, machine and live marker", async () => {
    const now = new Date().toISOString();
    routes["GET /api/sessions"] = () => ({
      body: {
        sessions: [
          {
            sessionId: "s1",
            cwd: "/a/b/proj",
            title: null,
            machineName: "laptop",
            startedAt: now,
            lastEventAt: now,
            ended: false,
          },
        ],
      },
    });
    render(<Sessions />);
    expect(await screen.findByText("Untitled session")).toBeTruthy();
    expect(screen.getByText("proj").getAttribute("title")).toBe("/a/b/proj");
    expect(screen.getByText("live")).toBeTruthy();
  });

  it("device page names the machine and approves the code from the URL", async () => {
    routes["GET /api/device/info?code=ABCD-1234"] = () => ({
      body: { machineName: "ada-laptop" },
    });
    routes["POST /api/device/approve"] = () => ({ body: { ok: true } });
    render(<Device code="ABCD-1234" />);
    expect(await screen.findByText("Connect ada-laptop?")).toBeTruthy();
    expect(
      screen.getByText(
        "Only approve if you just ran /murmur:login on this machine.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("Connected. You can close this tab."),
    ).toBeTruthy();
    const c = calls[1];
    expect(c?.init.body).toBe(JSON.stringify({ userCode: "ABCD-1234" }));
    expect(c?.init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("device page explains an invalid code", async () => {
    routes["GET /api/device/info?code=ZZZZ-0000"] = () => ({
      status: 404,
      body: { error: "not_found" },
    });
    render(<Device code="ZZZZ-0000" />);
    expect(
      await screen.findByText(
        "That code is not valid or has expired. Run /murmur:login again.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("settings rejects retention 0", async () => {
    routes["GET /api/settings"] = () => ({ body: { retentionDays: 30 } });
    routes["GET /api/machines"] = () => ({ body: { machines: [] } });
    render(<Settings onSignedOut={() => {}} />);
    const input = await screen.findByLabelText("Keep sessions for (days)");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("30"));
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/from 1 to 3650/)).toBeTruthy();
    expect(calls.some((c) => c.key.startsWith("PUT"))).toBe(false);
  });

  it("settings lists machines and revoke calls the API", async () => {
    routes["GET /api/settings"] = () => ({ body: { retentionDays: 30 } });
    routes["GET /api/machines"] = () => ({
      body: {
        machines: [
          {
            machineId: "m1",
            machineName: "work-mac",
            createdAt: "2026-11-01T00:00:00Z",
            lastUsedAt: null,
          },
        ],
      },
    });
    routes["DELETE /api/machines/m1"] = () => ({ body: { ok: true } });
    render(<Settings onSignedOut={() => {}} />);
    expect(await screen.findByText("work-mac")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(calls.some((c) => c.key === "DELETE /api/machines/m1")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Revoke?" }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === "DELETE /api/machines/m1")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("work-mac")).toBeNull());
  });

  it("delete account needs the typed phrase then signs out", async () => {
    routes["GET /api/settings"] = () => ({ body: { retentionDays: 30 } });
    routes["GET /api/machines"] = () => ({ body: { machines: [] } });
    routes["DELETE /api/account"] = () => ({ body: { ok: true } });
    const out = vi.fn();
    render(<Settings onSignedOut={out} />);
    const btn = (await screen.findByRole("button", {
      name: "Delete account",
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await userEvent.type(
      screen.getByLabelText(/Type delete my account/),
      "delete my account",
    );
    await userEvent.click(btn);
    await waitFor(() => expect(out).toHaveBeenCalled());
  });

  it("a failed machines load shows an error, not the empty text", async () => {
    routes["GET /api/settings"] = () => ({ body: { retentionDays: 30 } });
    routes["GET /api/machines"] = () => ({
      status: 500,
      body: { error: "boom" },
    });
    render(<Settings onSignedOut={() => {}} />);
    expect(await screen.findByText("Could not load machines.")).toBeTruthy();
    expect(screen.queryByText("No linked machines.")).toBeNull();
  });

  it("a failed revoke shows an error line", async () => {
    routes["GET /api/settings"] = () => ({ body: { retentionDays: 30 } });
    routes["GET /api/machines"] = () => ({
      body: {
        machines: [
          {
            machineId: "m1",
            machineName: "work-mac",
            createdAt: "2026-11-01T00:00:00Z",
            lastUsedAt: null,
          },
        ],
      },
    });
    routes["DELETE /api/machines/m1"] = () => ({
      status: 500,
      body: { error: "boom" },
    });
    render(<Settings onSignedOut={() => {}} />);
    await screen.findByText("work-mac");
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke?" }));
    expect(
      await screen.findByText("Could not revoke that machine. Try again."),
    ).toBeTruthy();
    expect(screen.getByText("work-mac")).toBeTruthy();
  });

  it("login page shows what Murmur sends once and GitHub when the server offers it", async () => {
    routes["GET /auth/options"] = () => ({
      body: { github: true, dev: false },
    });
    render(<Login />);
    expect(screen.getAllByText("What Murmur sends")).toHaveLength(1);
    expect(
      (
        await screen.findByRole("link", { name: "Sign in with GitHub" })
      ).getAttribute("href"),
    ).toBe("/auth/github");
    expect(
      screen.queryByRole("button", { name: "Sign in locally" }),
    ).toBeNull();
  });

  it("login page offers local sign-in, not GitHub, on a dev server", async () => {
    routes["GET /auth/options"] = () => ({
      body: { github: false, dev: true },
    });
    render(<Login />);
    const name = await screen.findByLabelText("Your name");
    expect(
      screen.queryByRole("link", { name: "Sign in with GitHub" }),
    ).toBeNull();
    await userEvent.type(name, "sarthak");
    const form = name.closest("form") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/auth/dev");
    expect(form.getAttribute("method")).toBe("get");
    expect(name.getAttribute("name")).toBe("login");
  });

  it("login page says when no sign-in is set up", async () => {
    routes["GET /auth/options"] = () => ({
      body: { github: false, dev: false },
    });
    render(<Login />);
    expect(
      await screen.findByText("Sign-in is not set up on this server yet."),
    ).toBeTruthy();
  });
});
