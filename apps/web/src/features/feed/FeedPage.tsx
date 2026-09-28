import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Empty, Notice, Tabs } from "../../components/ui";
import { errorMessage } from "../../util/format";
import { useVault } from "../../vault/context";
import { Icon } from "../../components/Icon";
import { useSwipeTabs } from "../../components/useSwipeTabs";
import { usePublishing } from "../composer/PublishingProvider";
import { PendingPosts } from "../composer/PendingPosts";
import { PromotedFeed } from "../tokens/PromotedFeed";
import { QuickComposer } from "../../components/QuickComposer";
import { useProfileName } from "../profile/useProfileName";

type Tab = "all" | "public" | "friends";

export function usePagedPosts(load: (cursor?: string) => Promise<{ items: PostView[]; nextCursor: string | null }>, deps: unknown[]) {
  const version = useRef(0);
  const paging = useRef(false);
  const [items, setItems] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const refresh = useCallback(async (quiet = false) => {
    if (quiet && paging.current) return;
    const request = ++version.current;
    if (!quiet) setLoading(true);
    setError(undefined);
    try {
      const page = await load();
      if (request !== version.current) return;
      setItems(previous => quiet ? [...page.items, ...previous.filter(p => !page.items.some(n => n.postId === p.postId))] : page.items);
      if (!quiet) setCursor(page.nextCursor);
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
  const publishing = usePublishing();
  const pending = publishing.posts.filter(d => !d.replyTo && (scope !== "public" || d.audience === 0));
  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!active || !hasPending) return;
    const refresh = () => { if (document.visibilityState !== "hidden") void feed.refresh(true); };
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [active, hasPending, feed.refresh]);
  return <section hidden={!active} role="tabpanel" id={`feed-${scope}`} aria-label={scope === "all" ? "All posts" : scope === "public" ? "Public" : "Friends"} className="feed-panel">
    {scope === "friends" && !viewer && <Notice kind="info">Unlock your account to see posts from your friends.</Notice>}
    {feed.error && <Notice kind="error">{feed.error}</Notice>}
    {!indexer.configured && <Empty>Configure an indexer in Settings to load posts.</Empty>}
    {indexer.configured && !feed.loading && feed.items.length === 0 && !hasPending && !feed.error && !(scope === "friends" && !viewer) && <Empty>{scope === "friends" ? "Nothing from your friends yet. Posts you and your friends publish appear here." : "No posts yet. Be the first to say hello."}</Empty>}
    <PendingPosts posts={pending} indexed={feed.items}/>
    <PromotedFeed items={feed.items} viewer={viewer} scope={scope} active={active} onChanged={() => void feed.refresh()}/>
    {feed.loading && feed.items.length === 0 && !hasPending && <FeedSkeleton/>}
    <div className="row feed-pagination"><Button variant="ghost" onClick={() => void feed.refresh()} disabled={feed.loading}><Icon name="refresh"/> {feed.loading && feed.items.length > 0 ? "Refreshing…" : "Refresh"}</Button>{feed.hasMore && <Button onClick={() => void feed.more()} busy={feed.loading}>Load more</Button>}</div>
  </section>;
}

export function FeedPage() {
  const account = useVault(s => s.account);
  const status = useVault(s => s.status);
  const viewer = status === "unlocked" ? account : undefined;
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("feed") === "friends" ? "friends" : params.get("feed") === "public" ? "public" : "all";
  const name = useProfileName(account ?? "");
  const options: Tab[] = ["all", "public", "friends"];
  const [visited, setVisited] = useState<Tab[]>([tab]);
  useEffect(() => { setVisited(previous => previous.includes(tab) ? previous : [...previous, tab]); }, [tab]);
  const [direction, setDirection] = useState(1);
  const changeTab = (next: Tab) => { setDirection(options.indexOf(next) > options.indexOf(tab) ? 1 : -1); setParams(next === "all" ? {} : { feed: next }, { replace: true }); };
  const swipe = useSwipeTabs(direction => { const next = options[options.indexOf(tab) + direction]; if (next) changeTab(next); });
  return <div className="page feed-page">
    <div className="page-header feed-heading"><div><h1>Your <span>people.</span><br className="hero-break"/> Your world.</h1><p className="page-subtitle">Real connections. Conversations that belong to you.</p></div><Link to="/compose" className="btn btn-primary mobile-compose" aria-label="New post"><Icon name="plus"/></Link></div>
    <div className="feed-tabs"><Tabs<Tab> value={tab} label="Feed scope" onChange={changeTab} options={[{ value: "all", label: "All posts" }, { value: "public", label: <><Icon name="globe" size={17}/> Public</> }, { value: "friends", label: <><Icon name="lock" size={17}/> Friends</> }]} /><span className="feed-sort">Most recent</span></div>
    <QuickComposer account={account} name={name}/>
    <div className="feed-panels" style={{ "--feed-enter": `${direction * 12}px` } as CSSProperties} {...swipe} key={viewer ?? "locked"}>
      {options.filter(scope => visited.includes(scope) || scope === tab).map(scope => <FeedPanel key={scope} scope={scope} viewer={viewer} active={tab === scope}/>)}
    </div>
  </div>;
}
