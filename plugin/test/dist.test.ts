// Runs the committed bundles the way Claude Code does. CI rebuilds them first.
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBackfill } from "../src/backfill.js";
import { MID_SESSION_LINE } from "../src/instruction.js";
import { NARRATION_INSTRUCTION } from "../src/local.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let home: string;
let repo: string;
let env: NodeJS.ProcessEnv;
let servers: http.Server[] = [];
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-dist-"));
  repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  env = {
    PATH: process.env.PATH,
    MURMUR_HOME: path.join(home, "murmur"),
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SESSION_ATTENDED: "1",
  };
});
afterEach(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
  servers = [];
});

async function listen(handler: http.RequestListener): Promise<string> {
  const s = http.createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
// Async, so fake servers in this process can answer while it runs.
const murmur = (...args: string[]) =>
  new Promise<{ code: number; stdout: string }>((ok) => {
    execFile(path.join(root, "bin/murmur"), args, { env }, (err, stdout) =>
      ok({ code: err ? Number(err.code) : 0, stdout }),
    );
  });

const hooks = JSON.parse(
  fs.readFileSync(path.join(root, "hooks/hooks.json"), "utf8"),
).hooks as Record<string, { hooks: { command: string }[] }[]>;
const mcpServer = JSON.parse(
  fs.readFileSync(path.join(root, ".mcp.json"), "utf8"),
).mcpServers.murmur as { command: string; args: string[] };
// Claude Code's own placeholder, written as hooks.json and .mcp.json spell it.
const ROOT = `$${"{CLAUDE_PLUGIN_ROOT}"}`;
const withRoot = (s: string) => s.replaceAll(ROOT, root);
// Runs a hook the way Claude Code does: its hooks.json command through sh.
const runHook = (name: string, input: unknown, extra = {}) =>
  spawnSync("/bin/sh", ["-c", hooks[name]?.[0]?.hooks[0]?.command ?? ""], {
    env: { ...env, CLAUDE_PLUGIN_ROOT: root, ...extra },
    encoding: "utf8",
    input: JSON.stringify(input),
  });

describe("built plugin", () => {
  it("Stop answers fast while the server hangs, its upload runs detached", async () => {
    const hung = await listen(() => {});
    fs.mkdirSync(env.MURMUR_HOME as string, { recursive: true });
    fs.writeFileSync(
      path.join(env.MURMUR_HOME as string, "credentials.json"),
      JSON.stringify({ server: hung, token: "t", machineId: "m1" }),
    );
    expect((await murmur("on", repo)).code).toBe(0);
    const t0 = Date.now();
    const r = runHook("Stop", {
      hook_event_name: "Stop",
      session_id: "s1",
      cwd: repo,
    });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.status).toBe(0);
  });

  it("every hook and the MCP server start through the sh shim", () => {
    for (const list of Object.values(hooks))
      for (const h of list[0]?.hooks ?? [])
        expect(h.command).toBe(
          `sh "${ROOT}/hooks/node.sh" "${ROOT}/dist/hook.cjs"`,
        );
    expect(mcpServer).toEqual({
      command: "sh",
      args: [`${ROOT}/hooks/node.sh`, `${ROOT}/dist/mcp.cjs`],
    });
  });

  it("without node, SessionStart says so and every hook exits 0", () => {
    // A PATH with sh and nothing else, so no node.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-nonode-"));
    fs.symlinkSync("/bin/sh", path.join(empty, "sh"));
    const start = runHook(
      "SessionStart",
      { hook_event_name: "SessionStart", source: "startup", cwd: repo },
      { PATH: empty },
    );
    expect(start.status).toBe(0);
    expect(JSON.parse(start.stdout)).toEqual({
      systemMessage: "Murmur needs Node.js 22 or newer on PATH.",
    });
    const stop = runHook(
      "Stop",
      { hook_event_name: "Stop", cwd: repo },
      { PATH: empty },
    );
    expect(stop.status).toBe(0);
    expect(stop.stdout).toBe("");
  });

  it("hook.cjs answers SessionStart fast while the server hangs", async () => {
    const hung = await listen(() => {});
    fs.mkdirSync(env.MURMUR_HOME as string, { recursive: true });
    fs.writeFileSync(
      path.join(env.MURMUR_HOME as string, "credentials.json"),
      JSON.stringify({ server: hung, token: "t", machineId: "m1" }),
    );
    expect((await murmur("on", repo)).code).toBe(0);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(root, "dist/hook.cjs")], {
      env,
      encoding: "utf8",
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        source: "startup",
        session_id: "s1",
        cwd: repo,
      }),
    });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: NARRATION_INSTRUCTION,
      },
    });
  });

  it("UserPromptSubmit answers fast with the instruction while the server hangs", async () => {
    const hung = await listen(() => {});
    fs.mkdirSync(env.MURMUR_HOME as string, { recursive: true });
    fs.writeFileSync(
      path.join(env.MURMUR_HOME as string, "credentials.json"),
      JSON.stringify({ server: hung, token: "t", machineId: "m1" }),
    );
    expect((await murmur("on", repo)).code).toBe(0);
    const transcript = path.join(home, "s1.jsonl");
    fs.writeFileSync(transcript, "");
    // Seen before, so no backfill child is left running against the hung server.
    fs.mkdirSync(path.join(env.MURMUR_HOME as string, "sessions"));
    fs.writeFileSync(
      path.join(env.MURMUR_HOME as string, "sessions", "s1.json"),
      JSON.stringify({ backfill: "done" }),
    );
    const t0 = Date.now();
    const r = runHook("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      transcript_path: transcript,
      cwd: repo,
      prompt: "hi",
    });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `${MID_SESSION_LINE}\n${NARRATION_INSTRUCTION}`,
      },
    });
  });

  it("hook.cjs --backfill uploads the pending history and marks it done", async () => {
    const posted: string[] = [];
    const server = await listen((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        posted.push(
          ...JSON.parse(body).events.map((e: { id: string }) => e.id),
        );
        res.setHeader("Content-Type", "application/json");
        res.end("{}");
      });
    });
    const sid = "11111111-2222-4333-8444-555555555555";
    const fixture = path.join(root, "test/fixtures/backfill", `${sid}.jsonl`);
    const dir = env.MURMUR_HOME as string;
    fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "credentials.json"),
      JSON.stringify({ server, token: "t", machineId: "m1" }),
    );
    fs.writeFileSync(
      path.join(dir, "projects.json"),
      JSON.stringify({ "/work/demo": "on" }),
    );
    const state = path.join(dir, "sessions", `${sid}.json`);
    const cutoff = "2026-11-07T09:00:15.000Z";
    fs.writeFileSync(
      state,
      JSON.stringify({
        backfill: "pending",
        cutoff,
        transcriptPath: fixture,
        cwd: "/work/demo",
      }),
    );
    const code = await new Promise<number>((ok) =>
      execFile(
        process.execPath,
        [path.join(root, "dist/hook.cjs"), "--backfill", sid],
        { env },
        (err) => ok(err ? Number(err.code) : 0),
      ),
    );
    expect(code).toBe(0);
    const want = readBackfill({
      sessionId: sid,
      machineId: "m1",
      cwd: "/work/demo",
      transcriptPath: fixture,
      cutoff,
    }).map((e) => e.id);
    expect(want.length).toBeGreaterThan(5);
    expect(posted).toEqual(want);
    expect(JSON.parse(fs.readFileSync(state, "utf8")).backfill).toBe("done");
  });

  it("bin/murmur login leaves a poller that stores the token", async () => {
    let polls = 0;
    const server = await listen((req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/device/start") {
          res.end(
            JSON.stringify({
              deviceCode: "d1",
              userCode: "WXYZ-0000",
              verifyUrl: "https://v.example",
              interval: 0.05,
              expiresIn: 10,
            }),
          );
        } else if (++polls < 2) {
          res.statusCode = 428;
          res.end('{"status":"pending"}');
        } else {
          res.end('{"token":"tok","machineId":"m2"}');
        }
      });
    });
    const r = await murmur("login", server);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(
      "Open https://v.example and enter WXYZ-0000. Murmur connects when you approve.",
    );
    const file = path.join(env.MURMUR_HOME as string, "credentials.json");
    for (let i = 0; i < 100 && !fs.existsSync(file); i++)
      await new Promise((ok) => setTimeout(ok, 50));
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      server,
      token: "tok",
      machineId: "m2",
    });
    expect((await murmur("status", repo)).stdout).toContain("Logged in: yes");
  });

  it("mcp.cjs lists map and narrate over stdio", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: mcpServer.command,
        args: mcpServer.args.map(withRoot),
      }),
    );
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((t) => t.name).sort()).toEqual(["map", "narrate"]);
  });
});
