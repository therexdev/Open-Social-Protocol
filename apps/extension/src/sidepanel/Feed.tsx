import { useEffect } from "react";
import { audienceName, formatTime, shortAddress } from "../shared/format";
import type { FeedItem, FeedScope } from "../shared/protocol";
import { usePanel } from "./store";

function Post({ item }: { item: FeedItem }) {
  const unreadable = item.status !== "plain" && item.status !== "decrypted";
  return (
    <article className="post">
      <div className="meta">
        <span title={item.author}>{shortAddress(item.author)}</span>
        <span className="pill">{audienceName(item.audience)}</span>
        <span>{formatTime(item.createdAt)}</span>
        {item.labels.map((label) => (
          <span key={`${label.communityId}-${label.label}`} className="pill warn" title={label.reason}>
            {label.label}
          </span>
        ))}
      </div>
      {unreadable ? <div className="muted">{item.message ?? item.status}</div> : <div className="text">{item.text}</div>}
      {item.externalRef && (
        <div className="ref">
          <a href={item.externalRef} target="_blank" rel="noreferrer noopener">
            {item.externalRef}
          </a>
        </div>
      )}
      <div className="muted">
        {item.reactions} reactions · {item.replyCount} replies
      </div>
    </article>
  );
}

export function Feed() {
  const { feedScope, setFeedScope, feed, loadFeed, status } = usePanel();
  const current = feed[feedScope];

  useEffect(() => {
    if (!current.loaded) void loadFeed(feedScope);
  }, [feedScope, current.loaded, loadFeed]);

  const scopes: FeedScope[] = ["public", "friends"];
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        {scopes.map((scope) => (
          <button key={scope} className={feedScope === scope ? "primary" : ""} onClick={() => setFeedScope(scope)}>
            {scope === "public" ? "Everyone" : "Friends"}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => loadFeed(feedScope, { refresh: true })}>Refresh</button>
      </div>
      {!status?.network.indexerUrl && <div className="notice">No indexer configured: add one in the options page to read the feed.</div>}
      {current.notice && <div className="notice">{current.notice}</div>}
      {current.loaded && current.items.length === 0 && !current.notice && <div className="muted">Nothing here yet.</div>}
      {current.items.map((item) => (
        <Post key={item.postId} item={item} />
      ))}
      {current.nextCursor && <button onClick={() => loadFeed(feedScope, { more: true })}>Load more</button>}
    </div>
  );
}
