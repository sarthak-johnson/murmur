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
var import_node_fs2 = __toESM(require("node:fs"), 1);
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
  const home = import_node_path.default.resolve(import_node_os.default.homedir());
  for (let d = start; import_node_path.default.dirname(d) !== d; d = import_node_path.default.dirname(d))
    if (d !== home && import_node_fs.default.existsSync(import_node_path.default.join(d, ".git")))
      return worktreeMain(d) ?? d;
  return start;
}
function worktreeMain(root) {
  let text;
  try {
    text = import_node_fs.default.readFileSync(import_node_path.default.join(root, ".git"), "utf8");
  } catch {
    return void 0;
  }
  const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (!gitdir) return void 0;
  const worktrees = import_node_path.default.dirname(import_node_path.default.resolve(root, gitdir));
  const dotGit = import_node_path.default.dirname(worktrees);
  const main2 = import_node_path.default.dirname(dotGit);
  const home = import_node_path.default.resolve(import_node_os.default.homedir());
  if (import_node_path.default.basename(worktrees) !== "worktrees" || import_node_path.default.basename(dotGit) !== ".git" || main2 === home || import_node_path.default.dirname(main2) === main2 || !isDir(dotGit))
    return void 0;
  const real = realpath(main2);
  if (real === realpath(home)) return void 0;
  for (let d = root; import_node_path.default.dirname(d) !== d; d = import_node_path.default.dirname(d))
    if (realpath(d) === real) return d;
  return main2;
}
function isDir(p) {
  try {
    return import_node_fs.default.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function realpath(p) {
  try {
    return import_node_fs.default.realpathSync(p);
  } catch {
    return p;
  }
}
function projectName(cwd) {
  const key = projectKey(cwd);
  const home = import_node_path.default.resolve(import_node_os.default.homedir());
  return key.startsWith(`${home}${import_node_path.default.sep}`) ? `~${key.slice(home.length)}` : key;
}
function readCredentials() {
  const c = readJson("credentials.json", null);
  return c?.server && c.token && c.machineId ? c : null;
}
function writeCredentials(c) {
  writeJson("credentials.json", c, 384);
  setRevoked(false);
}
function clearCredentials() {
  import_node_fs.default.rmSync(import_node_path.default.join(murmurDir(), "credentials.json"), { force: true });
  setRevoked(false);
}
var revokedFile = () => import_node_path.default.join(murmurDir(), "revoked");
function isRevoked() {
  return import_node_fs.default.existsSync(revokedFile());
}
function setRevoked(on) {
  if (!on) {
    import_node_fs.default.rmSync(revokedFile(), { force: true });
    return;
  }
  import_node_fs.default.mkdirSync(murmurDir(), { recursive: true, mode: 448 });
  import_node_fs.default.writeFileSync(revokedFile(), "");
}
var queueDir = () => import_node_path.default.join(murmurDir(), "queue");
function clearQueue() {
  import_node_fs.default.rmSync(queueDir(), { recursive: true, force: true });
}
function dropQueued(cwd) {
  const key = projectKey(cwd);
  let names = [];
  try {
    names = import_node_fs.default.readdirSync(queueDir());
  } catch {
    return;
  }
  for (const name of names) {
    const file = import_node_path.default.join(queueDir(), name);
    try {
      const e = JSON.parse(import_node_fs.default.readFileSync(file, "utf8"));
      if (typeof e?.cwd === "string" && projectKey(e.cwd) === key)
        import_node_fs.default.rmSync(file, { force: true });
    } catch {
    }
  }
}
var projects = () => readJson("projects.json", {});
function projectState(cwd) {
  return projects()[projectKey(cwd)];
}
function sessionProjectState(cwd, sessionId) {
  const here = projectState(cwd);
  const bound = sessionId ? readSession(sessionId).project : void 0;
  return here !== void 0 || !bound ? here : projects()[bound];
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
var sessionFile = (sessionId) => import_node_path.default.join("sessions", `${sessionId.replace(/[^\w-]/g, "_")}.json`);
var NO_NARRATION = {
  mapped: false,
  tasks: [],
  narrates: 0,
  named: [],
  done: [],
  blocked: false
};
function isNewSession(sessionId) {
  if (!import_node_fs.default.existsSync(import_node_path.default.join(murmurDir(), sessionFile(sessionId))))
    return true;
  const s = readJson(
    sessionFile(sessionId),
    null
  );
  return s !== null && s.backfill === void 0;
}
function readSession(sessionId) {
  return {
    ...NO_NARRATION,
    ...readJson(sessionFile(sessionId), {})
  };
}
function writeSession(sessionId, s) {
  writeJson(sessionFile(sessionId), s);
}
function skipText(sessionId, transcriptPath) {
  if (isNewSession(sessionId)) return;
  const s = readSession(sessionId);
  const file = s.transcriptPath ?? (typeof transcriptPath === "string" && transcriptPath ? transcriptPath : void 0);
  if (!file) return;
  let size;
  try {
    size = import_node_fs.default.statSync(file).size;
  } catch {
    return;
  }
  if (s.textOffset !== size) updateSession(sessionId, { textOffset: size });
}
function updateSession(sessionId, patch) {
  writeSession(sessionId, { ...readSession(sessionId), ...patch });
}

// src/cli.ts
var USAGE = "Usage: murmur <login [server] | logout | on | off | pause | resume | status> [folder]";
var spawnPoller = (...args) => {
  (0, import_node_child_process.spawn)(
    process.execPath,
    [
      process.argv[1],
      "--poll",
      ...args.flatMap((a) => a === void 0 ? [] : [String(a)])
    ],
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
async function login(server, startPoller, session) {
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
  startPoller(
    s.deviceCode,
    server,
    s.interval,
    s.expiresIn,
    ...session ? [session] : []
  );
  return `Open ${s.verifyUrl} and enter ${s.userCode}. Murmur connects when you approve.`;
}
async function poll(deviceCode, server, interval, expiresIn, session) {
  const end = Date.now() + expiresIn * 1e3;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, interval * 1e3));
    try {
      const res = await post(`${server}/api/device/poll`, { deviceCode });
      if (res.status === 410) return;
      if (res.status !== 200) continue;
      const b = await res.json();
      if (typeof b.token === "string" && typeof b.machineId === "string") {
        if (session) skipText(session);
        writeCredentials({ server, token: b.token, machineId: b.machineId });
        return;
      }
    } catch {
    }
  }
}
function status(cwd, session) {
  const c = readCredentials();
  const state = sessionProjectState(cwd, session);
  const bound = session ? readSession(session).project : void 0;
  const follows = bound && projectState(cwd) === void 0 && bound !== projectKey(cwd) ? ` (this session follows ${projectName(bound)})` : "";
  return [
    c && isRevoked() ? "This machine was disconnected. Run /murmur:login." : `Logged in: ${c ? "yes" : "no"}`,
    `Server: ${c?.server ?? DEFAULT_SERVER}`,
    `This project: ${state === "on" || state === "off" ? state : "not set"}${follows}`,
    `Paused: ${isPaused(cwd, session) ? "yes" : "no"}`
  ].join("\n");
}
async function run(args, env, startPoller = spawnPoller) {
  const [cmd, arg] = args;
  const cwd = realpath2(arg || process.cwd());
  const session = env.CLAUDE_CODE_SESSION_ID || void 0;
  const scope = session ? "session" : "folder";
  if (session && (cmd === "login" || cmd === "on" || cmd === "resume"))
    skipText(session);
  switch (cmd) {
    case "login":
      return login(
        (arg || DEFAULT_SERVER).replace(/\/+$/, ""),
        startPoller,
        session
      );
    case "logout":
      clearCredentials();
      clearQueue();
      return "Logged out. Unsent events were deleted, and this machine sends nothing more to Murmur.";
    case "on":
      setProjectState(cwd, "on");
      if (session && !arg) updateSession(session, { project: projectKey(cwd) });
      return readCredentials() ? `Murmur is on for ${projectName(cwd)}.` : `Murmur is on for ${projectName(cwd)}. Run /murmur:login to connect.`;
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
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--poll") {
    const [, code = "", server = "", interval, expiresIn, session] = args;
    await poll(code, server, Number(interval), Number(expiresIn), session);
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
function realpath2(p) {
  try {
    return import_node_fs2.default.realpathSync(p);
  } catch {
    return p;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  poll,
  run
});
