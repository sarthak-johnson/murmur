"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  poll: () => poll,
  run: () => run
});
module.exports = __toCommonJS(cli_exports);
var import_node_child_process = require("node:child_process");
var import_node_os2 = __toESM(require("node:os"), 1);

// src/local.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var DEFAULT_SERVER = process.env.MURMUR_SERVER ?? "http://localhost:8787";
function murmurDir() {
  if (process.env.MURMUR_HOME) return process.env.MURMUR_HOME;
  const base = process.env.XDG_CONFIG_HOME || import_node_path.default.join(import_node_os.default.homedir(), ".config");
  return import_node_path.default.join(base, "murmur");
}
function readJson(name, fallback) {
  try {
    const v = JSON.parse(
      import_node_fs.default.readFileSync(import_node_path.default.join(murmurDir(), name), "utf8")
    );
    return v !== null && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(name, value, mode = 420) {
  const file = import_node_path.default.join(murmurDir(), name);
  const dir = import_node_path.default.dirname(file);
  import_node_fs.default.mkdirSync(dir, { recursive: true, mode: 448 });
  const tmp = import_node_path.default.join(
    dir,
    `.${import_node_path.default.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  );
  import_node_fs.default.writeFileSync(tmp, JSON.stringify(value), { mode });
  import_node_fs.default.renameSync(tmp, file);
}
function projectKey(cwd) {
  const start = import_node_path.default.resolve(cwd);
  for (let d = start; ; d = import_node_path.default.dirname(d)) {
    if (import_node_fs.default.existsSync(import_node_path.default.join(d, ".git"))) return d;
    if (import_node_path.default.dirname(d) === d) return start;
  }
}
function readCredentials() {
  const c = readJson("credentials.json", null);
  return c?.server && c.token && c.machineId ? c : null;
}
function writeCredentials(c) {
  writeJson("credentials.json", c, 384);
}
function clearCredentials() {
  import_node_fs.default.rmSync(import_node_path.default.join(murmurDir(), "credentials.json"), { force: true });
}
function projectState(cwd) {
  return readJson("projects.json", {})[projectKey(cwd)];
}
function setProjectState(cwd, s) {
  const all = readJson("projects.json", {});
  all[projectKey(cwd)] = s;
  writeJson("projects.json", all);
}
function readPaused() {
  const p = readJson("paused.json", {});
  return {
    sessions: Array.isArray(p.sessions) ? p.sessions : [],
    projects: Array.isArray(p.projects) ? p.projects : []
  };
}
function isPaused(cwd, sessionId) {
  const p = readPaused();
  return p.projects.includes(projectKey(cwd)) || !!sessionId && p.sessions.includes(sessionId);
}
function setPaused(cwd, paused, sessionId) {
  const p = readPaused();
  const list = sessionId ? p.sessions : p.projects;
  const key = sessionId ?? projectKey(cwd);
  const next = list.filter((k) => k !== key);
  if (paused) next.push(key);
  if (sessionId) p.sessions = next;
  else p.projects = next;
  writeJson("paused.json", p);
}
function clearProjectPause(cwd) {
  setPaused(cwd, false);
}

// src/cli.ts
var USAGE = "Usage: murmur <login [server] | logout | on | off | pause | resume | status> [folder]";
var spawnPoller = (...args) => {
  (0, import_node_child_process.spawn)(
    process.execPath,
    [process.argv[1], "--poll", ...args.map(String)],
    { detached: true, stdio: "ignore", windowsHide: true }
  ).unref();
};
var post = (url, body) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(1e4)
});
var positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
async function login(server, startPoller) {
  let res;
  try {
    res = await post(`${server}/api/device/start`, {
      machineName: import_node_os2.default.hostname()
    });
  } catch {
    throw new Error(
      `Could not reach ${server}. Check the address and your connection.`
    );
  }
  const s = await res.json().catch(() => null);
  if (!res.ok || typeof s?.deviceCode !== "string" || typeof s.userCode !== "string" || typeof s.verifyUrl !== "string" || !positive(s.interval) || !positive(s.expiresIn))
    throw new Error(`${server} did not start a login (HTTP ${res.status}).`);
  startPoller(s.deviceCode, server, s.interval, s.expiresIn);
  return `Open ${s.verifyUrl} and enter ${s.userCode}. Murmur connects when you approve.`;
}
async function poll(deviceCode, server, interval, expiresIn) {
  const end = Date.now() + expiresIn * 1e3;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, interval * 1e3));
    try {
      const res = await post(`${server}/api/device/poll`, { deviceCode });
      if (res.status === 410) return;
      if (res.status !== 200) continue;
      const b = await res.json();
      if (typeof b.token === "string" && typeof b.machineId === "string") {
        writeCredentials({ server, token: b.token, machineId: b.machineId });
        return;
      }
    } catch {
    }
  }
}
function status(cwd, session) {
  const c = readCredentials();
  const state = projectState(cwd);
  return [
    `Logged in: ${c ? "yes" : "no"}`,
    `Server: ${c?.server ?? DEFAULT_SERVER}`,
    `This project: ${state === "on" || state === "off" ? state : "not set"}`,
    `Paused: ${isPaused(cwd, session) ? "yes" : "no"}`
  ].join("\n");
}
async function run(args, env, startPoller = spawnPoller) {
  const [cmd, arg] = args;
  const cwd = arg || process.cwd();
  const session = env.CLAUDE_CODE_SESSION_ID || void 0;
  const scope = session ? "session" : "folder";
  switch (cmd) {
    case "login":
      return login((arg || DEFAULT_SERVER).replace(/\/+$/, ""), startPoller);
    case "logout":
      clearCredentials();
      return "Logged out. This machine no longer sends anything to Murmur.";
    case "on":
      setProjectState(cwd, "on");
      return readCredentials() ? "Murmur is on for this project." : "Murmur is on for this project. Run /murmur:login to connect.";
    case "off":
      setProjectState(cwd, "off");
      return "Murmur is off for this project. Nothing from it is sent.";
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
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--poll") {
    const [, code = "", server = "", interval, expiresIn] = args;
    await poll(code, server, Number(interval), Number(expiresIn));
    return;
  }
  try {
    console.log(await run(args, process.env));
  } catch (e) {
    console.log(e.message);
    process.exitCode = 1;
  }
}
if (/[\\/]cli\.(c?js|ts)$/.test(process.argv[1] ?? "")) void main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  poll,
  run
});
