import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Empty, Notice, Tabs } from "../../components/ui";
import { errorMessage } from "../../util/format";
import { useVault } from "../../vault/context";
import { Icon } from "../../components/Icon";
import { useSwipeTabs } from "../../components/useSwipeTabs";
import { PostCard } from "./PostCard";

type Tab = "public" | "friends";

export function usePagedPosts(load: (cursor?: string) => Promise<{ items: PostView[]; nextCursor: string | null }>, deps: unknown[]) {
  const version = useRef(0);
  const paging = useRef(false);
  const [items, setItems] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const refresh = useCallback(async () => {
    const request = ++version.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await load();
      if (request !== version.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      if (request === version.current) setError(errorMessage(e));
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const more = useCallback(async () => {
    if (!cursor || paging.current) return;
    paging.current = true;
    const request = version.current;
    setLoading(true);
    try {
      const page = await load(cursor);
      if (request !== version.current) return;
      setItems((prev) => [...prev, ...page.items.filter((p) => !prev.some((q) => q.postId === p.postId))]);
      setCursor(page.nextCursor);
    } catch (e) {
      if (request === version.current) setError(errorMessage(e));
    } finally {
      paging.current = false;
      if (request === version.current) setLoading(false);
    }
  }, [cursor, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setItems([]);
    setCursor(null);
    void refresh();
    return () => { version.current++; };
  }, [refresh]);
  useEffect(() => {
    if (!error) return;
    const retry = () => { if (document.visibilityState !== "hidden" && !paging.current) void refresh(); };
    const timer = window.setInterval(retry, 15_000);
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
    };
  }, [error, refresh]);
  return { items, loading, error, refresh, more, hasMore: cursor !== null };
}

export function FeedSkeleton() {
  return <div className="feed-skeleton" role="status" aria-label="Loading posts">{[0, 1, 2].map(i => <div className="post skeleton-card" key={i} aria-hidden="true"><div className="row"><span className="skeleton skeleton-avatar"/><div className="skeleton skeleton-name"/></div><div className="skeleton skeleton-line"/><div className="skeleton skeleton-line short"/><div className="skeleton skeleton-line"/></div>)}</div>;
}

function FeedPanel({ scope, viewer, active }: { scope: Tab; viewer: string | undefined; active: boolean }) {
  const { indexer } = useServices();
  const feed = usePagedPosts(async cursor => {
    if (scope === "friends" && !viewer) return { items: [], nextCursor: null };
    return indexer.feed({ scope, ...(viewer && { viewer }), ...(cursor && { cursor }), limit: 20 });
  }, [indexer, scope, viewer]);
  return <section hidden={!active} role="tabpanel" id={`feed-${scope}`} aria-label={scope === "public" ? "Everyone" : "Friends"} className="feed-panel">
    {scope === "friends" && !viewer && <Notice kind="info">Unlock your account to see posts from your friends.</Notice>}
    {feed.error && <Notice kind="error">{feed.error}</Notice>}
    {!indexer.configured && <Empty>Configure an indexer in Settings to load posts.</Empty>}
    {indexer.configured && !feed.loading && feed.items.length === 0 && !feed.error && !(scope === "friends" && !viewer) && <Empty>{scope === "friends" ? "Nothing from your friends yet. Posts you and your friends publish appear here." : "No posts yet. Be the first to say hello."}</Empty>}
    <div className="post-list">{feed.items.map(post => <PostCard key={`${post.postId}:${post.contentHash}`} post={post} onChanged={() => void feed.refresh()} />)}</div>
    {feed.loading && feed.items.length === 0 && <FeedSkeleton/>}
    <div className="row feed-pagination"><Button variant="ghost" onClick={() => void feed.refresh()} disabled={feed.loading}><Icon name="refresh"/> {feed.loading && feed.items.length > 0 ? "Refreshing…" : "Refresh"}</Button>{feed.hasMore && <Button onClick={() => void feed.more()} busy={feed.loading}>Load more</Button>}</div>
  </section>;
}

export function FeedPage() {
  const account = useVault(s => s.account);
  const status = useVault(s => s.status);
  const viewer = status === "unlocked" ? account : undefined;
  const [tab, setTab] = useState<Tab>("public");
  const [direction, setDirection] = useState(1);
  const changeTab = (next: Tab) => { setDirection(next === "friends" ? 1 : -1); setTab(next); };
  const swipe = useSwipeTabs(direction => changeTab(direction === 1 ? "friends" : "public"));
  return <div className="page feed-page">
    <div className="page-header"><div><p className="eyebrow">YOUR DAILY CONNECTION</p><h1>Feed</h1><p className="page-subtitle">A little closer to your people.</p></div><Link to="/compose" className="btn btn-primary"><Icon name="plus"/> New post</Link></div>
    <div className="feed-tabs"><Tabs<Tab> value={tab} label="Feed scope" onChange={changeTab} options={[{ value: "public", label: <><Icon name="globe" size={18}/> Everyone</> }, { value: "friends", label: <><Icon name="people" size={18}/> Friends</> }]} /><span className="feed-sort">Latest posts</span></div>
    <div className="feed-panels" style={{ "--feed-enter": `${direction * 12}px` } as CSSProperties} {...swipe} key={viewer ?? "locked"}>
      <FeedPanel scope="public" viewer={viewer} active={tab === "public"}/>
      <FeedPanel scope="friends" viewer={viewer} active={tab === "friends"}/>
    </div>
  </div>;
}
