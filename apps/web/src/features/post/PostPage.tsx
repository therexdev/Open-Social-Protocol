/** A post with its versions, replies, reactions; edit (new version) and delete (tombstone) for the author. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AUDIENCE, LIFECYCLE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Card, ConfirmDialog, Details, Empty, Notice, Spinner } from "../../components/ui";
import { submitAction } from "../../tx/submit";
import { bytesOf } from "../../util/bytes";
import { errorMessage, formatDateTime } from "../../util/format";
import { useVault } from "../../vault/store";
import { ComposerForm } from "../composer/ComposerForm";
import { PostCard } from "../feed/PostCard";
import { usePagedPosts } from "../feed/FeedPage";
import { usePostContent } from "../feed/usePostContent";
import { useCanAct, useSubmitContext } from "../session";

function EditDialog({ post, onDone, onCancel }: { post: PostView; onDone: () => void; onCancel: () => void }) {
  const content = usePostContent(post);
  const text = content && (content.status === "plain" || content.status === "decrypted") ? content.content.text : undefined;
  if (text === undefined) return <Notice kind="info">Open the current version first to edit it.</Notice>;
  return (
    <Card title="Edit post">
      <p className="muted">Edits publish a new version. The previous version stays in the public history.</p>
      <ComposerForm
        edit={{ postId: post.postId, previousVersion: post.contentHash, versionNumber: post.versionNumber + 1, text, audience: post.audience }}
        defaultAudience={post.audience}
        compact
        onPublished={onDone}
        onCancel={onCancel}
      />
    </Card>
  );
}

export function PostPage() {
  const { postId = "" } = useParams();
  const { indexer } = useServices();
  const account = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const viewer = status === "unlocked" ? account : undefined;
  const can = useCanAct();
  const submit = useSubmitContext();
  const [post, setPost] = useState<PostView | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const found = await indexer.post(postId, viewer);
      setPost(found);
      if (!found) setError("This post is not known to the indexer (yet).");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [indexer, postId, viewer]);

  useEffect(() => {
    void load();
  }, [load]);

  const replies = usePagedPosts((cursor) => indexer.replies(postId, { ...(cursor && { cursor }), ...(viewer && { viewer }), limit: 20 }), [indexer, postId, viewer]);

  const remove = async () => {
    if (!submit || !post) return;
    setDeleting(true);
    try {
      const op = await submit.client.ops.publications.set_lifecycle({
        author: submit.signer.getAddress(),
        post_id: bytesOf(post.postId),
        version: bytesOf(post.contentHash),
        state: LIFECYCLE.DELETED,
        reason: "deleted by author",
      });
      await submitAction(submit, [op], { label: "Deleting the post", success: "Post marked as deleted" });
      setConfirmDelete(false);
      await load();
    } catch {
      // toast explains
    } finally {
      setDeleting(false);
    }
  };

  const mine = post !== undefined && account !== undefined && post.author === account;

  return (
    <div className="page">
      <p>
        <Link to="/">← Feed</Link>
      </p>
      {loading && <Spinner />}
      {error && <Notice kind="error">{error}</Notice>}
      {post && (
        <>
          <PostCard post={post} expanded onChanged={() => void load()} />
          {mine && post.state !== LIFECYCLE.DELETED && (
            <div className="row">
              <Button onClick={() => setEditing((v) => !v)} disabled={!can.ok} title={can.ok ? undefined : can.reason}>
                {editing ? "Close editor" : "Edit"}
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={!can.ok} title={can.ok ? undefined : can.reason}>
                Delete
              </Button>
            </div>
          )}
          {editing && (
            <EditDialog
              post={post}
              onDone={() => {
                setEditing(false);
                void load();
              }}
              onCancel={() => setEditing(false)}
            />
          )}
          <ConfirmDialog open={confirmDelete} title="Mark this post as deleted?" confirmLabel="Mark as deleted" danger busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()}>
            <p>
              This records a deletion on the network so clients stop showing the post. It cannot erase the post from the public history or from anyone who
              already read or saved it.
            </p>
          </ConfirmDialog>
          {post.versions.length > 1 && (
            <Details summary={`${post.versions.length} versions`}>
              <ol className="list">
                {post.versions.map((v) => (
                  <li key={v.contentHash} className="list-item">
                    <span>
                      Version {v.versionNumber} · {formatDateTime(v.timestamp)}
                    </span>
                    <span className="mono muted">{v.contentHash.slice(0, 12)}…</span>
                  </li>
                ))}
              </ol>
            </Details>
          )}
          <Card title="Replies" actions={can.ok && post.state !== LIFECYCLE.DELETED ? <Button onClick={() => setReplying((v) => !v)}>{replying ? "Close" : "Reply"}</Button> : undefined}>
            {replying && (
              <ComposerForm
                replyTo={post.postId}
                defaultAudience={post.audience === AUDIENCE.FRIENDS ? AUDIENCE.FRIENDS : AUDIENCE.EVERYONE}
                compact
                onPublished={() => {
                  setReplying(false);
                  void replies.refresh();
                  void load();
                }}
                onCancel={() => setReplying(false)}
              />
            )}
            {replies.error && <Notice kind="error">{replies.error}</Notice>}
            {!replies.loading && replies.items.length === 0 && <Empty>No replies yet.</Empty>}
            <div className="post-list">
              {replies.items.map((reply) => (
                <PostCard key={`${reply.postId}:${reply.contentHash}`} post={reply} onChanged={() => void replies.refresh()} />
              ))}
            </div>
            {replies.loading && <Spinner />}
            {replies.hasMore && (
              <Button onClick={() => void replies.more()} disabled={replies.loading}>
                Load more replies
              </Button>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
