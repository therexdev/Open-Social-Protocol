import { useEffect, useRef, useState } from "react";
import { toBase64url, type PostEconomy, type TokenAccount, type Promotion } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Field, Notice } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { bytesOf } from "../../util/bytes";
import { humanizeError, submitAction } from "../../tx/submit";
import { useCanAct, useMe, useSubmitContext } from "../session";
import { tokenResources } from "./resources";
import { useEconomy } from "./EconomyContext";

type Panel = "vote" | "promote" | "reward";
export function PostEconomyActions({ post, onChanged }: { post: PostView; onChanged?: () => void }) {
  const { policy, version } = useEconomy(), me = useMe(), ctx = useSubmitContext(), can = useCanAct(), { protocol } = useServices();
  const [panel, setPanel] = useState<Panel>(), [direction, setDirection] = useState(1), [weight, setWeight] = useState("1");
  const [opportunities, setOpportunities] = useState(1), [view, setView] = useState<PostEconomy>(), [account, setAccount] = useState<TokenAccount>();
  const [board, setBoard] = useState<Promotion[]>([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const own = me?.account === post.author, active = post.audience === 0 && post.state === 0;
  const generation = useRef(0);
  const refresh = async () => {
    const current = generation.current;
    if (!protocol || !me) return;
    const [r, a, b] = await Promise.all([
      protocol.reads.token.get_post_economy({ post_id: bytesOf(post.postId), viewer: me.account }),
      protocol.reads.token.get_account({ account: me.account }),
      panel === "promote" ? protocol.reads.token.get_promotions({}) : Promise.resolve(undefined),
    ]);
    if (current !== generation.current) return;
    setView(r); setAccount(a?.value); if (b) setBoard(b.values);
  };
  useEffect(() => {
    const current = ++generation.current;
    let alive = true;
    if (panel) {
      setView(undefined); setAccount(undefined); setError("");
      setLoading(true);
      void refresh().catch(e => { if (alive) setError(humanizeError(e)); }).finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; if (generation.current === current) generation.current++; };
  }, [panel, protocol, me?.account, post.postId]); // Contract checks the approved version and current capacity atomically.
  const perform = async (kind: "support" | "vote" | "promote" | "cancel" | "settle") => {
    if (!ctx || !me || !can.ok || busy) return;
    setBusy(true); setError("");
    try {
      const id = bytesOf(post.postId);
      const actor = me.account;
      let op, label, success;
      if (kind === "support") {
        op = await ctx.client.ops.token.support({ actor, post_id: id }); label = "Supporting this post"; success = "Support recorded";
      } else if (kind === "vote") {
        if (!/^[1-9]\d{0,3}$/.test(weight) || !policy || BigInt(weight) > BigInt(policy.max_vote_weight)) throw new Error("Choose a positive whole vote weight within the displayed limit.");
        op = await ctx.client.ops.token.vote({ actor, post_id: id, version: bytesOf(post.contentHash), direction, weight });
        label = direction === 1 ? "Recording your upvote" : "Recording your downvote"; success = "Vote confirmed. Used capacity is recharging.";
      } else if (kind === "settle") {
        op = await ctx.client.ops.token.settle_reward({ actor, post_id: id }); label = "Settling the post reward"; success = "Reward settled to the author";
      } else if (kind === "cancel") {
        if (!view?.promotion) throw new Error("Refresh this promotion first.");
        op = await ctx.client.ops.token.cancel_promotion({ actor, post_id: id, nonce: view.promotion.nonce }); label = "Stopping promotion"; success = "Promotion stopped. Burned tokens are not refunded.";
      } else {
        if (!policy || !view) throw new Error("Refresh the promotion before purchasing.");
        const slot = Array.from({ length: policy.promotion_slots }, (_, i) => i).find(i => !board.some(p => p.slot === i && !p.cancelled && BigInt(p.end_block) > BigInt(view.block)));
        if (slot === undefined) throw new Error("All promotion slots are occupied. Try again after a campaign ends.");
        op = await ctx.client.ops.token.promote({ actor, post_id: id, version: bytesOf(post.contentHash), nonce: (BigInt(view.promotion?.nonce ?? "0") + 1n).toString(), slot, opportunities, burn_amount: (BigInt(opportunities) * BigInt(policy.promotion_price)).toString() });
        label = "Purchasing promotion"; success = "Promotion confirmed. Your post is eligible for labeled feed placement.";
      }
      setPanel(undefined);
      await submitAction(ctx, [op], { label, success, waitForReceipt: true, quietProgress: true });
      if (kind !== "support") await refresh();
      onChanged?.();
    } catch (e) { setError(humanizeError(e)); }
    finally { setBusy(false); }
  };
  if (version === 0) return !own && me ? <Button variant="ghost" disabled={!can.ok || post.state !== 0 || busy} onClick={() => void perform("support")}><Icon name="spark" size={18}/>Support</Button> : null;
  if (!policy || !me) return null;
  const reward = view?.reward ?? post.economy?.reward;
  const ballot = view?.vote ?? post.economy?.vote;
  const epoch = view?.epoch ?? post.economy?.epoch;
  const block = BigInt(view?.block ?? post.economy?.block ?? "0");
  const closed = !!epoch && block >= BigInt(epoch.end_block);
  const versionChanged = !!view?.reward && toBase64url(view.reward.version) !== post.contentHash;
  const { paid, precision, ready } = tokenResources(account);
  const available = paid / precision;
  const promo = view?.promotion;
  const promoted = !!promo && !promo.cancelled && BigInt(promo.end_block) > block;
  const cost = BigInt(opportunities) * BigInt(policy.promotion_price);
  return <div className="post-economy">
    <div className="row">
      {active && !own && <><Button variant="ghost" disabled={!can.ok || busy} aria-pressed={ballot?.direction === 1} onClick={() => { setDirection(1); setPanel("vote"); }}><Icon name="up" size={18}/>Upvote{reward ? ` ${reward.up}` : ""}</Button>
        <Button variant="ghost" disabled={!can.ok || busy} aria-pressed={ballot?.direction === 2} onClick={() => { setDirection(2); setPanel("vote"); }}><Icon name="down" size={18}/>Downvote{reward ? ` ${reward.down}` : ""}</Button></>}
      {active && own && <Button variant="ghost" disabled={!can.ok || busy} onClick={() => setPanel("promote")}><Icon name="spark" size={18}/>Promote</Button>}
      {reward && <Button variant="ghost" disabled={busy} onClick={() => setPanel("reward")}>{reward.settled ? `${reward.reward} OSAT rewarded` : "Reward details"}</Button>}
    </div>
    {busy && <p className="economy-saving" role="status">Saving… You can keep browsing.</p>}
    {!panel && error && <Notice kind="error">{error}</Notice>}
    {panel && <div className="economy-panel">
      <div className="row row-between"><strong>{panel === "vote" ? "Reward vote" : panel === "promote" ? "Promote this post" : "Author reward"}</strong><Button variant="ghost" aria-label="Close token action" disabled={busy} onClick={() => setPanel(undefined)}><Icon name="close" size={16}/></Button></div>
      {error && <Notice kind="error">{error}</Notice>}
      {loading && <p role="status">Checking the current balance and post…</p>}
      {!loading && view && <>
        {panel === "vote" && (ballot ? <p>Your {ballot.direction === 1 ? "upvote" : "downvote"} used {ballot.weight} paid capacity. Each account can vote once per post; votes cannot be changed.</p> : closed || versionChanged || reward?.settled ? <p>This post's reward voting window is closed.</p> : <form className="form-stack" onSubmit={e => { e.preventDefault(); void perform("vote"); }}>
          <p>{available.toString()} paid vote capacity available. Free credits cannot fund votes. Used tokens recharge over about five days, and settlement does not unlock them.</p>
          <Field label="Direction">{id => <select id={id} value={direction} disabled={busy} onChange={e => setDirection(Number(e.target.value))}><option value={1}>Upvote</option><option value={2}>Downvote</option></select>}</Field>
          <Field label={`Weight (1–${policy.max_vote_weight})`}>{id => <input id={id} type="number" min="1" max={policy.max_vote_weight} step="1" value={weight} disabled={busy} onChange={e => setWeight(e.target.value)}/>}</Field>
          <p className="muted">This vote is final. Downvotes affect pending rewards; they do not take tokens from the author.</p>
          <Button type="submit" variant="primary" busy={busy} disabled={!can.ok || !/^[1-9]\d{0,3}$/.test(weight) || BigInt(weight || "0") > available}>Confirm {direction === 1 ? "upvote" : "downvote"}</Button>
        </form>)}
        {panel === "promote" && (promoted ? <><p>Promotion runs until block {promo!.end_block}. Original post dates and reward eligibility stay unchanged.</p><Button busy={busy} disabled={!can.ok} onClick={() => void perform("cancel")}>Stop promotion (no refund)</Button></> : <form className="form-stack" onSubmit={e => { e.preventDefault(); void perform("promote"); }}>
          <p>{ready.toString()} fully charged OSAT available. Each opportunity is a {policy.promotion_interval}-block window (about an hour) for labeled placement in participating feeds. Views are not guaranteed.</p>
          <Field label="Promotion opportunities">{id => <select id={id} value={opportunities} disabled={busy} onChange={e => setOpportunities(Number(e.target.value))}>{Array.from({ length: policy.max_opportunities }, (_, i) => i + 1).map(n => <option value={n} key={n}>{n}</option>)}</select>}</Field>
          <p>Burning permanently removes {cost.toString()} OSAT and its future capacity. No activity credits are used.</p>
          <Button type="submit" variant="primary" busy={busy} disabled={!can.ok || ready < cost}>Burn {cost.toString()} OSAT and promote</Button>
        </form>)}
        {panel === "reward" && reward && <>
          <p>{reward.up} up · {reward.down} down. Period budget: {epoch?.budget ?? "—"} OSAT shared across eligible posts.</p>
          <p>{reward.settled ? `Settled: ${reward.reward} OSAT to the author.` : closed ? "Voting has closed. Anyone can settle this reward; it always goes to the recorded author." : `Voting closes at block ${epoch?.end_block}. Pending amounts can change until then.`}</p>
          <p className="muted">Editing or removing the evaluated version before settlement makes its reward zero. Rounding and ineligible rewards remain unissued.</p>
          {!reward.settled && <Button busy={busy} disabled={!can.ok || !closed} onClick={() => void perform("settle")}>Settle author reward</Button>}
        </>}
      </>}
    </div>}
  </div>;
}
