/** Recovery: import an identity file here, or act as a recovery contact for someone else. */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isAddress } from "@osp/sdk";
import { useServices } from "../../api/services";
import { Button, Card, ConfirmDialog, Field, Notice } from "../../components/ui";
import { submitAction } from "../../tx/submit";
import { readFileText } from "../../util/download";
import { errorMessage, formatDateTime } from "../../util/format";
import { useVault } from "../../vault/store";
import { useCanAct, useSubmitContext } from "../session";
import { useRecoveryState } from "../settings/RecoveryContacts";

function ImportSection() {
  const vault = useVault();
  const navigate = useNavigate();
  const [json, setJson] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const doImport = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await vault.importFromFile(json, passphrase);
      setConfirmReplace(false);
      navigate("/");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (vault.status === "locked" || vault.status === "unlocked") setConfirmReplace(true);
        else void doImport();
      }}
    >
      <p>Restore an account from the identity file exported in Settings. The file restores posting and reading; it is not shared with anyone.</p>
      <Field label="Identity file">
        {(id) => (
          <input
            id={id}
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setJson(await readFileText(file));
            }}
          />
        )}
      </Field>
      <Field label="Or paste its contents">{(id) => <textarea id={id} value={json} onChange={(e) => setJson(e.target.value)} rows={3} spellCheck={false} />}</Field>
      <Field label="New passphrase for this device" hint="At least 8 characters. It protects the account on this device only.">
        {(id) => <input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" minLength={8} required />}
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <Button type="submit" variant="primary" busy={busy} disabled={json.trim().length === 0 || passphrase.length < 8}>
        Import account
      </Button>
      <ConfirmDialog open={confirmReplace} title="Replace the account on this device?" confirmLabel="Replace" danger busy={busy} onCancel={() => setConfirmReplace(false)} onConfirm={() => void doImport()}>
        <p>
          This device already holds an account ({vault.account}). Importing replaces it here; make sure that account was exported if you still need it.
        </p>
      </ConfirmDialog>
    </form>
  );
}

function GuardianSection() {
  const me = useVault((s) => s.account);
  const can = useCanAct();
  const ctx = useSubmitContext();
  const { protocol } = useServices();
  const [account, setAccount] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const target = isAddress(account.trim()) ? account.trim() : undefined;
  const { state, refresh } = useRecoveryState(target);

  const propose = async () => {
    if (!ctx || !target || !me) return;
    setError(undefined);
    if (!isAddress(newOwner.trim())) return setError("Enter the new owner address the person gave you.");
    setBusy(true);
    try {
      const op = await ctx.client.ops.identity.propose_recovery({ account: target, guardian: me, new_owner: newOwner.trim() });
      await submitAction(ctx, [op], { label: "Approving the recovery", success: "Recovery approval recorded" });
      await refresh();
    } catch {
      // toast
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!ctx || !target) return;
    setBusy(true);
    try {
      const op = await ctx.client.ops.identity.execute_recovery({ account: target });
      await submitAction(ctx, [op], { label: "Completing the recovery", success: "Recovery completed" });
      await refresh();
    } catch {
      // toast
    } finally {
      setBusy(false);
    }
  };

  if (!me) return <p>Unlock your account to act as a recovery contact.</p>;
  if (!protocol) return <p className="muted">{can.reason}</p>;
  const pending = state?.pending_recovery;
  const ready = pending && Number(pending.effective_at) > 0 && Number(pending.effective_at) <= Date.now();
  return (
    <div className="stack">
      <p>If someone named you as a recovery contact and lost their key, they will give you their account address and a new owner address. Approve it here.</p>
      <Field label="Account to recover">{(id) => <input id={id} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="1…" spellCheck={false} />}</Field>
      {target && state?.policy && (
        <Notice kind="info">
          {state.policy.guardians.includes(me) ? "You are a recovery contact for this account." : "You are not listed as a recovery contact for this account."} {state.policy.threshold} of{" "}
          {state.policy.guardians.length} must agree.
          {pending && (
            <>
              {" "}
              Pending: new owner <span className="mono">{pending.new_owner}</span>, {pending.approvals.length} approval(s)
              {Number(pending.effective_at) > 0 ? `, can complete at ${formatDateTime(pending.effective_at)}` : ""}.
            </>
          )}
        </Notice>
      )}
      {target && state && !state.policy && <Notice kind="warning">This account has no recovery contacts set.</Notice>}
      <Field label="New owner address">{(id) => <input id={id} value={newOwner} onChange={(e) => setNewOwner(e.target.value)} placeholder="1…" spellCheck={false} />}</Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row">
        <Button variant="primary" onClick={() => void propose()} busy={busy} disabled={!can.ok || !target}>
          Approve recovery
        </Button>
        <Button onClick={() => void execute()} busy={busy} disabled={!can.ok || !target || !ready}>
          Complete recovery
        </Button>
      </div>
      <p className="hint">Completing is possible once enough contacts approved and the waiting time passed. Anyone can trigger it then.</p>
    </div>
  );
}

export function RecoveryPage() {
  return (
    <div className="page">
      <h1>Recovery</h1>
      <Card title="Restore your account from an identity file">
        <ImportSection />
      </Card>
      <Card title="Help someone recover their account">
        <GuardianSection />
      </Card>
      <p>
        Want to set up recovery contacts for your own account? Go to <Link to="/settings">Settings</Link>.
      </p>
    </div>
  );
}
