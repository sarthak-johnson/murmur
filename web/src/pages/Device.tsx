import { useEffect, useState } from "react";
import { ApiError, api } from "../api";

type State = "idle" | "busy" | "done" | "not_found" | "rate_limited" | "error";

const ERRORS: Record<string, string> = {
  not_found: "That code is not valid or has expired. Run /murmur:login again.",
  rate_limited: "Too many tries. Wait a few minutes and try again.",
  error: "Something went wrong. Try again.",
};

const failed = (e: unknown): State => {
  const c = e instanceof ApiError ? e.code : "error";
  return c === "not_found" || c === "rate_limited" ? c : "error";
};

export function Device({ code }: { code: string }) {
  const [state, setState] = useState<State>("idle");
  const [machine, setMachine] = useState<string | null>(null);

  // Names the machine asking to connect; a dead code says so before any click.
  useEffect(() => {
    if (!code) return;
    let live = true;
    api.deviceInfo(code).then(
      (r) => live && setMachine(r.machineName),
      (e) => {
        const s = failed(e);
        if (live && s !== "error") setState(s);
      },
    );
    return () => {
      live = false;
    };
  }, [code]);

  async function approve() {
    setState("busy");
    try {
      await api.approveDevice(code);
      setState("done");
    } catch (e) {
      setState(failed(e));
    }
  }

  if (state === "done") {
    return (
      <main className="center">
        <h1>Connected. You can close this tab.</h1>
      </main>
    );
  }
  return (
    <main className="center">
      <h1>{machine ? `Connect ${machine}?` : "Connect this machine?"}</h1>
      <p className="code">{code}</p>
      <p className="muted">
        Only approve if you just ran /murmur:login on this machine.
      </p>
      {ERRORS[state] && (
        <p className="error" role="alert">
          {ERRORS[state]}
        </p>
      )}
      <button
        type="button"
        className="primary"
        onClick={approve}
        disabled={state === "busy" || state === "not_found" || !code}
      >
        Approve
      </button>
    </main>
  );
}
