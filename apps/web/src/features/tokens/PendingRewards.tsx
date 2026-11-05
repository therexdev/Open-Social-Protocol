import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Card, Notice } from "../../components/ui";
import { humanizeError } from "../../tx/submit";
import { rewardStatus } from "./rewardStatus";

export function PendingRewards({ account, automaticSettlement }: { account: string; automaticSettlement: boolean }) {
  const { indexer } = useServices();
  const [items, setItems] = useState<PostView[]>([]);
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true, running = false;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const posts: PostView[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < pages; i++) {
          const page = await indexer.pendingRewards(account, cursor);
          if (!active) return;
          posts.push(...page.items);
          cursor = page.nextCursor ?? undefined;
          if (!cursor) break;
        }
        setItems(posts);
        setHasMore(!!cursor);
        setError("");
      } catch (e) {
        if (active) setError(humanizeError(e));
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [account, indexer, pages]);

  return <Card title="Pending post rewards">
    {error && <Notice kind="error">{error}</Notice>}
    {!items.length && !error && <p className="muted">{loading ? "Checking post rewards…" : "No pending post rewards."}</p>}
    {items.map(({ postId, economy }) => economy?.reward && <div className="token-activity" key={postId}>
      <Link to={`/post/${postId}`}>Post reward · period {economy.reward.epoch}</Link>
      <span>{economy.reward.up} up · {economy.reward.down} down</span>
      <small>{rewardStatus(economy.reward, automaticSettlement, economy.epoch?.end_block, economy.block)}</small>
    </div>)}
    {hasMore && <Button disabled={loading} onClick={() => setPages(n => n + 1)}>Load more rewards</Button>}
  </Card>;
}
