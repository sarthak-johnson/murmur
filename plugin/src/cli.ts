import { spawn } from "node:child_process";
import os from "node:os";
import {
  clearCredentials,
  clearProjectPause,
  clearQueue,
  DEFAULT_SERVER,
  dropQueued,
  isPaused,
  isRevoked,
  projectKey,
  projectName,
  projectState,
  readCredentials,
  setPaused,
  setProjectState,
  updateSession,
  writeCredentials,
} from "./local.js";

type StartPoller = (
  deviceCode: string,
  server: string,
  interval: number,
  expiresIn: number,
) => void;

type Obj = Record<string, unknown>;

const USAGE =
  "Usage: murmur <login [server] | logout | on | off | pause | resume | status> [folder]";

// The poller is this same bundle re-run with --poll, outliving the command.
const spawnPoller: StartPoller = (...args) => {
  spawn(
    process.execPath,
    [process.argv[1] as string, "--poll", ...args.map(String)],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref();
};

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

async function login(server: string, startPoller: StartPoller) {
  let res: Response;
  try {
    res = await post(`${server}/api/device/start`, {
      machineName: os.hostname(),
    });
  } catch {
    throw new Error(
      `Could not reach ${server}. Check the address and your connection.`,
    );
  }
  const s = (await res.json().catch(() => null)) as Obj | null;
  if (
    !res.ok ||
    typeof s?.deviceCode !== "string" ||
    typeof s.userCode !== "string" ||
    typeof s.verifyUrl !== "string" ||
    !positive(s.interval) ||
    !positive(s.expiresIn)
  )
    throw new Error(`${server} did not start a login (HTTP ${res.status}).`);
  startPoller(s.deviceCode, server, s.interval, s.expiresIn);
  return `Open ${s.verifyUrl} and enter ${s.userCode}. Murmur connects when you approve.`;
}

// Asks every `interval` seconds until approved (writes credentials), expired or out of time.
export async function poll(
  deviceCode: string,
  server: string,
  interval: number,
  expiresIn: number,
): Promise<void> {
  const end = Date.now() + expiresIn * 1000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    try {
      const res = await post(`${server}/api/device/poll`, { deviceCode });
      if (res.status === 410) return;
      if (res.status !== 200) continue;
      const b = (await res.json()) as Obj;
      if (typeof b.token === "string" && typeof b.machineId === "string") {
        writeCredentials({ server, token: b.token, machineId: b.machineId });
        return;
      }
    } catch {
      // Offline for a moment: try again next round.
    }
  }
}

function status(cwd: string, session: string | undefined): string {
  const c = readCredentials();
  const state = projectState(cwd);
  return [
    c && isRevoked()
      ? "This machine was disconnected. Run /murmur:login."
      : `Logged in: ${c ? "yes" : "no"}`,
    `Server: ${c?.server ?? DEFAULT_SERVER}`,
    `This project: ${state === "on" || state === "off" ? state : "not set"}`,
    `Paused: ${isPaused(cwd, session) ? "yes" : "no"}`,
  ].join("\n");
}

export async function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  startPoller: StartPoller = spawnPoller,
): Promise<string> {
  const [cmd, arg] = args;
  const cwd = arg || process.cwd();
  const session = env.CLAUDE_CODE_SESSION_ID || undefined;
  const scope = session ? "session" : "folder";
  switch (cmd) {
    case "login":
      return login((arg || DEFAULT_SERVER).replace(/\/+$/, ""), startPoller);
    case "logout":
      clearCredentials();
      clearQueue();
      return "Logged out. Unsent events were deleted, and this machine sends nothing more to Murmur.";
    case "on":
      setProjectState(cwd, "on");
      if (session) updateSession(session, { project: projectKey(cwd) });
      return readCredentials()
        ? `Murmur is on for ${projectName(cwd)}.`
        : `Murmur is on for ${projectName(cwd)}. Run /murmur:login to connect.`;
    case "off":
      setProjectState(cwd, "off");
      dropQueued(cwd);
      return `Murmur is off for ${projectName(cwd)}. Its unsent events were deleted, and nothing more from it is sent.`;
    case "pause":
      setPaused(cwd, true, session);
      return `Murmur is paused for this ${scope}.`;
    case "resume":
      setPaused(cwd, false, session);
      clearProjectPause(cwd);
      return `Murmur is showing this ${scope} again.`;
    case "status":
      return status(cwd, session);
    default:
      throw new Error(USAGE);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--poll") {
    const [, code = "", server = "", interval, expiresIn] = args;
    await poll(code, server, Number(interval), Number(expiresIn));
    return;
  }
  try {
    console.log(await run(args, process.env));
  } catch (e) {
    console.log((e as Error).message);
    process.exitCode = 1;
  }
}

if (/[\\/]cli\.(c?js|ts)$/.test(process.argv[1] ?? "")) void main();
