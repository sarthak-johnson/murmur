import { useState } from "react";
import { ApiError, api } from "../api";

type State = "idle" | "busy" | "done" | "not_found" | "rate_limited" | "error";

const ERRORS: Record<string, string> = {
  not_found: "That code is not valid or has expired. Run /murmur:login again.",
  rate_limited: "Too many tries. Wait a few minutes and try again.",
  error: "Something went wrong. Try again.",
};

export function Device({ code }: { code: string }) {
  const [state, setState] = useState<State>("idle");

  async function approve() {
    setState("busy");
    try {
      await api.approveDevice(code);
      setState("done");
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "error";
      setState(c === "not_found" || c === "rate_limited" ? c : "error");
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
      <h1>Connect this machine?</h1>
      <p className="code">{code}</p>
      {ERRORS[state] && (
        <p className="error" role="alert">
          {ERRORS[state]}
        </p>
      )}
      <button
        type="button"
        className="primary"
        onClick={approve}
        disabled={state === "busy" || !code}
      >
        Approve
      </button>
    </main>
  );
}
