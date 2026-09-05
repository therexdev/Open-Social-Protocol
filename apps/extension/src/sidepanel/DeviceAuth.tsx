import { useState, type FormEvent } from "react";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

/**
 * The device authorization step. The extension keeps only a device key by default: the identity
 * seed is discarded from this browser once the device is authorized on chain (spec section 3.1).
 */
export function DeviceAuth() {
  const { run, busy, refreshStatus, status, skipDeviceStep } = usePanel();
  const [passphrase, setPassphrase] = useState("");
  const [keepOwnerSeed, setKeepOwnerSeed] = useState(false);
  const [done, setDone] = useState<{ registered: boolean; mode: string } | undefined>();
  const deployed = status?.network.deployed ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(async () => rpc<{ registered: boolean; mode: string }>("device.authorize", { passphrase, keepOwnerSeed }));
    if (result) {
      setDone(result);
      setPassphrase("");
      await refreshStatus();
    }
  }

  if (done) {
    return (
      <div className="content">
        <div className="card good">
          <h2>This browser is authorized</h2>
          <p>{done.registered ? "Your account was registered on chain and this browser was authorized in the same transaction." : "This browser was authorized on chain."}</p>
          <p className="muted">{done.mode === "device" ? "Your identity seed was removed from this browser; only the device key and the reading key remain." : "Your identity seed stays in this browser, as you chose."}</p>
          <button className="primary" onClick={() => usePanel.setState({ skippedDeviceStep: true })}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="card">
        <h1>Authorize this browser</h1>
        <p>
          To publish, react, comment and manage friends from this browser, the extension uses a separate <strong>device key</strong> that your account authorizes on chain for <strong>30 days</strong>.
        </p>
        <ul className="muted" style={{ paddingLeft: 18 }}>
          <li>The device can never change your account keys, add other devices, block people or run a recovery.</li>
          <li>After this step the identity seed is removed from this browser. Keep your identity file safe: it restores everything on any device.</li>
          <li>You can revoke this browser at any time from the web client.</li>
        </ul>
        {!deployed && <div className="notice">{status?.network.message} You can continue in read-only mode and come back later.</div>}
        <form onSubmit={submit}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={keepOwnerSeed} onChange={(e) => setKeepOwnerSeed(e.target.checked)} style={{ width: "auto" }} />
            <span>Keep my identity seed in this browser too (not recommended on shared computers)</span>
          </label>
          <label>
            <span className="lbl">Passphrase (needed to re-encrypt the vault)</span>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" />
          </label>
          <div className="row">
            <button className="primary" type="submit" disabled={busy || !deployed || passphrase.length === 0}>
              {busy ? "Authorizing…" : "Authorize this browser"}
            </button>
            <button type="button" onClick={skipDeviceStep}>
              Not now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
