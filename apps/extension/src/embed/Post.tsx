import { Avatar, Icon } from "../../../web/src/components/Icon";
import { useEffect, useState } from "react";
import type { FeedItem } from "../shared/protocol";
import { audienceName, formatTime, safeHttpUrl, shortAddress } from "../shared/format";
import { rpc } from "../shared/rpc";

const SITE = "https://opensocial.online";
type View = { enabled: boolean; item?: FeedItem };

export function PostCard({ item }: { item: FeedItem }) {
  const [images, setImages] = useState<Record<number, boolean>>({});
  const name = item.authorName?.trim() || shortAddress(item.author);
  const postUrl = `${SITE}/post/${encodeURIComponent(item.postId)}`;
  const readable = item.status === "plain" || item.status === "decrypted";
  return <article className="post" aria-label={`Post by ${name}`}>
    <header className="post-header">
      <a href={`${SITE}/u/${encodeURIComponent(item.author)}`} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><Avatar account={item.author} name={name}/></a>
      <div className="post-heading"><a className="post-author" href={`${SITE}/u/${encodeURIComponent(item.author)}`} target="_blank" rel="noopener noreferrer">{name}</a><span className="post-meta"><time title={new Date(Number(item.createdAt)).toLocaleString()}>{formatTime(item.createdAt)}</time>{item.versionNumber > 1 && " · edited"}<a className="osp-source" href={postUrl} target="_blank" rel="noopener noreferrer"> · Open Social ↗</a></span></div>
      <span className={`chip chip-${item.audience === 0 ? "public" : "friends"}`}><Icon name={item.audience === 0 ? "globe" : "lock"} size={13}/>{audienceName(item.audience)}</span>
    </header>
    {item.labels.length > 0 && <div className="labels">{item.labels.map((label) => <span key={`${label.communityId}-${label.label}`} className="chip chip-label" title={label.reason}>{label.label}</span>)}</div>}
    {readable ? <div className="post-body">
      <p className="post-text">{item.text}</p>
      {!!item.media?.length && <ul className="media-list">{item.media.map((media, i) => {
        const url = safeHttpUrl(media.locations?.[0]);
        return <li key={i} className="media-item">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{media.alt_text || "Attachment"}</a> : <span>{media.alt_text || "Attachment"}</span>}
          {url && media.mime?.startsWith("image/") && <><button className="btn btn-ghost" onClick={() => setImages((old) => ({ ...old, [i]: !old[i] }))}>{images[i] ? "Hide image" : "Show image"}</button>{images[i] && <img className="media-preview" src={url} alt={media.alt_text || ""} referrerPolicy="no-referrer" />}</>}
        </li>;
      })}</ul>}
      {safeHttpUrl(item.externalRef) && <a href={item.externalRef} target="_blank" rel="noopener noreferrer">{item.externalRef}</a>}
    </div> : <p className="post-state">{["locked", "no-key"].includes(item.status) && <Icon name="lock" size={18}/>}{item.message || ({ tombstone: "This post was deleted by its author.", hidden: "The author hid this post.", unavailable: "This post is unavailable." } as Record<string, string>)[item.status] || "Open the extension to unlock or refresh this post."}</p>}
    <footer className="post-footer">
      {item.author !== item.viewer && <a className="btn btn-ghost" href={postUrl} target="_blank" rel="noopener noreferrer" title="Support this post on Open Social"><Icon name="spark" size={18}/>Support</a>}
      <a className="btn btn-ghost" href={postUrl} target="_blank" rel="noopener noreferrer" title="Like this post on Open Social"><Icon name="heart" size={18} className={item.liked ? "is-liked" : ""}/> {item.reactions > 0 ? item.reactions : ""} {item.liked ? "Liked" : "Like"}</a>
      <a className="btn btn-ghost" href={postUrl} target="_blank" rel="noopener noreferrer" title="Reply on Open Social"><Icon name="message" size={18}/>{item.replyCount > 0 ? `${item.replyCount} replies` : "Reply"}</a>
    </footer>
  </article>;
}

export function EmbeddedPost() {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    let busy = false;
    let generation = 0;
    let onscreen = true;
    const postId = new URLSearchParams(location.hash.slice(1)).get("post") || "";
    const load = async () => {
      if (busy || !onscreen || document.visibilityState === "hidden") return;
      busy = true;
      const request = generation;
      try {
        const result = await rpc<View>("embed.post", { postId });
        if (alive && request === generation) { setView(result); setError(undefined); }
      } catch { if (alive && request === generation) { setView(undefined); setError("Could not load this post. Retrying…"); } }
      finally { busy = false; if (alive && request !== generation) void load(); }
    };
    // Session changes clear rendered plaintext immediately, before any asynchronous re-fetch.
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && "osp.session" in changes || area === "local" && ("osp.settings" in changes || "osp.vault" in changes)) {
        generation++; setView(undefined); void load();
      }
    };
    chrome.storage.onChanged.addListener(changed);
    const visibility = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => { onscreen = entry?.isIntersecting ?? true; if (onscreen) void load(); }) : undefined;
    visibility?.observe(document.getElementById("root")!);
    const timer = setInterval(() => void load(), 30_000);
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => { alive = false; clearInterval(timer); visibility?.disconnect(); chrome.storage.onChanged.removeListener(changed); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const parentOrigin = new URLSearchParams(location.hash.slice(1)).get("host") || (document.referrer ? new URL(document.referrer).origin : "");
    if (!["https://www.facebook.com", "https://web.facebook.com"].includes(parentOrigin)) return;
    const resize = () => parent.postMessage({ type: "osp.card.height", height: document.getElementById("root")!.getBoundingClientRect().height }, parentOrigin);
    const observer = new ResizeObserver(resize);
    observer.observe(document.getElementById("root")!);
    resize();
    return () => observer.disconnect();
  }, []);
  if (error) return <article className="post"><p className="muted">{error}</p></article>;
  if (!view) return <article className="post"><p className="muted">Opening Open Social post…</p></article>;
  if (!view.enabled) return <article className="post"><p className="muted">Open Social feed is disabled.</p></article>;
  return view.item ? <PostCard item={view.item} /> : <article className="post"><p className="muted">This post is no longer available.</p></article>;
}
