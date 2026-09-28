import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AUDIENCE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Empty, Notice, Tabs } from "../../components/ui";
import { useVault } from "../../vault/context";
import { hasHashtag, normalizeTag } from "../../util/postText";
import { FeedSkeleton, usePagedPosts } from "./FeedPage";
import { OpenedPostCard } from "./PostCard";
import { usePostContent } from "./usePostContent";
import { usePublishing } from "../composer/PublishingProvider";
import { indexedDraft, PendingPosts } from "../composer/PendingPosts";

type Scope = "all" | "public" | "friends";
type Result = "opening" | "match" | "skip";
const postKey = (post: PostView) => `${post.postId}:${post.contentHash}:${post.state}`;

function TagPost({ post, tag, report, refresh }: { post: PostView; tag: string; report: (key: string, result: Result) => void; refresh: () => void }) {
  const content = usePostContent(post);
  const match = !!content && (content.status === "plain" || content.status === "decrypted") && hasHashtag(content.content.text, tag);
  const result: Result = !content ? "opening" : match ? "match" : "skip";
  useEffect(() => report(postKey(post), result), [post.postId, post.contentHash, post.state, result, report]);
  return match ? <OpenedPostCard post={post} content={content} onChanged={refresh}/> : null;
}

function TagResults({ tag, viewer, scope }: { tag: string; viewer?: string; scope: Scope }) {
  const { indexer } = useServices();
  const publicFeed = usePagedPosts(cursor => scope === "friends"
    ? Promise.resolve({ items: [], nextCursor: null })
    : indexer.feed({ scope: "public", viewer, cursor, limit: 20 }), [indexer, viewer, scope]);
  const friendsFeed = usePagedPosts(cursor => scope === "public" || !viewer
    ? Promise.resolve({ items: [], nextCursor: null })
    : indexer.feed({ scope: "friends", viewer, cursor, limit: 20 }), [indexer, viewer, scope]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const report = useCallback((key: string, result: Result) => {
    setResults(previous => previous[key] === result ? previous : { ...previous, [key]: result });
  }, []);
  const posts = useMemo(() => {
    const unique = new Map<string, PostView>();
    for (const post of [...publicFeed.items, ...friendsFeed.items]) {
      if (post.audience !== AUDIENCE.EVERYONE && post.audience !== AUDIENCE.FRIENDS) continue;
      const previous = unique.get(post.postId);
      if (!previous || previous.versionNumber <= post.versionNumber) unique.set(post.postId, post);
    }
    return [...unique.values()].sort((a, b) => Number(b.createdAt) - Number(a.createdAt) || b.postId.localeCompare(a.postId));
  }, [publicFeed.items, friendsFeed.items]);
  const publishing = usePublishing();
  const pending = publishing.posts.filter(draft => draft.account === viewer && !draft.replyTo &&
    (draft.audience === AUDIENCE.EVERYONE || draft.audience === AUDIENCE.FRIENDS) &&
    (scope !== "public" || draft.audience === AUDIENCE.EVERYONE) && hasHashtag(draft.text, tag));
  const hasPending = pending.some(draft => !indexedDraft(draft, posts));
  const matches = posts.filter(post => results[postKey(post)] === "match").length;
  const opening = posts.some(post => !results[postKey(post)] || results[postKey(post)] === "opening");
  const loading = publicFeed.loading || friendsFeed.loading;
  const more = publicFeed.hasMore || friendsFeed.hasMore;
  const errors = [...new Set([publicFeed.error, friendsFeed.error].filter(Boolean))];
  const refresh = () => { void Promise.all([publicFeed.refresh(true), friendsFeed.refresh(true)]); };
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void Promise.all([publicFeed.refresh(true), friendsFeed.refresh(true)]);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasPending, publicFeed.refresh, friendsFeed.refresh]);
  return <section className="tag-results" aria-label={`Posts tagged #${tag}`}>
    {!viewer && scope !== "public" && <Notice>Unlock your account to include friends-only posts.</Notice>}
    {errors.map(error => <Notice key={error} kind="error">{error}</Notice>)}
    {!indexer.configured && <Empty>Configure an indexer in Settings to load posts.</Empty>}
    <PendingPosts posts={pending} indexed={posts}/>
    <div className="post-list">{posts.map(post => <TagPost key={postKey(post)} post={post} tag={tag} report={report} refresh={refresh}/>)}</div>
    {(loading || opening) && matches === 0 && !hasPending && <FeedSkeleton/>}
    {(loading || opening) && <p className="hint" role="status">Looking for posts with #{tag}…</p>}
    {!loading && !opening && matches === 0 && !hasPending && errors.length === 0 && indexer.configured &&
      <Empty>{more ? `No matches in these recent posts. Search older posts to keep looking for #${tag}.` : `No readable posts with #${tag} found.`}</Empty>}
    <div className="row feed-pagination">
      <Button variant="ghost" disabled={loading} onClick={() => { void Promise.all([publicFeed.refresh(), friendsFeed.refresh()]); }}>Refresh</Button>
      {more && <Button busy={loading || opening} onClick={() => { void Promise.all([publicFeed.more(), friendsFeed.more()]); }}>Search older posts</Button>}
    </div>
  </section>;
}

export function HashtagPage() {
  const { tag: raw = "" } = useParams();
  const tag = normalizeTag(raw);
  const [scope, setScope] = useState<Scope>("all");
  const { resolved } = useServices();
  const account = useVault(s => s.account), status = useVault(s => s.status);
  const viewer = status === "unlocked" ? account : undefined;
  if (!tag) return <div className="page-stack"><h1>Hashtags</h1><Notice>That hashtag is not valid.</Notice><Link to="/">Back to feed</Link></div>;
  return <div className="page-stack hashtag-page">
    <div className="page-header"><div><p className="eyebrow">EXPLORE A TOPIC</p><h1>#{tag}</h1><p className="page-subtitle">Public posts and posts shared with your friends.</p></div><Link className="btn btn-ghost" to="/">Back to feed</Link></div>
    <Tabs<Scope> label="Hashtag feed scope" value={scope} onChange={setScope} options={[{ value: "all", label: "All posts" }, { value: "public", label: "Everyone" }, { value: "friends", label: "Friends" }]}/>
    <TagResults key={`${resolved.chainId}:${viewer ?? "locked"}:${tag}:${scope}`} tag={tag} viewer={viewer} scope={scope}/>
  </div>;
}
