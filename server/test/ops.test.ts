import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const script = fileURLToPath(new URL("../ops/install-mac.sh", import.meta.url));
const serverDir = fileURLToPath(new URL("..", import.meta.url)).replace(
  /\/$/,
  "",
);
const hasPlutil = spawnSync("which", ["plutil"]).status === 0;

/** Runs the installer's dry run with a fresh HOME and stubs that record any real command. */
function dryRun(setup?: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "murmur-home-"));
  const bin = mkdtempSync(join(tmpdir(), "murmur-bin-"));
  const ran = join(bin, "ran");
  for (const cmd of ["pnpm", "launchctl", "lsof", "curl"]) {
    writeFileSync(join(bin, cmd), `#!/bin/sh\necho ${cmd} >> "${ran}"\n`);
    chmodSync(join(bin, cmd), 0o755);
  }
  setup?.(home);
  const before = readdirSync(home, { recursive: true }).sort();
  const res = spawnSync("bash", [script, "--dry-run"], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  const after = readdirSync(home, { recursive: true }).sort();
  /** The "    | " lines of one step. */
  const block = (step: string) =>
    (res.stdout.split(/^==> /m).find((s) => s.startsWith(step)) ?? "")
      .split("\n")
      .filter((l) => l.startsWith("    | "))
      .map((l) => l.slice(6))
      .join("\n");
  return {
    home,
    res,
    wroteNothing: JSON.stringify(before) === JSON.stringify(after),
    ranNothing: !existsSync(ran),
    env: block("2/5"),
    plist: block("4/5"),
  };
}

describe("install-mac.sh --dry-run", () => {
  test("prints the env template and the plist, and writes or runs nothing", () => {
    const d = dryRun();
    expect(d.res.stderr).toBe("");
    expect(d.res.status).toBe(0);
    expect(d.wroteNothing).toBe(true);
    expect(d.ranNothing).toBe(true);

    const data = join(d.home, ".murmur-server");
    const keys = Object.fromEntries(
      d.env
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.split(/=(.*)/s).slice(0, 2)),
    );
    expect(keys).toEqual({
      NODE_ENV: "production",
      BASE_URL: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      MURMUR_DATA_DIR: join(data, "data"),
      MURMUR_ALLOWED_LOGINS: "",
      TRUST_PROXY: "1",
      PORT: "8787",
    });

    expect(d.plist).toContain("<string>in.murmur.server</string>");
    expect(d.plist).toContain(`<string>--env-file=${data}/env</string>`);
    expect(d.plist).toMatch(
      /<string>\/[^<]*node<\/string>\s*<string>--env-file=[^<]*<\/string>\s*<string>--import<\/string>\s*<string>tsx<\/string>\s*<string>src\/index.ts<\/string>/,
    );
    expect(d.plist).toContain(`<string>${serverDir}</string>`);
    expect(d.plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(d.plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(d.plist).toMatch(
      new RegExp(
        `<key>StandardOutPath</key>\\s*<string>${data}/server.log</string>`,
      ),
    );
    expect(d.plist).toMatch(
      new RegExp(
        `<key>StandardErrorPath</key>\\s*<string>${data}/server.log</string>`,
      ),
    );
  });

  test.skipIf(!hasPlutil)("the plist is one launchd accepts", () => {
    const d = dryRun();
    const file = join(d.home, "murmur.plist");
    writeFileSync(file, d.plist);
    const parsed = JSON.parse(
      execFileSync("plutil", ["-convert", "json", "-o", "-", file], {
        encoding: "utf8",
      }),
    );
    expect(parsed).toMatchObject({
      Label: "in.murmur.server",
      WorkingDirectory: serverDir,
      RunAtLoad: true,
      KeepAlive: true,
    });
    expect(parsed.ProgramArguments.slice(1)).toEqual([
      `--env-file=${d.home}/.murmur-server/env`,
      "--import",
      "tsx",
      "src/index.ts",
    ]);
  });

  test("keeps an existing env file", () => {
    const d = dryRun((home) => {
      mkdirSync(join(home, ".murmur-server"));
      writeFileSync(join(home, ".murmur-server", "env"), "PORT=9001\n");
    });
    expect(d.res.status).toBe(0);
    expect(d.res.stdout).toContain("Kept: it already exists.");
    expect(d.env).toBe("");
    expect(d.wroteNothing).toBe(true);
  });
});
