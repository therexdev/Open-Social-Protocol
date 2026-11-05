import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Notice, Spinner } from "../../../web/src/components/ui";
import { useVault } from "../../../web/src/vault/context";
import { useProfileName } from "../../../web/src/features/profile/useProfileName";
import type { VaultStatusView } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import { OptionsApp } from "../options/App";
import { DeviceAuth } from "./DeviceAuth";
import { Unlock } from "./Onboarding";
import { usePanel } from "./store";
import { UnfinishedPosts } from "./UnfinishedPosts";
import { Composer } from "./Composer";

export function useFacebookAccount() {
  const { status, error, refreshStatus, loadQueue } = usePanel();
  useEffect(() => {
    void refreshStatus(); void loadQueue();
    const refresh = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && "osp.session" in changes || area === "local" && "osp.vault" in changes) void refreshStatus();
      if (area === "local" && "osp.crossposts" in changes) void loadQueue();
    };
    chrome.storage.onChanged.addListener(refresh);
    const timer = setInterval(() => void refreshStatus(), 30_000);
    return () => { clearInterval(timer); chrome.storage.onChanged.removeListener(refresh); };
  }, [refreshStatus, loadQueue]);
  return { status, error, refreshStatus };
}

/** The existing restricted worker account is for host-site integration only. */
export function FacebookSettings() {
  const { status, error, refreshStatus } = useFacebookAccount();
  const native = useVault(), [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const name = useProfileName(status?.account || "");
  if (!status) return error ? <Notice kind="error">{error}</Notice> : <Spinner label="Opening browser connections"/>;
  const mismatch = native.account && status.account && native.account !== status.account;
  const authorize = native.status === "unlocked" && !mismatch ? () => native.exportFile() : undefined;
  const expired = status.device && Number(status.device.expiresAt) <= Date.now();
  return <div className="page"><h1>Browser connections</h1>
    <Card><p>Connect once to interact with Open Social posts inside Facebook and X, and cross-post from either composer. This uses a separate, restricted browser authorization.</p>
      {status.account && <p>Connected account: <strong>{name}</strong></p>}
      {mismatch && <Notice kind="warning">The site integration is connected to a different account from the one open in this panel. Facebook and X actions use {name}. Existing authorization has been preserved.</Notice>}
      {status.status === "empty" ? native.status === "unlocked" ? <form className="stack" onSubmit={e => { e.preventDefault(); setBusy(true); setFailure("");
        void rpc("vault.import", { identity: native.exportFile(), passphrase }).then(() => { setPassphrase(""); return refreshStatus(); }).catch(e => setFailure(e.message)).finally(() => setBusy(false)); }}>
        <Field label="Passphrase for the browser connection (at least 8 characters)">{id=><input id={id} type="password" autoComplete="new-password" value={passphrase} onChange={e=>setPassphrase(e.target.value)}/>}</Field>
        <Button type="submit" variant="primary" busy={busy} disabled={passphrase.length<8}>Connect this account</Button>
      </form> : <Link className="btn btn-primary" to="/welcome">Sign in to connect your account</Link>
      : status.status === "locked" ? <div className="legacy-tools"><Unlock/></div>
      : !status.deviceAuthorized || expired ? <div className="legacy-tools"><DeviceAuth identity={authorize}/></div>
      : <div className="row"><span className="hint">Site interactions are unlocked.</span><Button onClick={()=>void rpc("vault.lock").then(refreshStatus)}>Lock site connection</Button></div>}
      {status.status === "unlocked" && status.deviceAuthorized && !expired && authorize && <details className="legacy-tools"><summary>Renew site authorization</summary><DeviceAuth identity={authorize}/></details>}
      {(failure || error) && <Notice kind="error">{failure || error}</Notice>}
    </Card>
    <div className="legacy-tools"><OptionsApp adaptersOnly/></div>
  </div>;
}

export function FacebookDrafts() {
  const { status } = useFacebookAccount(), { queue, prefill } = usePanel();
  if (!queue.some(q => q.record.koinosStatus !== "ok")) return null;
  return <details className="card legacy-tools"><summary>Unfinished browser posts</summary>
    {status?.status !== "unlocked" ? <p><Link to="/connections">Unlock the browser connection</Link> to finish saved cross-posts.</p> : <>
      {prefill && <><Composer/><Button onClick={()=>usePanel.getState().setPrefill(undefined)}>Close saved draft</Button></>}
      <UnfinishedPosts/>
    </>}
  </details>;
}
