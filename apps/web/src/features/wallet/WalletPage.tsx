import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatWalletAmount, parseWalletAmount, walletBalance, walletTransferOperation, type WalletBalance, type WalletToken } from "@osp/sdk";
import { useServices } from "../../api/services";
import { Button, Card, CopyButton, Field, Notice } from "../../components/ui";
import { humanizeError } from "../../tx/submit";
import { useMe, useSession, useSubmitContext } from "../session";
import { checkWalletTransfer, sendWalletTransfer, walletTransferStore, type PendingWalletTransfer, type TransferStore, type WalletReview } from "./walletService";

export function WalletPage() {
  const me = useMe(), { protocol } = useServices();
  return <WalletPanel key={`${protocol?.chainId}:${protocol?.deployment.contracts.token.address}:${me?.account}:${me?.signer.getAddress()}`} />;
}
function WalletPanel() {
  const me = useMe(), session = useSession(), ctx = useSubmitContext(), { protocol, resolved } = useServices();
  const [token, setToken] = useState<WalletToken>("osat"), [balance, setBalance] = useState<WalletBalance>();
  const [to, setTo] = useState(""), [amount, setAmount] = useState(""), [all, setAll] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [review, setReview] = useState<WalletReview>();
  const [store, setStore] = useState<TransferStore>(), [pending, setPending] = useState<PendingWalletTransfer>();
  const running = useRef(false), generation = useRef(0), alive = useRef(true);
  const nativeSymbol = resolved.network === "mainnet" ? "KOIN" : "tKOIN";
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    let cancelled = false;
    if (session && protocol) void walletTransferStore(session, protocol).then(async s => {
      const saved = await s.load();
      if (!cancelled) { setStore(s); setPending(saved); }
    }).catch(e => { if (!cancelled) setError(humanizeError(e)); });
    return () => { cancelled = true; };
  }, [session, protocol]);
  const refresh = useCallback(async () => {
    if (!protocol || !me) return;
    const version = ++generation.current;
    setLoading(true);
    try {
      const next = await walletBalance(protocol, token, me.account, me.signer.getAddress());
      if (alive.current && version === generation.current) setBalance(next);
    } catch (e) {
      if (alive.current && version === generation.current) { setBalance(undefined); setError(humanizeError(e)); }
    } finally { if (alive.current && version === generation.current) setLoading(false); }
  }, [protocol, token, me]);
  useEffect(() => { setBalance(undefined); setReview(undefined); setAmount(""); setAll(false); setError(""); void refresh(); return () => { generation.current++; }; }, [refresh]);
  const changeToken = (value: WalletToken) => { generation.current++; setBalance(undefined); setReview(undefined); setAmount(""); setAll(false); setToken(value); setError(""); };
  const prepare = async () => {
    if (!protocol || !me || !store || pending || running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const saved = await store.load();
      if (saved) { if (alive.current) setPending(saved); throw new Error("A wallet transfer is pending. Check its status first."); }
      const fresh = await walletBalance(protocol, token, me.account, me.signer.getAddress());
      const value = all ? fresh.available : parseWalletAmount(amount, fresh.decimals);
      await walletTransferOperation(protocol, fresh, to.trim(), value);
      if (!alive.current) return;
      setBalance(fresh); setAmount(formatWalletAmount(value, fresh.decimals));
      setReview({ balance: fresh, to: to.trim(), amount: value, all, account: me.account });
    } catch (e) { if (alive.current) setError(humanizeError(e)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!ctx || !review || !store || running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      const id = await sendWalletTransfer(ctx, review, store, p => { if (alive.current) setPending(p); });
      if (!alive.current) return;
      setPending(undefined); setReview(undefined); setAmount(""); setAll(false);
      setNotice(`Sent ${formatWalletAmount(review.amount, review.balance.decimals)} ${review.balance.symbol}. Transaction ${id}`);
      await refresh();
    } catch (e) {
      const saved = await store.load();
      if (alive.current) { setPending(saved); setReview(undefined); setError(humanizeError(e)); }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const check = async () => {
    if (!protocol || !ctx || !pending || !store || running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      const state = await checkWalletTransfer(ctx, pending, store);
      if (!alive.current) return;
      if (state === "pending") setNotice("Confirmation is still pending. This transfer has not been sent again.");
      else {
        setPending(await store.load()); setReview(undefined);
        setNotice(state === "confirmed" ? "Transfer confirmed. The recipient received the tokens." : "The network rejected the transfer. You can review a new transfer.");
        await refresh();
      }
    } catch (e) { if (alive.current) setError(humanizeError(e)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const blocked = busy || Boolean(pending) || !store;
  const symbol = token === "osat" ? "OSAT" : nativeSymbol;
  return <div className="page-stack wallet-page">
    <div><h1>Wallet</h1><p>Send OSAT or {nativeSymbol}. Open Social covers the Mana.</p></div>
    {error && <Notice kind="error">{error}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    {pending && <Card title="Transfer awaiting confirmation">
      <p>{formatWalletAmount(pending.amount, pending.balance.decimals)} {pending.balance.symbol} to <span className="wallet-address">{pending.to}</span></p>
      <p className="hint">Check this transfer before sending another. Refreshing this page will keep its status.</p>
      <p className="wallet-address">{pending.transaction.id}</p>
      <Button onClick={() => void check()} busy={busy}>Check transfer status</Button>
    </Card>}
    <Card title="Your balance" actions={<Button onClick={() => { setError(""); void refresh(); }} disabled={busy || loading || !protocol}>Refresh</Button>}>
      <Field label="Token">{id => <select id={id} value={token} disabled={blocked || Boolean(review)} onChange={e => changeToken(e.target.value as WalletToken)}><option value="osat">OSAT — Open Social action tokens</option><option value="native">{nativeSymbol} — Koinos native token</option></select>}</Field>
      <p className="token-number">{balance ? formatWalletAmount(balance.balance, balance.decimals) : "—"} <small>{symbol}</small></p>
      {balance && <p>{formatWalletAmount(balance.available, balance.decimals)} {symbol} available to send{balance.locked !== "0" ? ` · ${formatWalletAmount(balance.locked, balance.decimals)} ${symbol} recharging` : ""}</p>}
      <p className="hint">Network: {resolved.network}{token === "osat" ? ". Send all includes only fully charged OSAT." : ". Previous Mana use can temporarily lock some tokens. This transfer’s Mana is covered by Open Social."}</p>
      {balance && <div className="wallet-receive"><span className="hint">Your {symbol} address</span><code className="wallet-address">{balance.address}</code><CopyButton text={balance.address} label="Copy address" /></div>}
      {token === "native" && balance && me && balance.address !== me.account && <p className="hint">Native tokens are held by your current signing wallet. Your Open Social profile has a separate address.</p>}
    </Card>
    <Card title={review ? "Review transfer" : "Send tokens"}>
      {review ? <div className="form-stack">
        <p className="token-number">{formatWalletAmount(review.amount, review.balance.decimals)} <small>{review.balance.symbol}</small></p>
        <dl className="wallet-review"><dt>To</dt><dd>{review.to}</dd><dt>From</dt><dd>{review.balance.address}</dd><dt>Network</dt><dd>{resolved.network}</dd><dt>Mana</dt><dd>Covered by Open Social · no transfer fee</dd></dl>
        <div className="button-row"><Button onClick={() => setReview(undefined)} disabled={busy}>Edit</Button><Button variant="primary" onClick={() => void confirm()} busy={busy} disabled={Boolean(pending)}>Confirm send</Button></div>
      </div> : <form className="form-stack" onSubmit={e => { e.preventDefault(); void prepare(); }}>
        <Field label="Recipient address" hint={token === "osat" ? "The recipient must have an Open Social account." : "Enter the recipient’s Koinos wallet address."}>{id => <input id={id} value={to} onChange={e => setTo(e.target.value)} autoComplete="off" spellCheck={false} disabled={blocked}/>}</Field>
        <Field label={`Amount (${symbol})`} hint={token === "osat" ? "Whole OSAT tokens." : "Up to 8 decimal places."}>{id => <div className="wallet-amount"><input id={id} inputMode={token === "osat" ? "numeric" : "decimal"} value={amount} onChange={e => { setAmount(e.target.value); setAll(false); }} disabled={blocked}/><Button disabled={blocked || !balance || loading || balance.available === "0"} onClick={() => { if (balance) { setAmount(formatWalletAmount(balance.available, balance.decimals)); setAll(true); } }}>Send all</Button></div>}</Field>
        <p className="hint">Send all uses the available balance when you review. Mana is provided by the platform. If sponsorship is unavailable, you can try again later; your account will not pay Mana.</p>
        <Button type="submit" variant="primary" busy={busy} disabled={blocked || loading || !balance || balance.available === "0" || !to.trim() || !amount}>Review transfer</Button>
      </form>}
    </Card>
    <p><Link to="/tokens">OSAT activity, rewards and recharge details</Link></p>
  </div>;
}
