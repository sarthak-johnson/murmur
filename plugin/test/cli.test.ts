import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { poll, run } from "../src/cli.js";
import {
  isNewSession,
  NO_NARRATION,
  projectState,
  queueDir,
  readCredentials,
  readSession,
  setProjectState,
  setRevoked,
  writeCredentials,
  writeSession,
} from "../src/local.js";
import { enqueue } from "../src/upload.js";

const queued = (cwd: string, id: string) =>
  enqueue({
    id,
    sessionId: "s1",
    machineId: "m",
    cwd,
    ts: new Date().toISOString(),
    hook: "Stop",
    payload: {},
  });
const queue = () => fs.readdirSync(queueDir()).map((n) => n.split("-")[1]);

let repo: string;
let servers: http.Server[] = [];
beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cli-"));
  process.env.MURMUR_HOME = path.join(home, "murmur");
  repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
});
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

type Reply = { status: number; body: unknown };
// A fake Murmur server: answers each path from a queue of replies, records bodies.
async function fake(routes: Record<string, Reply[]>) {
  const seen: { url: string; body: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      seen.push({ url: req.url ?? "", body: JSON.parse(raw || "null") });
      const queue = routes[req.url ?? ""] ?? [];
      const r = (queue.length > 1 ? queue.shift() : queue[0]) ?? {
        status: 404,
        body: {},
      };
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen };
}

const START = {
  deviceCode: "dev-1",
  userCode: "ABCD-1234",
  verifyUrl: "https://murmur.example/device",
  interval: 3,
  expiresIn: 600,
};

describe("cli", () => {
  it("on then status reports on", async () => {
    const env = { CLAUDE_CODE_SESSION_ID: "s1" };
    await run(["on", repo], env);
    const out = await run(["status", path.join(repo)], env);
    expect(out).toContain("This project: on");
    expect(out).toContain("Logged in: no");
    expect(out).toContain("Paused: no");
  });

  it("on in a session binds the session to the project and leaves it unseen", async () => {
    // /murmur:on runs `murmur on` with no folder, in the session's folder.
    const cwd = vi
      .spyOn(process, "cwd")
      .mockReturnValue(path.join(repo, "sub"));
    await run(["on"], { CLAUDE_CODE_SESSION_ID: "s1" });
    cwd.mockRestore();
    expect(readSession("s1").project).toBe(repo);
    // Its first hook still imports what came before.
    expect(isNewSession("s1")).toBe(true);
    await run(["on", repo], {});
    expect(isNewSession("")).toBe(true);
  });

  it("on through a symlink turns on the real folder Claude Code reports", async () => {
    const link = `${repo}-link`;
    fs.symlinkSync(repo, link);
    await run(["on", link], {});
    expect(projectState(fs.realpathSync(repo))).toBe("on");
  });

  it("on for another folder by hand does not bind the session", async () => {
    await run(["on", repo], { CLAUDE_CODE_SESSION_ID: "s1" });
    expect(readSession("s1").project).toBeUndefined();
  });

  it("status in a bound session names the project it follows", async () => {
    setProjectState(repo, "on");
    writeSession("s1", { ...NO_NARRATION, project: repo });
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "else-"));
    const out = await run(["status", elsewhere], {
      CLAUDE_CODE_SESSION_ID: "s1",
    });
    expect(out).toContain(`This project: on (this session follows ${repo})`);
  });

  it("pause is per session and resume undoes it", async () => {
    await run(["on", repo], {});
    await run(["pause", repo], { CLAUDE_CODE_SESSION_ID: "s1" });
    expect(
      await run(["status", repo], { CLAUDE_CODE_SESSION_ID: "s1" }),
    ).toContain("Paused: yes");
    expect(
      await run(["status", repo], { CLAUDE_CODE_SESSION_ID: "s2" }),
    ).toContain("Paused: no");
    await run(["resume", repo], { CLAUDE_CODE_SESSION_ID: "s1" });
    expect(
      await run(["status", repo], { CLAUDE_CODE_SESSION_ID: "s1" }),
    ).toContain("Paused: no");
  });

  it("login prints the code and verify url from a fake server", async () => {
    const s = await fake({
      "/api/device/start": [{ status: 200, body: START }],
    });
    const started: unknown[][] = [];
    const out = await run(["login", s.url], {}, (...a) => {
      started.push(a);
    });
    expect(out).toBe(
      "Open https://murmur.example/device and enter ABCD-1234. Murmur connects when you approve.",
    );
    expect(s.seen).toEqual([
      { url: "/api/device/start", body: { machineName: os.hostname() } },
    ]);
    expect(started).toEqual([["dev-1", s.url, 3, 600]]);
  });

  it("login says so when the server is down", async () => {
    await expect(run(["login", "http://127.0.0.1:1"], {})).rejects.toThrow(
      "Could not reach http://127.0.0.1:1",
    );
  });

  it("poll writes credentials once approved", async () => {
    const s = await fake({
      "/api/device/poll": [
        { status: 428, body: { status: "pending" } },
        { status: 200, body: { token: "tok", machineId: "m9" } },
      ],
    });
    await poll("dev-1", s.url, 0.01, 5);
    expect(readCredentials()).toEqual({
      server: s.url,
      token: "tok",
      machineId: "m9",
    });
    expect(s.seen.map((x) => x.body)).toEqual([
      { deviceCode: "dev-1" },
      { deviceCode: "dev-1" },
    ]);
  });

  it("poll stops quietly when the code expires", async () => {
    const s = await fake({
      "/api/device/poll": [{ status: 410, body: { status: "expired" } }],
    });
    await poll("dev-1", s.url, 0.01, 5);
    expect(readCredentials()).toBeNull();
    expect(s.seen).toHaveLength(1);
  });

  it("logout clears credentials and deletes the unsent queue", async () => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m" });
    queued(repo, "a");
    expect(await run(["logout"], {})).toBe(
      "Logged out. Unsent events were deleted, and this machine sends nothing more to Murmur.",
    );
    expect(readCredentials()).toBeNull();
    expect(fs.existsSync(queueDir())).toBe(false);
  });

  it("on and off name the folder, and off deletes that project's unsent events", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-other-"));
    fs.mkdirSync(path.join(repo, "src"));
    // Named by its real path, the one Claude Code reports.
    const real = fs.realpathSync(repo);
    expect(await run(["on", path.join(repo, "src")], {})).toBe(
      `Murmur is on for ${real}. Run /murmur:login to connect.`,
    );
    queued(path.join(repo, "src"), "a");
    queued(other, "b");
    expect(await run(["off", repo], {})).toBe(
      `Murmur is off for ${real}. Its unsent events were deleted, and nothing more from it is sent.`,
    );
    expect(queue()).toEqual(["b.json"]);
  });

  it("status says when the server disconnected this machine", async () => {
    writeCredentials({ server: "http://x", token: "t", machineId: "m" });
    setRevoked(true);
    const out = await run(["status", repo], {});
    expect(out).toContain("This machine was disconnected. Run /murmur:login.");
    expect(out).not.toContain("Logged in: yes");
  });
});
