// Real Claude Code, plugin, server and web page, end to end. Costs money: see README.md.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type MurmurEvent,
  NARRATE_TOOL,
  reduce,
  type SessionView,
} from "@murmur/core";
import { chromium } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SCREENS = path.join(import.meta.dirname, "screens");
const MURMUR = path.join(ROOT, "plugin/bin/murmur");
const FAKE_KEY = `sk-ant-api03-${"x".repeat(40)}`;
const PROMPT =
  "Add a function add(a, b) in math.js with a test using node's built-in test runner, then run the test with node --test";
const TOOLS = [
  "Bash(node --test*)",
  "Bash(npm test*)",
  "Read",
  "Write",
  "Edit",
  "mcp__plugin_murmur_murmur__map",
  "mcp__plugin_murmur_murmur__narrate",
].join(" ");

// Nothing from the Claude Code session running this suite leaks into the children.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(CLAUDE|AI_AGENT|MURMUR)/.test(k),
  ),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) =>
  fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `murmur-e2e-${name}-`)),
  );

async function freePort(): Promise<number> {
  const s = net.createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

let server: ChildProcess | undefined;
let base = "";
let cookie = "";
let home = "";
let repo = "";
let view: SessionView | undefined;

const api = async (p: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}${p}`, {
    ...init,
    headers: {
      cookie,
      origin: base,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
};

beforeAll(async () => {
  fs.mkdirSync(SCREENS, { recursive: true });
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = spawn(
    path.join(ROOT, "server/node_modules/.bin/tsx"),
    ["src/index.ts"],
    {
      cwd: path.join(ROOT, "server"),
      env: {
        ...cleanEnv,
        PORT: String(port),
        BASE_URL: base,
        DATABASE_URL: "memory://",
        MURMUR_DEV_LOGIN: "1",
        WEB_DIST: path.join(ROOT, "web/dist"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("server did not start")),
      60_000,
    );
    server?.once("exit", (c) => reject(new Error(`server exited ${c}`)));
    server?.stdout?.on("data", (d: Buffer) => {
      if (String(d).includes("murmur listening")) {
        clearTimeout(t);
        resolve();
      }
    });
  });

  const login = await fetch(`${base}/auth/dev?login=e2e`, {
    redirect: "manual",
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  expect(cookie).toMatch(/^murmur_session=./);
});

afterAll(async () => {
  // The login poller is detached; its argv names this server's port.
  if (base)
    await run("pkill", ["-f", `cli.cjs --poll .* ${base}`]).catch(() => {});
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server?.once("exit", r));
    server.kill("SIGTERM");
    const kill = setTimeout(() => server?.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(kill);
  }
  for (const d of [home, repo])
    if (d) fs.rmSync(d, { recursive: true, force: true });
  // Claude Code keeps the run's transcripts under the repo path with every
  // non-alphanumeric turned into "-"; remove only that one folder.
  if (repo)
    fs.rmSync(
      path.join(
        os.homedir(),
        ".claude/projects",
        repo.replace(/[^A-Za-z0-9]/g, "-"),
      ),
      { recursive: true, force: true },
    );
});

it("shows a real Claude Code session", async () => {
  home = tmp("home");
  repo = tmp("repo");
  const env = { ...cleanEnv, MURMUR_HOME: home, MURMUR_SERVER: base };

  // Device flow through the real CLI, approved as the dev-login user.
  const { stdout } = await run(MURMUR, ["login", base], { env });
  const userCode = /enter (\S+)\. Murmur connects/.exec(stdout)?.[1];
  expect(userCode, stdout).toBeTruthy();
  await api("/api/device/approve", {
    method: "POST",
    body: JSON.stringify({ userCode }),
  });
  const creds = path.join(home, "credentials.json");
  for (let i = 0; i < 30 && !fs.existsSync(creds); i++) await sleep(500);
  expect(fs.existsSync(creds), "poller wrote credentials").toBe(true);

  // A fresh repo with a fake key the scrubber must keep off the server.
  await run("git", ["init", "-q"], { cwd: repo });
  fs.writeFileSync(path.join(repo, ".env"), `ANTHROPIC_API_KEY=${FAKE_KEY}\n`);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    `${JSON.stringify({ name: "e2e-repo", private: true, scripts: { test: "node --test" } }, null, 2)}\n`,
  );
  await run(MURMUR, ["on", repo], { env });

  const claude = await run(
    "claude",
    [
      "-p",
      PROMPT,
      "--plugin-dir",
      path.join(ROOT, "plugin"),
      // Only Murmur: the developer's own plugins and hooks stay out of the run.
      "--setting-sources",
      "project,local",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      TOOLS,
      "--max-budget-usd",
      "1",
      "--model",
      "sonnet",
      "--output-format",
      "json",
    ],
    {
      cwd: repo,
      env: { ...env, MURMUR_ALLOW_HEADLESS: "1" },
      timeout: 480_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  fs.writeFileSync(path.join(SCREENS, "claude-result.json"), claude.stdout);
  // A verbose setting turns the json output into every message; the result is last.
  const out: unknown = JSON.parse(claude.stdout);
  const result = (Array.isArray(out) ? out.at(-1) : out) as Record<
    string,
    unknown
  >;
  console.log(
    `claude: ${result.subtype}, cost $${result.total_cost_usd}, turns ${result.num_turns}`,
  );

  const { sessions } = (await api("/api/sessions")) as {
    sessions: { sessionId: string }[];
  };
  expect(sessions).toHaveLength(1);
  const sid = sessions[0]?.sessionId as string;

  // Async hooks (Stop, SessionEnd) may still be uploading: wait for the count to settle.
  let events: MurmurEvent[] = [];
  for (let stable = 0, i = 0; stable < 3 && i < 40; i++) {
    await sleep(1000);
    const next = (await api(`/api/sessions/${sid}/events`))
      .events as MurmurEvent[];
    stable = next.length === events.length ? stable + 1 : 0;
    events = next;
  }
  fs.writeFileSync(
    path.join(SCREENS, "events.json"),
    JSON.stringify(events, null, 2),
  );
  const transcript = events.find(
    (e) => typeof e.payload.transcript_path === "string",
  )?.payload.transcript_path as string | undefined;
  if (transcript && fs.existsSync(transcript))
    fs.copyFileSync(transcript, path.join(SCREENS, "transcript.jsonl"));

  view = reduce(events);
  const leaks = events.filter((e) =>
    JSON.stringify(e.payload).includes("sk-ant-api03-xxxx"),
  );
  expect(leaks.map((e) => e.hook)).toEqual([]);
  expect(view.requests).toHaveLength(1);
  const req = view.requests[0];
  expect(req?.planInferred, "model called map").toBe(false);
  expect(req?.parts.length).toBeGreaterThan(0);
  expect(req?.now).toBeTruthy();
  // Stop is synchronous now, so it reaches the server even in a headless run.
  const stops = events.filter((e) => e.hook === "Stop");
  expect(stops.length).toBeGreaterThan(0);
  const narrates = events.filter(
    (e) => e.hook === "PostToolUse" && e.payload.tool_name === NARRATE_TOOL,
  );
  console.log(
    `narrate calls: ${narrates.length}, before the first Stop: ${narrates.filter((e) => e.ts < (stops[0]?.ts ?? "")).length}, Stop events: ${stops.length}, now: ${JSON.stringify(req?.now)}`,
  );
  expect(narrates.length, "narrate called at least once").toBeGreaterThan(0);
  // Every task the map declared ends done, which only narrate can say.
  const tasks = req?.phases.flatMap((p) => p.tasks) ?? [];
  expect(tasks.length).toBeGreaterThan(0);
  expect(
    tasks.filter((t) => t.status !== "done").map((t) => [t.id, t.status]),
    "tasks not narrated done",
  ).toEqual([]);
  const files = [
    ...(req?.parts.flatMap((p) => p.files) ?? []),
    ...(req?.looseFiles ?? []),
  ];
  const math = files.filter((f) => f.path.endsWith("math.js"));
  expect(
    math.some((f) => f.added > 0),
    JSON.stringify(files),
  ).toBe(true);
});

it("captures the live page and the first part's drill-down", async () => {
  const req = view?.requests[0];
  const part = req?.parts[0];
  expect(req && part, "a request with a part to show").toBeTruthy();
  if (!view || !req || !part) return;
  const browser = await chromium.launch();
  try {
    const shoot = async (
      url: string,
      ready: string,
      file: string,
      viewport = { width: 1440, height: 900 },
    ) => {
      const ctx = await browser.newContext({ viewport, colorScheme: "dark" });
      const eq = cookie.indexOf("=");
      await ctx.addCookies([
        { name: cookie.slice(0, eq), value: cookie.slice(eq + 1), url: base },
      ]);
      const page = await ctx.newPage();
      await page.goto(`${base}${url}`);
      await page.locator(ready).first().waitFor();
      await page.locator(".skeleton").waitFor({ state: "detached" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800); // fade-ins are 200 ms
      await page.screenshot({ path: path.join(SCREENS, file), fullPage: true });
      // The page itself never scrolls sideways.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width);
      await ctx.close();
    };
    const live = `/s/${view.sessionId}`;
    // The office, its panel on the newest request's story.
    await shoot(`${live}?open=story`, ".live-title", "live-1440.png");
    await shoot(`${live}?open=story`, ".live-title", "live-375.png", {
      width: 375,
      height: 812,
    });
    await shoot(
      `${live}/r/${encodeURIComponent(req.id)}/p/${encodeURIComponent(part.id)}`,
      ".pd-title",
      "part-1440.png",
    );
  } finally {
    await browser.close();
  }
});
