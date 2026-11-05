import { useState, type FormEvent } from "react";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

/**
 * The device authorization step. The extension keeps only a device key by default: the identity
 * seed is discarded from this browser once the device is authorized on chain (spec section 3.1).
 */
export function DeviceAuth({ identity }: { identity?: () => string } = {}) {
  const { run, busy, refreshStatus, status, skipDeviceStep } = usePanel();
  const [passphrase, setPassphrase] = useState("");
  const [keepOwnerSeed, setKeepOwnerSeed] = useState(false);
  const [done, setDone] = useState<{ registered: boolean; mode: string } | undefined>();
  const deployed = status?.network.deployed ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(async () => rpc<{ registered: boolean; mode: string }>("device.authorize", { passphrase, keepOwnerSeed, ...(identity && { identity: identity() }) }));
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
          <p className="muted">{done.mode === "device" ? "The site connection keeps only its device key and reading key. Your full panel account is unchanged." : "The site connection also keeps the identity seed, as you chose."}</p>
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
          To publish, react, comment, cast paid reward votes and manage friends from this browser, the extension uses a separate <strong>device key</strong> that your account authorizes on chain for <strong>30 days</strong>.
        </p>
        <ul className="muted" style={{ paddingLeft: 18 }}>
          <li>The device cannot transfer or burn your tokens, change account keys, add devices, block people or run a recovery.</li>
          <li>After this step the site connection keeps only its restricted keys. The full panel account is kept separately; keep your identity backup safe.</li>
          <li>You can revoke this browser from Account & settings → Devices.</li>
        </ul>
        {!deployed && <div className="notice">{status?.network.message} You can continue in read-only mode and come back later.</div>}
        <form onSubmit={submit}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={keepOwnerSeed} onChange={(e) => setKeepOwnerSeed(e.target.checked)} style={{ width: "auto" }} />
            <span>Keep the identity seed in the site connection too (optional)</span>
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
