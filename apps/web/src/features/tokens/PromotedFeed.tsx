import { useEffect, useMemo, useRef, useState } from "react";
import { eligiblePromotion, insertPromotions, promotionKey } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { useSettings } from "../../stores/settings";
import { useEconomy } from "./EconomyContext";
import { PostCard } from "../feed/PostCard";

function loadSeen(key: string): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[]); } catch { return new Set(); }
}
function Placement({ post, seen, storageKey, onChanged }: { post: PostView; seen: Set<string>; storageKey: string; onChanged: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!post.promoted || !ref.current) return;
    const record = () => {
      seen.add(promotionKey(post));
      try { sessionStorage.setItem(storageKey, JSON.stringify([...seen].slice(-1000))); } catch { /* memory still caps this feed */ }
    };
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting && document.visibilityState === "visible") { record(); observer.disconnect(); } }, { threshold: 0.5 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [post.postId, post.promoted?.opportunity, post.promoted?.nonce, seen, storageKey]);
  return <div ref={ref}><PostCard post={post} onChanged={onChanged}/></div>;
}
export function PromotedFeed({ items, viewer, scope, active, onChanged }: { items: PostView[]; viewer?: string; scope: string; active: boolean; onChanged: () => void }) {
  const { policy } = useEconomy(), { indexer, protocol, resolved } = useServices(), muted = useSettings(s => s.muted);
  const [promotions, setPromotions] = useState<PostView[]>([]);
  const storageKey = `osp.promotions:${resolved.chainId}:${viewer ?? "guest"}`;
  const seen = useMemo(() => loadSeen(storageKey), [storageKey]);
  // Selecting is stable while scrolling; a view confirmation doesn't pull a card away.
  const [placements, setPlacements] = useState<PostView[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!policy || !protocol || !active || document.visibilityState === "hidden") return;
      try {
        const [page, board] = await Promise.all([indexer.promotions(viewer, scope), protocol.reads.token.get_promotions({})]);
        if (alive && board) setPromotions(page.items.map(post => eligiblePromotion(post, board.values, BigInt(board.block), muted)).filter((p): p is PostView => !!p));
      } catch { if (alive) setPromotions([]); } // Organic feed availability is independent.
    };
    setPromotions([]); void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [indexer, protocol, !!policy, active, viewer, scope, muted]);
  useEffect(() => {
    // Keep already selected, still-valid opportunities in place through polling.
    setPlacements(previous => {
      const keep = previous.filter(p => promotions.some(q => promotionKey(q) === promotionKey(p)) && !muted.includes(p.author));
      const selected = new Map(keep.map(p => [promotionKey(p), p]));
      for (const p of promotions) if (!seen.has(promotionKey(p))) selected.set(promotionKey(p), p);
      return [...selected.values()].slice(0, 2);
    });
  }, [promotions, muted, seen]);
  const rendered = insertPromotions(items, placements, new Set());
  return <div className="post-list">{rendered.map(post => <Placement key={`${post.postId}:${post.contentHash}`} post={post} seen={seen} storageKey={storageKey} onChanged={onChanged}/>)}</div>;
}
