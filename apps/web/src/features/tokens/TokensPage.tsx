import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, type TokenAccount } from "@osp/sdk";
import { useServices } from "../../api/services";
import { AccountLink, Button, Card, Field, Notice } from "../../components/ui";
import { humanizeError, submitAction } from "../../tx/submit";
import { useMe, useSubmitContext } from "../session";
export function TokensPage() {
  const me = useMe(),
    ctx = useSubmitContext(),
    { protocol, indexer } = useServices();
  const [account, setAccount] = useState<TokenAccount>(),
    [capacity, setCapacity] = useState("0"),
    [error, setError] = useState("");
  const [to, setTo] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [selfPay, setSelfPay] = useState(false);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof indexer.tokenActivity>>["items"]>([]);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    if (!me || !protocol) return;
    const current = ++version.current;
    try {
      const r = await protocol.reads.token.get_account({ account: me.account });
      if (current !== version.current) return;
      setError("");
      setAccount(r?.value);
      setCapacity(r?.capacity ?? "0");
      if (indexer.configured) {
        const page = await indexer.tokenActivity(me.account);
        if (current === version.current) setActivity(page.items);
      }
    } catch (e) {
      if (current === version.current) setError(humanizeError(e));
    }
  }, [me, protocol, indexer]);
  useEffect(() => {
    setAccount(undefined);
    setActivity([]);
    void refresh();
    return () => {
      version.current++;
    };
  }, [refresh]);
  const transfer = async () => {
    if (!ctx || !me || busy || !selfPay) return;
    if (!isAddress(to.trim()) || to.trim() === me.account || !/^[1-9]\d{0,6}$/.test(amount) || BigInt(amount) > 1000000n) {
      setError("Enter another account and a positive whole-token amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const op = await ctx.client.ops.token.transfer({ from: me.account, to: to.trim(), value: amount });
      await submitAction({ ...ctx, payment: "self-only" }, [op], {
        label: "Transferring action tokens",
        success: "Tokens transferred",
        waitForReceipt: true,
      });
      setAmount("");
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };
  const credits = account ? (BigInt(account.free_credits) + BigInt(account.token_credits)) / 1000n : undefined;
  return (
    <div className="page-stack">
      <h1>Action tokens</h1>
      <p>Support useful posts and earn more capacity for social activity.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="token-summary">
        <Card title="Your tokens">
          <p className="token-number">
            {account ? account.balance : "—"} <small>OSAT</small>
          </p>
          <p className="muted">Harbinger test tokens</p>
        </Card>
        <Card title="Available activity">
          <p className="token-number">
            {credits?.toString() ?? "—"} <small>actions</small>
          </p>
          <p className="muted">Capacity: {account ? (BigInt(capacity) / 1000n).toString() : "—"}. Regenerates over 24 hours.</p>
        </Card>
      </div>
      <Button onClick={() => void refresh()} disabled={busy || !protocol}>
        Refresh balance
      </Button>
      <Card title="How it works">
        <p>
          Every account has a free allowance of 100 actions. Each action token adds one action of capacity. Posts, likes, friend requests,
          follows, message requests, messages and support use that capacity.
        </p>
        <p>
          Use <strong>Support</strong> on someone else's post to recognize it. Pilot rewards are capped per author and across the network.
          Tokens give no control over feeds or moderation.
        </p>
        <p>
          Transfers move the tokens and their remaining capacity together. Sending tokens back and forth does not refill them. Koinos Mana
          is separate and must still be paid by you or a sponsor.
        </p>
      </Card>
      <Card title="Send tokens">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void transfer();
          }}
        >
          <Field label="Recipient account">
            {(id) => <input id={id} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />}
          </Field>
          <Field label="Whole tokens">
            {(id) => <input id={id} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />}
          </Field>
          <label className="checkbox-row">
            <input type="checkbox" checked={selfPay} onChange={(e) => setSelfPay(e.target.checked)} /> Pay this transfer's Mana from my
            account
          </label>
          <Button type="submit" variant="primary" busy={busy} disabled={!protocol || !selfPay || !to || !amount}>
            Send tokens
          </Button>
        </form>
      </Card>
      <Card title="Recent activity">
        {activity.length === 0 ? (
          <p className="muted">Your support and transfers will appear here.</p>
        ) : (
          activity.map((a, i) => (
            <div className="token-activity" key={a.txId + "-" + i}>
              <strong>
                {a.kind.endsWith("supported")
                  ? a.recipient === me?.account
                    ? "Support received"
                    : "Supported a post"
                  : a.kind.endsWith("burn")
                  ? "Burned"
                  : a.to === me?.account
                  ? "Received"
                  : "Sent"}
              </strong>
              <span>{a.value ?? a.reward ?? "0"} OSAT</span>
              <small>
                {a.from && (
                  <>
                    From <AccountLink account={a.from} />
                  </>
                )}
                {a.to && (
                  <>
                    {" "}
                    to <AccountLink account={a.to} />
                  </>
                )}
                {a.actor && (
                  <>
                    {" "}
                    By <AccountLink account={a.actor} />
                  </>
                )}
              </small>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
