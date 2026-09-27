import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Card, Notice } from "../../components/ui";
import { bytesOf } from "../../util/bytes";
import { humanizeError, submitAction } from "../../tx/submit";
import { useMe, useSubmitContext } from "../session";
export function PendingRewards({ onSettled }: { onSettled: () => void }) {
  const { indexer, protocol } = useServices(), me = useMe(), ctx = useSubmitContext();
  const [items, setItems] = useState<PostView[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (after?: string) => {
    if (!me) return;
    try {
      const page = await indexer.pendingRewards(me.account, after);
      setItems(old => after ? [...old, ...page.items] : page.items); setCursor(page.nextCursor); setError("");
    } catch (e) { setError(humanizeError(e)); }
  }, [indexer, me?.account]);
  useEffect(() => { setItems([]); void load(); }, [load]);
  const settle = async (postId: string) => {
    if (!ctx || !me || !protocol || busy) return;
    setBusy(true); setError("");
    try {
      const id = bytesOf(postId), current = await protocol.reads.token.get_post_economy({ post_id: id });
      if (!current?.reward || current.reward.settled) { setItems(old => old.filter(p => p.postId !== postId)); return; }
      if (!current.epoch || BigInt(current.block) < BigInt(current.epoch.end_block)) throw new Error("Voting is still open for this post.");
      await submitAction(ctx, [await ctx.client.ops.token.settle_reward({ actor: me.account, post_id: id })], { label: "Settling your reward", success: "Reward settled", waitForReceipt: true });
      setItems(old => old.filter(p => p.postId !== postId)); onSettled();
    } catch (e) { setError(humanizeError(e)); }
    finally { setBusy(false); }
  };
  return <Card title="Post rewards">
    {error && <Notice kind="error">{error}</Notice>}
    {!items.length && <p className="muted">No unsettled post rewards. New votes will appear here.</p>}
    {items.map(p => <div className="token-activity" key={p.postId}><Link to={`/post/${p.postId}`}>Post reward · period {p.economy?.reward?.epoch}</Link><span>{p.economy?.reward?.up} up · {p.economy?.reward?.down} down</span><Button busy={busy} disabled={!p.economy?.epoch || BigInt(p.economy.block) < BigInt(p.economy.epoch.end_block)} onClick={() => void settle(p.postId)}>Settle reward</Button></div>)}
    <div className="row"><Button variant="ghost" disabled={busy} onClick={() => void load()}>Refresh rewards</Button>{cursor && <Button disabled={busy} onClick={() => void load(cursor)}>Load more rewards</Button>}</div>
  </Card>;
}
