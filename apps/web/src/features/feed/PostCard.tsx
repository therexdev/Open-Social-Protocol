import { PostEditLink } from "../post/PostEditLink";
import { PollCard } from "../polls/PollCard";
import { PostEconomyActions } from "../tokens/PostEconomyActions";
/** One post in a list or on its page: author, audience, decrypted body, media, reactions. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AUDIENCE, LIFECYCLE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { useSettings } from "../../stores/settings";
import { ReactionPicker } from "./ReactionPicker";
import { toBase64url } from "../../util/bytes";
import { ClipPlayer } from "../media/ClipPlayer";
import { MediaPhoto } from "../../components/MediaPhoto";
import { formatDateTime, timeAgo } from "../../util/format";
import { Avatar, Icon } from "../../components/Icon";
import { AccountLink, Button, Details } from "../../components/ui";
import { useProfileName } from "../profile/useProfileName";
import { usePostContent } from "./usePostContent";
import type { OpenedContent, PostContent } from "../../api/decrypt";
import { RichText } from "../../components/RichText";

export function audienceLabel(audience: number): string {
  if (audience === AUDIENCE.EVERYONE) return "Everyone";
  if (audience === AUDIENCE.FRIENDS) return "Friends";
  return "Selected people";
}

function MediaList({ content }: { content: OpenedContent }) {
  const [shown, setShown] = useState<Record<number, boolean>>({});
  if (!content.media || content.media.length === 0) return null;
  return (
    <ul className="media-list">
      {content.media.map((item, index) => {
        const url = item.locations?.[0];
        if (url?.startsWith("osp-clip://")) return <li key={url} className="media-item"><ClipPlayer media={{
          url, mime: item.mime, size: Number(item.size), contentHash: item.content_hash, altText: item.alt_text,
          ...(item.mediaKey && { encryption: { key: toBase64url(item.mediaKey), nonce: toBase64url(item.nonce) } }),
        }}/></li>;
        const isImage = (item.mime ?? "").startsWith("image/");
        if ((url?.startsWith("ipfs://") || url?.startsWith("osp-photo://")) && isImage) return <li key={url} className="media-item"><MediaPhoto location={url} hash={toBase64url(item.content_hash)} mime={item.mime} alt={item.alt_text} encryption={item.mediaKey ? { key: toBase64url(item.mediaKey), nonce: toBase64url(item.nonce) } : undefined}/></li>;
        return (
          <li key={index} className="media-item">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer noopener">
                {item.alt_text || url}
              </a>
            ) : (
              <span>{item.alt_text || "attachment"}</span>
            )}
            <span className="muted"> {item.mime}{item.size ? `, ${item.size} bytes` : ""}</span>
            {url && isImage && (
              <>
                {" "}
                <Button variant="ghost" onClick={() => setShown((s) => ({ ...s, [index]: !s[index] }))}>
                  {shown[index] ? "Hide image" : "Show image"}
                </Button>
                {shown[index] && <img src={url} alt={item.alt_text || ""} className="media-preview" />}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function PostBody({ content }: { content: PostContent | undefined }) {
  if (!content) return <div className="post-opening" role="status" aria-label="Opening post"><span className="skeleton skeleton-line"/><span className="skeleton skeleton-line short"/></div>;
  switch (content.status) {
    case "plain":
    case "decrypted":
      return (
        <div className="post-body">
          <p className="post-text"><RichText text={content.content.text}/></p>
          <MediaList content={content.content} />
        </div>
      );
    case "tombstone":
      return (
        <p className="post-state">
          This post was deleted by its author. Copies that were already downloaded or seen by others may still exist; the network cannot erase them.
        </p>
      );
    case "hidden":
      return <p className="post-state">The author hid this post.</p>;
    case "unavailable":
      return <p className="post-state">The author marked this post as unavailable{content.reason ? `: ${content.reason}` : "."}</p>;
    case "locked":
    case "no-key":
      return (
        <p className="post-state">
          <Icon name="lock" size={18}/>{" "}
          {content.message}
        </p>
      );
    default:
      return <p className="post-state">{content.message}</p>;
  }
}

export interface PostCardProps {
  post: PostView;
  /** Re-fetch after a reaction. */
  onChanged?: () => void;
  /** On the post page the body is not a link. */
  expanded?: boolean;
}

