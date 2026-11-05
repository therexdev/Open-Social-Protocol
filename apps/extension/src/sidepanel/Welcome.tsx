import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { OnboardingPage, returnPath } from "../../../web/src/features/onboarding/OnboardingPage";
import { useVault, useVaultStore } from "../../../web/src/vault/context";
import { Button, Card, Field, Notice, Spinner } from "../../../web/src/components/ui";
import { importExistingAccount } from "./nativeAccount";
import { useFacebookAccount } from "./FacebookSettings";

export function Welcome() {
  const status = useVault(s => s.status), vault = useVaultStore();
  const { status: legacy, error: loadError } = useFacebookAccount();
  const [file, setFile] = useState(""), [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const navigate = useNavigate(), location = useLocation();
  if (status !== "empty") return <OnboardingPage/>;
  if (!legacy && loadError) return <div className="page"><h1>Check your saved account</h1><Notice kind="error">{loadError}</Notice><p>We could not check the existing Facebook account. Reopen the panel to try again before creating or importing an identity.</p></div>;
  if (!legacy && !loadError) return <Spinner label="Checking your saved extension account"/>;
  if (!legacy?.account) return <OnboardingPage/>;
  return <div className="page"><h1>Continue with your account</h1><Card>
    <p>Your existing Facebook device account is kept. Set up full access here to post media, use groups, edit your profile and manage your wallet.</p>
    <p className="muted account-address">{legacy.account}</p>
    <form className="stack" onSubmit={event => { event.preventDefault(); setBusy(true); setError("");
      void importExistingAccount(vault, legacy, passphrase, file || undefined).then(() => { setFile(""); setPassphrase(""); navigate(returnPath(location.state), { replace: true }); })
        .catch(e => setError(e.message)).finally(() => setBusy(false)); }}>
      {legacy.mode === "device" ? <p>Choose your original identity backup. Your saved device key has limited permissions and cannot restore the full identity.</p> : <p>Enter your existing extension passphrase to copy your saved identity locally. The original Facebook authorization stays intact.</p>}
      <Field label={legacy.mode === "device" ? "Identity backup" : "Identity backup (optional)"}>{id => <input id={id} type="file" accept="application/json,.json" onChange={e => { setFile(""); const selected=e.target.files?.[0]; if(selected) void selected.text().then(setFile).catch(()=>setError("Could not read this identity file.")); }}/>}</Field>
      <Field label={file || legacy.mode === "device" ? "Passphrase for full account access (at least 8 characters)" : "Existing extension passphrase"}>{id => <input id={id} type="password" autoComplete="current-password" value={passphrase} onChange={e => setPassphrase(e.target.value)}/>}</Field>
      {error && <Notice kind="error">{error}</Notice>}
      <Button type="submit" variant="primary" busy={busy} disabled={passphrase.length < 8 || legacy.mode === "device" && !file}>Continue with this account</Button>
    </form>
    <p className="hint">If you used the former Social view, its saved full account and message history are reused automatically. This setup does not register a new identity or remove old data.</p>
    <Link to="/facebook">Manage the existing Facebook connection</Link>
  </Card></div>;
}
