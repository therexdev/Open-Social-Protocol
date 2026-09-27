import { useEffect, useState } from "react";
import type { EconomyConfig, IndexedPostEconomy, TokenAccount } from "@osp/sdk";
import { rpc } from "../shared/rpc";
import { tokenResources } from "../../../web/src/features/tokens/resources";
export interface EconomyInspection {
  policy?: EconomyConfig; view?: IndexedPostEconomy; account?: TokenAccount; version: string;
  preview?: string;
  own: boolean; active: boolean; canVote: boolean; ownerAvailable: boolean; slot?: number;
}
/** Runs only in a trusted extension page. Embedded Facebook cards can open it, never sign. */
export function EconomyPanel({ postId, initialDirection = 1 }: { postId: string; initialDirection?: number }) {
  const [data, setData] = useState<EconomyInspection>(), [direction, setDirection] = useState(initialDirection), [weight, setWeight] = useState("1");
  const [opportunities, setOpportunities] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const load = async () => { setData(await rpc<EconomyInspection>("economy.inspect", { postId })); };
  useEffect(() => { void load().catch(e => setError(e.message)); }, [postId]);
  const send = async (kind: "vote" | "promote" | "settle" | "cancel") => {
    if (!data?.policy || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = kind === "vote" ? { postId, version: data.version, direction, weight } : kind === "promote" ? { postId, version: data.version, nonce: (BigInt(data.view?.promotion?.nonce ?? "0") + 1n).toString(), slot: data.slot, opportunities, burnAmount: (BigInt(opportunities) * BigInt(data.policy.promotion_price)).toString() } : kind === "cancel" ? { postId, nonce: data.view!.promotion!.nonce } : { postId };
      await rpc(`economy.${kind}`, payload);
      setMessage("Confirmed on the network."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const resources = tokenResources(data?.account), available = resources.paid / resources.precision;
  const view = data?.view, policy = data?.policy, block = BigInt(view?.block ?? "0");
  const closed = !!view?.epoch && block >= BigInt(view.epoch.end_block);
  const promoActive = !!view?.promotion && !view.promotion.cancelled && BigInt(view.promotion.end_block) > block;
  return <div className="content"><div className="card"><h1>Post tokens</h1><a href={`https://opensocial.online/post/${encodeURIComponent(postId)}`} target="_blank" rel="noopener noreferrer">View this post on Open Social</a>
    {data?.preview !== undefined && <p className="post-text">{data.preview || "This post contains attachments. Open the post above to review them."}</p>}
    {data?.policy && !data.active && <p>This public post is not currently available for voting or promotion. Refresh after the feed has caught up.</p>}
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!data && !error && <p>Checking the current post and balance…</p>}
    {data && !policy && <p>Reward voting and promotions are awaiting activation on this network.</p>}
    {policy && data && <>
      <p>{available.toString()} paid vote capacity · {resources.ready.toString()} fully charged OSAT.</p>
      {!data.own && data.active && <section><h2>Reward vote</h2>
        {view?.vote ? <p>You cast a {view.vote.direction === 1 ? "upvote" : "downvote"} with weight {view.vote.weight}. One final vote per account and post.</p> : closed || view?.reward?.settled || view?.reward && view.reward.version !== data.version ? <p>This post's reward voting window is closed.</p> : !data.canVote ? <p>This browser needs voting permission. In the website's Settings, authorize this device for reward voting, or import your identity file and authorize this browser again. Publishing permissions alone do not permit voting.</p> : <form onSubmit={e => { e.preventDefault(); void send("vote"); }}>
          <label>Direction<select value={direction} disabled={busy} onChange={e => setDirection(Number(e.target.value))}><option value={1}>Upvote</option><option value={2}>Downvote</option></select></label>
          <label>Weight<input type="number" min="1" max={policy.max_vote_weight} step="1" value={weight} disabled={busy} onChange={e => setWeight(e.target.value)}/></label>
          <p>This vote is final. It spends paid capacity only; used tokens recharge over about five days. Downvotes affect pending author rewards.</p>
          <button type="submit" className="primary" disabled={busy || !/^[1-9]\d{0,3}$/.test(weight) || BigInt(weight || "0") > available || BigInt(weight || "0") > BigInt(policy.max_vote_weight)}>{busy ? "Submitting…" : "Confirm vote"}</button>
        </form>}
      </section>}
      {data.own && data.active && <section><h2>Promote your post</h2>
        {!data.ownerAvailable ? <p>Promotion permanently burns tokens and requires your account's owner key. <a href={`https://opensocial.online/post/${encodeURIComponent(postId)}`} target="_blank" rel="noopener noreferrer">Open the website to approve it.</a></p> : promoActive ? <><p>Active until block {view!.promotion!.end_block}.</p><button disabled={busy} onClick={() => void send("cancel")}>Stop promotion (no refund)</button></> : <form onSubmit={e => { e.preventDefault(); void send("promote"); }}>
          <label>Opportunities<select value={opportunities} disabled={busy} onChange={e => setOpportunities(Number(e.target.value))}>{Array.from({length: policy.max_opportunities},(_,i) => i+1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <p>Each {policy.promotion_interval}-block window buys a labeled placement opportunity. No guaranteed views. Burning is permanent; no activity credits are used.</p>
          <button type="submit" className="primary" disabled={busy || data.slot === undefined || resources.ready < BigInt(opportunities) * BigInt(policy.promotion_price)}>Burn {(BigInt(opportunities) * BigInt(policy.promotion_price)).toString()} OSAT and promote</button>
        </form>}
      </section>}
      {view?.reward && <section><h2>Author reward</h2><p>{view.reward.up} up · {view.reward.down} down · {view.epoch?.budget} OSAT shared period budget.</p>{view.reward.settled ? <p>{view.reward.reward} OSAT settled to the author.</p> : <><p>Voting closes at block {view.epoch?.end_block}. Editing or removing the evaluated version before settlement makes its reward zero.</p><button disabled={busy || !closed || !data.canVote} onClick={() => void send("settle")}>Settle author reward</button></>}</section>}
    </>}
    <p><a href={chrome.runtime.getURL("src/sidepanel/index.html")}>Back to the feed</a></p>
  </div></div>;
}
