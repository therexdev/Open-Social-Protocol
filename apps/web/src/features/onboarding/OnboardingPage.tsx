/** Primary journey step 1-2: create or import an account, protect it, register on chain. */
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useServices } from "../../api/services";
import { buildProfileDocument } from "../../api/profiles";
import { BrandMark, Icon } from "../../components/Icon";
import { Button, Card, Field, Notice, Spinner } from "../../components/ui";
import { useAccount } from "../../stores/account";
import { useSettings } from "../../stores/settings";
import { submitAction } from "../../tx/submit";
import { readFileText } from "../../util/download";
import { errorMessage } from "../../util/format";
import { useVault } from "../../vault/context";
import { UnlockScreen } from "./UnlockScreen";

type Mode = "choose" | "create" | "import" | "register";

export function RegisterStep({ onDone }: { onDone: () => void }) {
  const session = useVault((s) => s.session);
  const { protocol, resolved, indexer } = useServices();
  const payment = useSettings((s) => s.payment);
  const markRegistered = useAccount((s) => s.markRegistered);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const register = async () => {
    if (!session || !protocol) return;
    setBusy(true);
    setError(undefined);
    try {
      const me = session.identity;
      const profile = name.trim() ? buildProfileDocument({ display_name: name.trim() }) : undefined;
      const op = await protocol.ops.identity.register({
        account: me.account,
        encryption_key: me.encryption.publicKey,
        key_version: me.encryption.keyVersion,
        ...(profile && { profile_hash: profile.hash, profile_uri: profile.uri }),
      });
      await submitAction({ client: protocol, signer: me.signer, payment }, [op], { label: "Registering your account", success: "Your account is on the network" });
      markRegistered(me.account);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!resolved.deployed) {
    return (
      <div className="stack">
        <Notice kind="warning">{resolved.deploymentMessage}. Your account exists on this device; registration on the network becomes possible once contracts are deployed.</Notice>
        <Button variant="primary" onClick={onDone}>
          Continue
        </Button>
      </div>
    );
  }
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void register();
      }}
    >
      <p>
        Your account is saved on this device. Registering publishes your account and the key friends use to share private posts with you. {resolved.sponsorUrls.length > 0 ? "A sponsor pays the network fee." : "No sponsor is configured, so your account pays the fee; add one in Settings if you have none."}
      </p>
      <Field label="Display name (optional, public)">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />}</Field>
      {!indexer.configured && <Notice kind="info">No indexer is configured yet; you can still register and add one in Settings later.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy}>
          Register on the network
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Skip for now
        </Button>
      </div>
      <p className="hint">Later, in Settings, you can add recovery contacts: trusted people who can hand the account to a new key if you lose this one.</p>
    </form>
  );
}

/** Where to go once onboarding is done: the link the visitor opened, else the feed. */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && from.split(/[?#]/, 1)[0] !== "/welcome" ? from : "/";
}

export function OnboardingPage() {
  const vault = useVault();
  const accountState = useAccount();
  const { resolved } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const from = returnPath(location.state);
  const [selectedMode, setMode] = useState<Mode>("choose");
  // Unlocking changes vault state after this page has mounted. Always resume the saved
  // identity instead of leaving "Create account" visible or relying on the initial mode.
  const mode: Mode = vault.status === "unlocked" ? "register" : selectedMode;
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fileJson, setFileJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    setError(undefined);
    if (passphrase.length < 8) return setError("Choose a passphrase of at least 8 characters.");
    if (passphrase !== confirm) return setError("The passphrases do not match.");
    setBusy(true);
    try {
      if (mode === "create") await vault.create(passphrase);
      else await vault.importFromFile(fileJson, passphrase);
      setPassphrase("");
      setConfirm("");
      setMode("register");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (vault.status === "loading") return <Spinner label="Opening your saved account" />;
  if (vault.status === "locked") return <UnlockScreen />;
  if (vault.status === "unlocked" && resolved.deployed) {
    if (accountState.account !== vault.account || accountState.registration === "unknown" || accountState.registration === "checking") {
      return <Spinner label="Checking account registration" />;
    }
    if (accountState.registration === "registered") return <Navigate to={from} replace />;
  }

  return (
    <div className="page narrow onboarding-page">
      {mode === "choose" && <div className="welcome-intro"><BrandMark/><p className="eyebrow">YOUR PEOPLE. YOUR POSTS. YOURS.</p></div>}
      <h1>Welcome to Open Social</h1>
      {from !== "/" && <p className="muted">After setting up your account you will return to the page you opened.</p>}
      {mode === "choose" && (
        <Card className="welcome-card">
          <h2>A fresh start. A lasting connection.</h2>
          <p>Make yourself at home. Share with everyone or just your friends, and keep the same account and connections across compatible apps.</p>
          <div className="row">
            <Button variant="primary" onClick={() => setMode("create")}>
              <Icon name="plus"/> Create an account
            </Button>
            <Button onClick={() => setMode("import")}>I have an identity file</Button>
            <Link className="btn btn-ghost" to="/about">How Open Social works <Icon name="arrow" size={17}/></Link>
          </div>
        </Card>
      )}
      {(mode === "create" || mode === "import") && (
        <Card title={mode === "create" ? "Protect your account" : "Import your account"}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === "import" && (
              <>
                <Field label="Identity file">
                  {(id) => (
                    <input
                      id={id}
                      type="file"
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) setFileJson(await readFileText(file));
                      }}
                    />
                  )}
                </Field>
                <Field label="Or paste its contents">{(id) => <textarea id={id} value={fileJson} onChange={(e) => setFileJson(e.target.value)} rows={3} spellCheck={false} />}</Field>
              </>
            )}
            <p>
              {mode === "create" ? "Your account is generated on this device." : "The file is read on this device only."} A passphrase protects it here; it is never sent
              anywhere and cannot be reset, so pick one you will remember.
            </p>
            <Field label="Passphrase" hint="At least 8 characters.">
              {(id) => <input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" minLength={8} required />}
            </Field>
            <Field label="Repeat the passphrase">{(id) => <input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}</Field>
            {error && <Notice kind="error">{error}</Notice>}
            <div className="row">
              <Button type="submit" variant="primary" busy={busy} disabled={mode === "import" && fileJson.trim().length === 0}>
                {mode === "create" ? "Create account" : "Import account"}
              </Button>
              <Button variant="ghost" onClick={() => setMode("choose")} disabled={busy}>
                Back
              </Button>
            </div>
          </form>
        </Card>
      )}
      {mode === "register" && (
        <Card title="Join the network">
          {vault.account && (
            <p>
              Your account address: <span className="mono">{vault.account}</span>
            </p>
          )}
          <RegisterStep onDone={() => navigate(from)} />
        </Card>
      )}
    </div>
  );
}
