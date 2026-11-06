// Appends one JSON line per hook call to $CAPTURE_OUT. Dev tool for recording fixtures.
import { appendFileSync, readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(0, "utf8"));
const env = process.env;

if (env.CAPTURE_OUT) {
  const line = {
    hook: payload.hook_event_name,
    // null, not undefined, so an unset variable stays visible in the fixture.
    env: {
      CLAUDE_CODE_ENTRYPOINT: env.CLAUDE_CODE_ENTRYPOINT ?? null,
      CLAUDE_SESSION_ID: env.CLAUDE_SESSION_ID ?? null,
      CLAUDE_PROJECT_DIR: env.CLAUDE_PROJECT_DIR ?? null,
    },
    // Every Claude variable a hook sees, minus anything that could hold a secret.
    extraEnv: Object.fromEntries(
      Object.entries(env)
        .filter(([k]) => /^(CLAUDE|AI_AGENT)/.test(k))
        .filter(([k]) => !/TOKEN|SOCKET|KEY|SECRET|AUTH/.test(k))
        .sort(),
    ),
    payload,
  };
  appendFileSync(env.CAPTURE_OUT, `${JSON.stringify(line)}\n`);
}

if (payload.hook_event_name === "SessionStart") {
  process.stdout.write(JSON.stringify({ systemMessage: "capture: hello" }));
}
