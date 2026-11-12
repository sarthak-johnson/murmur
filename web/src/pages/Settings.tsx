import { useEffect, useRef, useState } from "react";
import { api, type Machine } from "../api";
import { ago, dayLabel } from "../format";
import { clock } from "../story";
import { WhatMurmurSends } from "./WhatMurmurSends";

const CONFIRM = "delete my account";

function RevokeButton({ onRevoke }: { onRevoke: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) return onRevoke();
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), 5000);
      }}
    >
      {armed ? "Revoke?" : "Revoke"}
    </button>
  );
}

export function Settings({ onSignedOut }: { onSignedOut: () => void }) {
  const [days, setDays] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    api.settings().then(
      (s) => setDays(String(s.retentionDays)),
      () => setLoadError("Could not load your settings."),
    );
    api.machines().then(
      (m) => setMachines(m.machines),
      () => setLoadError("Could not load machines."),
    );
  }, []);

  async function save() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      return setMsg({
        text: "Enter a whole number of days from 1 to 3650.",
        bad: true,
      });
    }
    try {
      await api.setSettings(n);
      setMsg({ text: "Saved.", bad: false });
    } catch {
      setMsg({
        text: "Could not save. Enter a whole number of days from 1 to 3650.",
        bad: true,
      });
    }
  }

  async function revoke(machineId: string) {
    try {
      await api.revokeMachine(machineId);
      setMachines((m) => (m ?? []).filter((x) => x.machineId !== machineId));
      setActionError("");
    } catch {
      setActionError("Could not revoke that machine. Try again.");
    }
  }

  async function deleteAccount() {
    try {
      await api.deleteAccount();
      onSignedOut();
    } catch {
      setActionError("Could not delete your account. Try again.");
    }
  }

  return (
    <main className="page">
      <h1>Settings</h1>
      {(loadError || actionError) && (
        <p className="error" role="alert">
          {loadError || actionError}
        </p>
      )}
      <section className="panel">
        <h2>Retention</h2>
        <label htmlFor="retention">Keep sessions for (days)</label>
        <input
          id="retention"
          type="number"
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />{" "}
        <button type="button" onClick={save}>
          Save
        </button>
        {msg && (
          <p className={msg.bad ? "error" : "muted"} role="status">
            {msg.text}
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Linked machines</h2>
        {machines?.length === 0 && <p className="muted">No linked machines.</p>}
        {machines?.map((m) => (
          <div className="machine" key={m.machineId}>
            <div>
              <div>{m.machineName}</div>
              {/* A machine linked again keeps its name: when and which link tell them apart. */}
              <div className="muted">
                Linked{" "}
                <time dateTime={m.createdAt}>
                  {dayLabel(m.createdAt)}, {clock(m.createdAt)}
                </time>
                {" · "}last used {ago(m.lastUsedAt)}
                {" · "}
                <span className="num" title={m.machineId}>
                  id …{m.machineId.slice(-6)}
                </span>
              </div>
            </div>
            <RevokeButton onRevoke={() => revoke(m.machineId)} />
          </div>
        ))}
      </section>
      <WhatMurmurSends />
      <section className="panel">
        <h2>Delete account</h2>
        <label htmlFor="confirm">
          Type <code>{CONFIRM}</code> to confirm
        </label>
        <input
          id="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />{" "}
        <button
          type="button"
          disabled={confirm !== CONFIRM}
          onClick={deleteAccount}
        >
          Delete account
        </button>
      </section>
    </main>
  );
}
