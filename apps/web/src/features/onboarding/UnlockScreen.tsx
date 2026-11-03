import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Notice } from "../../components/ui";
import { errorMessage, shortAddress } from "../../util/format";
import { useVault } from "../../vault/context";

export function UnlockScreen() {
  const vault = useVault();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const unlock = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await vault.unlock(passphrase, remember);
      setPassphrase("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const passkey = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await vault.unlockWithPasskey(remember);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <Card title="Unlock your account">
        {vault.lockReason && <Notice>{({
          manual: "Your account was locked manually.",
          inactivity: "Your account locked because its inactivity timeout elapsed.",
          expired: "Your 30-day remembered sign-in expired. Unlock to continue.",
          "device-removed": "Remembered sign-in ended in another tab or browser storage is unavailable.",
          reopened: "This page opened without an active remembered sign-in.",
        })[vault.lockReason]}</Notice>}
        <p>
          Account <span className="mono">{shortAddress(vault.account, 8)}</span> is saved on this device. Enter the passphrase you chose when creating or importing it.
        </p>
        <p className="hint">Without remembered sign-in, reloading or reopening this page locks your account even when auto-lock is set to 0. Paid uploads are saved; select the original audio file after unlocking to resume.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <Field label="Passphrase">{(id) => <input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" autoFocus required />}</Field>
          {vault.rememberAvailable && (
            <div>
              <label className="checkbox-row">
                <input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />
                Remember this device for 30 days
              </label>
              <p className="hint">Use only on your personal device. Anyone using this browser can access your account, private content and wallet without your passphrase. Lock now ends remembered sign-in.</p>
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <div className="row">
            <Button type="submit" variant="primary" busy={busy} disabled={passphrase.length === 0}>
              Unlock
            </Button>
            {vault.passkeyEnrolled && (
              <Button onClick={() => void passkey()} busy={busy}>
                Use passkey
              </Button>
            )}
          </div>
        </form>
        <p className="hint">
          Forgot the passphrase? It cannot be reset. Restore the account from your identity file on the <Link to="/recover">recovery page</Link>.
        </p>
      </Card>
    </div>
  );
}
