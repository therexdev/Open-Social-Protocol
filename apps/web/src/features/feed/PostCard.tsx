/** One post in a list or on its page: author, audience, decrypted body, media, reactions. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AUDIENCE, LIFECYCLE, REACTION } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { useSettings } from "../../stores/settings";
import { submitAction } from "../../tx/submit";
import { bytesOf } from "../../util/bytes";
import { formatDateTime, timeAgo } from "../../util/format";
import { AccountLink, Button, Details } from "../../components/ui";
import { useProfileName } from "../profile/useProfileName";
import { useCanAct, useSubmitContext } from "../session";
import { usePostContent } from "./usePostContent";
import type { OpenedContent, PostContent } from "../../api/decrypt";

export function audienceLabel(audience: number): string {
  if (audience === AUDIENCE.EVERYONE) return "Everyone";
  if (audience === AUDIENCE.FRIENDS) return "Friends";
  return "Custom audience";
}

function MediaList({ content }: { content: OpenedContent }) {
  const [shown, setShown] = useState<Record<number, boolean>>({});
  if (!content.media || content.media.length === 0) return null;
  return (
    <ul className="media-list">
      {content.media.map((item, index) => {
        const url = item.locations?.[0];
        const isImage = (item.mime ?? "").startsWith("image/");
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
  if (!content) return <p className="muted">Opening…</p>;
  switch (content.status) {
    case "plain":
    case "decrypted":
      return (
        <div className="post-body">
          <p className="post-text">{content.content.text}</p>
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
          <span className="lock" aria-hidden="true">
            🔒
          </span>{" "}
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

export function PostCard({ post, onChanged, expanded = false }: PostCardProps) {
  const name = useProfileName(post.author);
  const content = usePostContent(post);
  // A plaintext envelope is by definition an everyone post, whatever the indexer's audience field says.
  const audience = content?.status === "plain" ? AUDIENCE.EVERYONE : post.audience;
  const can = useCanAct();
  const submit = useSubmitContext();
  const { resolved } = useServices();
  const muted = useSettings((s) => s.muted.includes(post.author));
  const [showMuted, setShowMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const liked = (post.reactions.viewer ?? []).includes(REACTION.LIKE);
  const likes = post.reactions.byType[String(REACTION.LIKE)] ?? post.reactions.total;
  const deleted = post.state === LIFECYCLE.DELETED;

  const react = async () => {
    if (!submit || !can.ok) return;
    setBusy(true);
    try {
      const op = await submit.client.ops.publications.react({ actor: submit.signer.getAddress(), post_id: bytesOf(post.postId), reaction: REACTION.LIKE, remove: liked });
      await submitAction(submit, [op], { label: liked ? "Removing your like" : "Liking the post", success: liked ? "Like removed" : "Liked" });
      onChanged?.();
    } catch {
      // the toast already explains
    } finally {
      setBusy(false);
    }
  };

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
    <article className="post" aria-label={`Post by ${name}`}>
      <header className="post-header">
        <AccountLink account={post.author} name={name} className="post-author" />
        <span className={`chip chip-${audience === AUDIENCE.EVERYONE ? "public" : "friends"}`}>{audienceLabel(audience)}</span>
        <time dateTime={new Date(Number(post.createdAt) || 0).toISOString()} title={formatDateTime(post.createdAt)} className="muted">
          {timeAgo(post.createdAt)}
        </time>
        {post.versionNumber > 1 && !deleted && <span className="muted">edited</span>}
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
      <PostBody content={content} />
      <footer className="post-footer">
        <Button variant="ghost" onClick={react} disabled={!can.ok || deleted} busy={busy} aria-pressed={liked} title={can.ok ? undefined : can.reason}>
          {liked ? "♥" : "♡"} {likes > 0 ? likes : ""} {liked ? "Liked" : "Like"}
        </Button>
        {expanded ? (
          <span className="muted">{post.replyCount} replies</span>
        ) : (
          <Link className="btn btn-ghost" to={`/post/${post.postId}`}>
            {post.replyCount > 0 ? `${post.replyCount} replies` : "Reply"}
          </Link>
        )}
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
