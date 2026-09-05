import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Notice } from "../../components/ui";
import { errorMessage, shortAddress } from "../../util/format";
import { useVault } from "../../vault/store";

export function UnlockScreen() {
  const vault = useVault();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const unlock = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await vault.unlock(passphrase);
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
      await vault.unlockWithPasskey();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <Card title="Unlock your account">
        <p>
          Account <span className="mono">{shortAddress(vault.account, 8)}</span> is locked on this device.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <Field label="Passphrase">{(id) => <input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" autoFocus required />}</Field>
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
