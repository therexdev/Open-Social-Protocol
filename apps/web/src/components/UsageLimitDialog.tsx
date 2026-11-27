import { useState } from "react";
import { useServices } from "../api/services";
import { useMe } from "../features/session";
import { useSettings } from "../stores/settings";
import { useUsagePrompt, type UsagePrompt } from "../stores/usagePrompt";
import { ConfirmDialog, CopyButton } from "./ui";

export function UsageLimitDialog({ notice }: { notice: UsagePrompt }) {
  const me = useMe(), { protocol, resolved } = useServices();
  const [enabled, setEnabled] = useState(false);
  const close = useUsagePrompt(s => s.close);
  // Never show a previous account's funding address after an account/network switch.
  const active = !!me && protocol?.chainId === notice.chainId && me.signer.getAddress() === notice.payer;
  const symbol = resolved.network === "mainnet" ? "KOIN" : "tKOIN";
  const title = !notice.canUseOwnAccount && notice.kind === "account" ? "Messages are waiting for free usage" : notice.kind === "daily" ? "Free usage limit reached" : notice.kind === "service" ? "Free usage is temporarily unavailable" : "Your account needs more capacity";
  return <ConfirmDialog open={active} title={title}
    confirmLabel={notice.canUseOwnAccount && !enabled ? "Use my account for extra usage" : "Done"}
    cancelLabel={notice.kind === "account" ? "Wait for recharge" : "Wait for free usage"}
    onCancel={close} onConfirm={() => {
      if (!notice.canUseOwnAccount || enabled) { close(); return; }
      if (!active) return;
      useSettings.getState().update({ payment: "sponsor-then-self" });
      setEnabled(true);
    }}>
    {notice.kind === "daily" ? <>
      <p>You have reached your free daily usage limit. Recent activity may still be reserving some of it, so trying again shortly can help.</p>
      {notice.resetAt && <p>Your free allowance resets at <strong>{new Date(notice.resetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</strong> (your local time; midnight UTC).</p>}
    </> : notice.kind === "service" ? <p>The free service is busy or temporarily out of capacity. You can try again later.</p> :
      notice.canUseOwnAccount ? <p>Your current wallet does not have enough available capacity for this action. You can wait for its capacity to recharge automatically.</p> : <p>Private messaging is waiting for more free capacity.</p>}
    {notice.canUseOwnAccount ? <>
      <p>To keep using Open Social, send {symbol} to this wallet on <strong>{resolved.network}</strong>. Holding {symbol} supplies network capacity, called Mana, which recharges automatically.</p>
      <p className="wallet-address"><code>{notice.payer}</code></p>
      <CopyButton text={notice.payer} label="Copy funding address"/>
      <p>Choose “Use my account for extra usage” to use your wallet when free usage is unavailable. Free usage will still be tried first.</p>
      {enabled && <p role="status">Extra usage enabled. Once your wallet is funded or recharged, retry the action you were making.</p>}
    </> : <p>This message operation is waiting for free usage to become available. Your saved messages will retry automatically.</p>}
  </ConfirmDialog>;
}