export function PostCard(props: PostCardProps) {
  const content = usePostContent(props.post);
  return <OpenedPostCard {...props} content={content}/>;
}

/** Reuse verified, locally opened content when a tag result has already read it. */
export function OpenedPostCard({ post, onChanged, expanded = false, content }: PostCardProps & { content: PostContent | undefined }) {
  const name = useProfileName(post.author);
  // A plaintext envelope is by definition an everyone post, whatever the indexer's audience field says.
  const audience = content?.status === "plain" ? AUDIENCE.EVERYONE : post.audience;
  const { resolved } = useServices();
  const muted = useSettings((s) => s.muted.includes(post.author));
  const [showMuted, setShowMuted] = useState(false);
  const deleted = post.state === LIFECYCLE.DELETED;

  if (muted && !showMuted) {
    return (
      <article className="post post-muted">
        <p className="muted">
          Post from a muted account ({name}).{" "}
          <Button variant="ghost" onClick={() => setShowMuted(true)}>
            Show
          </Button>
        </p>
      </article>
    );
  }

  return (
    <article className={`post post-${audience === AUDIENCE.EVERYONE ? "public" : "friends"}`} aria-label={`Post by ${name}`}>
      <header className="post-header">
        <Link to={`/u/${post.author}`} tabIndex={-1} aria-hidden="true"><Avatar account={post.author} name={name}/></Link>
        <div className="post-heading"><AccountLink account={post.author} name={name} className="post-author"/><span className="post-meta"><time dateTime={new Date(Number(post.createdAt) || 0).toISOString()} title={formatDateTime(post.createdAt)}>{timeAgo(post.createdAt)}</time>{post.versionNumber > 1 && !deleted && <> · <Link to={`/post/${post.postId}?history=1`}>Edited</Link></>}{!expanded && <PostEditLink post={post} />}</span></div>
        <span className={`chip chip-${audience === AUDIENCE.EVERYONE ? "public" : "friends"}`}><Icon name={audience === AUDIENCE.EVERYONE ? "globe" : "lock"} size={13}/>{audience === AUDIENCE.EVERYONE ? "Public" : audienceLabel(audience)}</span>
      </header>
      {post.labels.length > 0 && (
        <div className="labels" aria-label="Community labels">
          {post.labels.map((label, i) => (
            <span key={i} className="chip chip-label" title={label.reason || undefined}>
              {label.label}
            </span>
          ))}
        </div>
      )}
      {post.replyTo && !expanded && (
        <p className="muted">
          Reply to <Link to={`/post/${post.replyTo}`}>a post</Link>
        </p>
      )}
      {post.poll && post.state === LIFECYCLE.ACTIVE ? <><PollCard post={post} onChanged={onChanged}/>{(content?.status === "plain" || content?.status === "decrypted") && <MediaList content={content.content}/>}</> : <PostBody content={content} />}
      {post.promoted && <p className="promotion-label"><Icon name="spark" size={14}/> Promoted · paid for by the author</p>}
      <footer className="post-footer">
        <PostEconomyActions post={post} onChanged={onChanged}>
          <ReactionPicker id={post.postId} reactions={post.reactions} disabled={deleted} onChanged={onChanged}/>
          {expanded
            ? <a className="btn btn-ghost engagement-icon" title="Comments" aria-label={`Comments (${post.replyCount})`} href="#post-comments"><Icon name="message" size={18}/>{post.replyCount || ""}</a>
            : <Link className="btn btn-ghost engagement-icon" title="Comments" aria-label={`Comments (${post.replyCount})`} to={`/post/${post.postId}#post-comments`}><Icon name="message" size={18}/>{post.replyCount || ""}</Link>}
        </PostEconomyActions>
        {expanded && (
          <Details summary="Details">
            <dl className="kv">
              <dt>Post id</dt>
              <dd className="mono">{post.postId}</dd>
              <dt>Transaction</dt>
              <dd className="mono">{post.txId}</dd>
              <dt>Block</dt>
              <dd>{post.blockHeight}</dd>
              <dt>Network</dt>
              <dd>{resolved.network}</dd>
            </dl>
          </Details>
        )}
      </footer>
    </article>
  );
}
