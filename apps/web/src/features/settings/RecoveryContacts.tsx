/** Guardians (recovery contacts), threshold and delay: identity.set_recovery_policy and pending changes. */
import { useCallback, useEffect, useState } from "react";
import { isAddress, type RecoveryState } from "@osp/sdk";
import { useServices } from "../../api/services";
import { AccountLink, Button, Field, Notice } from "../../components/ui";
import { submitAction } from "../../tx/submit";
import { errorMessage, formatDateTime, formatDuration } from "../../util/format";
import { useCanAct, useSubmitContext } from "../session";

export function useRecoveryState(account: string | undefined) {
  const { protocol } = useServices();
  const [state, setState] = useState<RecoveryState | undefined>();
  const [error, setError] = useState<string | undefined>();
  const refresh = useCallback(async () => {
    if (!account || !protocol) return;
    try {
      setState((await protocol.reads.identity.get_recovery({ account }))?.value);
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [account, protocol]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { state, error, refresh };
}

export function RecoveryContacts({ account }: { account: string }) {
  const can = useCanAct();
  const ctx = useSubmitContext();
  const { state, error, refresh } = useRecoveryState(account);
  const [guardians, setGuardians] = useState("");
  const [threshold, setThreshold] = useState(1);
  const [delayHours, setDelayHours] = useState(48);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    if (state?.policy) {
      setGuardians(state.policy.guardians.join("\n"));
      setThreshold(state.policy.threshold);
      setDelayHours(Math.round(Number(state.policy.delay_ms) / 3_600_000));
    }
  }, [state]);

  const list = guardians
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const invalid = list.filter((a) => !isAddress(a));

  const submitPolicy = async () => {
    if (!ctx) return;
    setFormError(undefined);
    if (list.length === 0) return setFormError("Add at least one recovery contact.");
    if (invalid.length > 0) return setFormError(`Not a valid address: ${invalid[0]}`);
    if (list.includes(account)) return setFormError("You cannot be your own recovery contact.");
    if (threshold < 1 || threshold > list.length) return setFormError("The number of contacts who must agree has to be between 1 and the number of contacts.");
    setBusy(true);
    try {
      const op = await ctx.client.ops.identity.set_recovery_policy({
        account,
        policy: { guardians: list, threshold, delay_ms: String(Math.max(0, Math.round(delayHours * 3_600_000))) },
      });
      await submitAction(ctx, [op], { label: "Saving recovery contacts", success: state?.policy ? "Change scheduled" : "Recovery contacts saved" });
      await refresh();
    } catch {
      // toast
    } finally {
      setBusy(false);
    }
  };

  const simple = async (method: "apply_recovery_policy" | "cancel_recovery_policy" | "cancel_recovery", label: string) => {
    if (!ctx) return;
    setBusy(true);
    try {
      const op = await ctx.client.ops.identity[method]({ account });
      await submitAction(ctx, [op], { label });
      await refresh();
    } catch {
      // toast
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p>
        Recovery contacts can hand your account to a new key if you lose this one, after a waiting period during which you can cancel. They never see your
        posts or keys. Recovery restores control, not the ability to read old friends-only posts: keep your exported identity file for that.
      </p>
      {error && <Notice kind="warning">Could not read the current policy from the network: {error}</Notice>}
      {state?.policy && (
        <Notice kind="info">
          Current: {state.policy.threshold} of {state.policy.guardians.length} contact(s) must agree, then {formatDuration(state.policy.delay_ms)} waiting time.
          <ul className="inline-list">
            {state.policy.guardians.map((g) => (
              <li key={g}>
                <AccountLink account={g} />
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {state?.pending_policy && (
        <Notice kind="warning">
          A change is pending and becomes active at {formatDateTime(state.pending_policy.effective_at)}.
          <div className="row">
            <Button onClick={() => void simple("apply_recovery_policy", "Applying the recovery policy change")} disabled={!can.ok || busy || Number(state.pending_policy.effective_at) > Date.now()}>
              Apply now
            </Button>
            <Button variant="ghost" onClick={() => void simple("cancel_recovery_policy", "Cancelling the pending change")} disabled={!can.ok || busy}>
              Cancel change
            </Button>
          </div>
        </Notice>
      )}
      {state?.pending_recovery && (
        <Notice kind="error">
          A recovery to <span className="mono">{state.pending_recovery.new_owner}</span> is in progress ({state.pending_recovery.approvals.length} approval(s)
          {Number(state.pending_recovery.effective_at) > 0 ? `, effective ${formatDateTime(state.pending_recovery.effective_at)}` : ""}). If this is not you, cancel it now.
          <div className="row">
            <Button variant="danger" onClick={() => void simple("cancel_recovery", "Cancelling the recovery")} disabled={!can.ok || busy}>
              Cancel recovery
            </Button>
          </div>
        </Notice>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitPolicy();
        }}
      >
        <Field label="Recovery contacts (one address per line)" hint="People you trust. They approve a recovery together.">
          {(id) => <textarea id={id} value={guardians} onChange={(e) => setGuardians(e.target.value)} rows={3} spellCheck={false} />}
        </Field>
        <div className="row">
          <Field label="How many must agree">{(id) => <input id={id} type="number" min={1} max={Math.max(1, list.length)} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />}</Field>
          <Field label="Waiting time (hours)" hint="Time you get to cancel an unwanted recovery.">
            {(id) => <input id={id} type="number" min={0} max={24 * 90} value={delayHours} onChange={(e) => setDelayHours(Number(e.target.value))} />}
          </Field>
        </div>
        {formError && <Notice kind="error">{formError}</Notice>}
        <Button type="submit" variant="primary" busy={busy} disabled={!can.ok} title={can.ok ? undefined : can.reason}>
          {state?.policy ? "Schedule change" : "Save recovery contacts"}
        </Button>
        {state?.policy && <p className="hint">Changes to an existing policy wait for the current waiting time before they apply.</p>}
      </form>
    </div>
  );
}
