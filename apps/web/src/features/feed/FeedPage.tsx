import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FeedScope, PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Empty, Notice, Spinner, Tabs } from "../../components/ui";
import { errorMessage } from "../../util/format";
import { useVault } from "../../vault/context";
import { PostCard } from "./PostCard";

type Tab = "public" | "friends";

export function usePagedPosts(load: (cursor?: string) => Promise<{ items: PostView[]; nextCursor: string | null }>, deps: unknown[]) {
  const [items, setItems] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await load();
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const more = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await load(cursor);
      setItems((prev) => [...prev, ...page.items.filter((p) => !prev.some((q) => q.postId === p.postId))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [cursor, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { items, loading, error, refresh, more, hasMore: cursor !== null };
}

export function FeedPage() {
  const { indexer } = useServices();
  const account = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const [tab, setTab] = useState<Tab>("public");
  const scope: FeedScope = tab === "friends" ? "friends" : "public";
  const viewer = status === "unlocked" ? account : undefined;
  const feed = usePagedPosts(
    async (cursor) => {
      // The friends scope needs a viewer; without one there is nothing to ask the indexer for.
      if (scope === "friends" && !viewer) return { items: [], nextCursor: null };
      return indexer.feed({ scope, ...(viewer && { viewer }), ...(cursor && { cursor }), limit: 20 });
    },
    [indexer, scope, viewer],
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Feed</h1>
        <Link to="/compose" className="btn btn-primary">
          New post
        </Link>
      </div>
      <Tabs<Tab>
        value={tab}
        label="Feed scope"
        onChange={setTab}
        options={[
          { value: "public", label: "Everyone" },
          { value: "friends", label: "Friends" },
        ]}
      />
      {tab === "friends" && !viewer && <Notice kind="info">Unlock your account to see posts from your friends.</Notice>}
      {feed.error && <Notice kind="error">{feed.error}</Notice>}
      {!indexer.configured && <Empty>Configure an indexer in Settings to load posts.</Empty>}
      {indexer.configured && !feed.loading && feed.items.length === 0 && !feed.error && !(tab === "friends" && !viewer) && (
        <Empty>{tab === "friends" ? "Nothing from your friends yet. Posts you and your friends publish appear here." : "No posts yet. Be the first to say hello."}</Empty>
      )}
      <div className="post-list">
        {feed.items.map((post) => (
          <PostCard key={`${post.postId}:${post.contentHash}`} post={post} onChanged={() => void feed.refresh()} />
        ))}
      </div>
      {feed.loading && <Spinner />}
      <div className="row">
        <Button variant="ghost" onClick={() => void feed.refresh()} disabled={feed.loading}>
          Refresh
        </Button>
        {feed.hasMore && (
          <Button onClick={() => void feed.more()} disabled={feed.loading}>
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
