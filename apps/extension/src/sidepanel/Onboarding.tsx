import { useState, type FormEvent } from "react";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

export function Onboarding() {
  const { run, busy, refreshStatus } = usePanel();
  const [mode, setMode] = useState<"create" | "import">("create");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [identity, setIdentity] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (passphrase !== confirm) {
      usePanel.setState({ error: "The passphrases do not match." });
      return;
    }
    await run(async () => {
      if (mode === "create") await rpc("vault.create", { passphrase });
      else await rpc("vault.import", { identity: identity.trim(), passphrase });
      await refreshStatus();
    });
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    void file.text().then(setIdentity);
  }

  return (
    <div className="content">
      <div className="card">
        <h1>Welcome</h1>
        <p className="muted">Your account lives on your device. The passphrase protects it in this browser; nothing is sent anywhere.</p>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className={mode === "create" ? "primary" : ""} onClick={() => setMode("create")}>
            Create an account
          </button>
          <button className={mode === "import" ? "primary" : ""} onClick={() => setMode("import")}>
            Use my identity file
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "import" && (
            <>
              <label>
                <span className="lbl">Identity file (exported from the web client)</span>
                <input type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <label>
                <span className="lbl">…or paste its contents</span>
                <textarea value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder='{"version":1,"seed":"…","keyVersion":1,"account":"1…"}' />
              </label>
            </>
          )}
          <label>
            <span className="lbl">Passphrase (at least 8 characters)</span>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            <span className="lbl">Repeat passphrase</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          <button className="primary" type="submit" disabled={busy || passphrase.length < 8 || (mode === "import" && identity.trim().length === 0)}>
            {mode === "create" ? "Create account" : "Import account"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function Unlock() {
  const { run, busy, refreshStatus, status } = usePanel();
  const [passphrase, setPassphrase] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await rpc("vault.unlock", { passphrase });
      setPassphrase("");
      await refreshStatus();
    });
  }
  return (
    <div className="content">
      <div className="card">
        <h1>Unlock</h1>
        <p className="muted">Account {status?.account}</p>
        <form onSubmit={submit}>
          <label>
            <span className="lbl">Passphrase</span>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <button className="primary" type="submit" disabled={busy || passphrase.length === 0}>
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
