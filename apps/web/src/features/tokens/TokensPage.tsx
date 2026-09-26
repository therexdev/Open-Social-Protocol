import { useEconomy } from "./EconomyContext";
import { PendingRewards } from "./PendingRewards";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, type TokenAccount } from "@osp/sdk";
import { useServices } from "../../api/services";
import { AccountLink, Button, Card, Field, Notice } from "../../components/ui";
import { humanizeError, submitAction } from "../../tx/submit";
import { useMe, useSubmitContext } from "../session";
import { capacityLabel, tokenResources } from "./resources";
export function TokensPage() {
  const { policy } = useEconomy();
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
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    return () => {
      window.clearInterval(timer);
      version.current++;
    };
  }, [refresh]);
  const { v2, ready, precision, free, paid, actions } = tokenResources(account);
  const transfer = async () => {
    if (!ctx || !me || busy || !selfPay) return;
    if (!isAddress(to.trim()) || to.trim() === me.account || !/^[1-9]\d{0,6}$/.test(amount) || BigInt(amount) > 1000000n) {
      setError("Enter another account and a positive whole-token amount.");
      return;
    }
    if (BigInt(amount) > ready) {
      setError(`Only ${ready.toString()} fully charged tokens are available to send. Used tokens must finish recharging.`);
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
  const credits = account ? actions : undefined;
  return (
    <div className="page-stack">
      <h1>Action tokens</h1>
      <p>Use OSAT for activity, reward voting and promotion.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="token-summary">
        <Card title="Your tokens">
          <p className="token-number">
            {account ? account.balance : "—"} <small>OSAT</small>
          </p>
          <p className="muted">Harbinger test tokens</p>
          {v2 && <p>{ready.toString()} ready to send · {account?.locked ?? "0"} recharging and locked</p>}
        </Card>
        <Card title="Available activity">
          <p className="token-number">
            {credits?.toString() ?? "—"} <small>actions</small>
          </p>
          <p className="muted">Capacity: {account ? (BigInt(capacity) / 1000n).toString() : "—"}.
            {account && (v2 ? " Each used unit recharges over 144,000 blocks (about five days)." : " Legacy daily recharge is active on this contract.")}</p>
        </Card>
      </div>
      {v2 && <div className="token-summary">
        <Card title="Free activity capacity"><p className="token-number">{capacityLabel(free, precision)} <small>of 100</small></p></Card>
        <Card title="Token activity capacity"><p className="token-number">{capacityLabel(paid, precision)} <small>actions</small></p>
          <p className="muted">Paid actions and reward votes share this capacity. Votes use paid capacity only; actions use it after free credits run out.</p></Card>
      </div>}
      <Button onClick={() => void refresh()} disabled={busy || !protocol}>
        Refresh balance
      </Button>
      <Card title="How it works">
        <p>
          Every account has a free allowance of 100 actions. Each action token adds one action of capacity. Posts, likes, friend requests,
          follows, message requests, messages and support use that capacity.
        </p>
        <p>{policy ? `Upvotes and downvotes consume the paid weight you choose. Each public post has one reward period, and each account can vote on it once. The ${policy.period_budget} OSAT period budget is shared among authors with positive net scores. Votes do not change moderation.` : "The capped Support pilot remains active until reward voting is activated."}</p>
        <p>
          {v2 ? "Free capacity is used first. Partial recovery adds up immediately: 100 exhausted free units recover one usable action in about 72 minutes. Only fully charged tokens can be sent or burned. Holding more unused tokens does not speed up depleted tokens." : "This deployment still uses the legacy daily resource policy."}
        </p>
        <p>
          Koinos Mana is separate and must still be paid by you or a sponsor. {policy ? `These are testnet pilot settings: ${policy.period_budget} OSAT per ${policy.period_blocks}-block period. Tester allocations are issued by the operator, capped at 100 OSAT per account and 10,000 overall; registering extra accounts gives no voting tokens.` : "Reward voting and promotion are awaiting activation on this network."}
        </p>
      </Card>
      {policy && <PendingRewards onSettled={() => void refresh()}/>}
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
          <p className="muted">Your votes, rewards, promotions and transfers will appear here.</p>
        ) : (
          activity.map((a, i) => (
            <div className="token-activity" key={a.txId + "-" + i}>
              <strong>
                {a.kind.endsWith("voted") ? `${a.vote?.direction === 2 ? "Downvote" : "Upvote"} · weight ${a.vote?.weight ?? "—"}` : a.kind.endsWith("reward_settled") ? "Reward settled" : a.kind.endsWith("promotion_changed") ? "Promotion updated" : a.kind.endsWith("test_tokens_granted") ? "Tester allocation" : a.kind.endsWith("supported")
                  ? a.recipient === me?.account
                    ? "Support received"
                    : "Supported a post"
                  : a.kind.endsWith("burn")
                  ? "Burned"
                  : a.to === me?.account
                  ? "Received"
                  : "Sent"}
              </strong>
              <span>{typeof a.value === "string" ? `${a.value} OSAT` : a.reward !== undefined ? `${a.reward} OSAT` : a.value?.reward !== undefined ? `${a.value.reward} OSAT` : ""}</span>
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
