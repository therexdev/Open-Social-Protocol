import { threadFriends } from "./replyAudience";
/** A post with its versions, replies, reactions; edit (new version) and delete (tombstone) for the author. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { AUDIENCE, LIFECYCLE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Card, ConfirmDialog, Empty, Notice, Spinner } from "../../components/ui";
import { submitAction } from "../../tx/submit";
import { bytesOf, toBase64url } from "../../util/bytes";
import { errorMessage } from "../../util/format";
import { useVault } from "../../vault/context";
import { PendingPosts } from "../composer/PendingPosts";
import { usePublishing } from "../composer/PublishingProvider";
import { ComposerForm, type ComposerFormProps } from "../composer/ComposerForm";
import { PostCard } from "../feed/PostCard";
import { usePagedPosts } from "../feed/FeedPage";
import { usePostContent } from "../feed/usePostContent";
import { useCanAct, useSubmitContext } from "../session";
import { RevisionHistory } from "./RevisionHistory";
import { Icon } from "../../components/Icon";
import { posterReference } from "../media/posterReference";

function EditDialog({ post, onDone, onCancel }: { post: PostView; onDone: () => void; onCancel: () => void }) {
  const content = usePostContent(post);
  const text = content && (content.status === "plain" || content.status === "decrypted") ? content.content.text : undefined;
  if (text === undefined) return <Notice kind="info">Open the current version first to edit it.</Notice>;
  const media = content && (content.status === "plain" || content.status === "decrypted") ? content.content.media.map(m => ({
    url: m.locations[0] ?? "",mime: m.mime,size: Number(m.size),contentHash: m.content_hash,altText: m.alt_text,
    videoPoster: posterReference(m),
    ...(m.mediaKey && { encryption: { key: toBase64url(m.mediaKey),nonce: toBase64url(m.nonce) } }),
  })) : [];
  const editor: ComposerFormProps = {
    edit: { postId: post.postId, previousVersion: post.contentHash, versionNumber: post.versionNumber + 1, text, audience: post.audience, media },
    selectedAccounts: content && "content" in content ? content.content.share_with : [],
    collectionId: post.collectionId, galleryOnly: post.galleryOnly, defaultAudience: post.audience,
    compact: true, onSubmitted: onDone, onCancel,
  };
  return (
    <Card title={post.audience===AUDIENCE.CUSTOM ? "Edit post and manage sharing" : "Edit post"}>
      <p className="muted">People see the latest version when they open this post. Earlier versions stay on chain and keep their original reading permissions.</p>
      {post.economy?.reward && !post.economy.reward.settled && (
        <Notice kind="warning">This version has reward votes. Publishing an edit before settlement makes its pending OSAT reward zero and closes voting on this post.</Notice>
      )}
      {post.replyTo && post.audience !== AUDIENCE.EVERYONE
        ? <CommentEdit parentId={post.replyTo} editor={editor}/>
        : <ComposerForm {...editor}/>}
    </Card>
  );
}

function CommentEdit({ parentId, editor }: { parentId: string; editor: ComposerFormProps }) {
  const { indexer } = useServices();
  const viewer = useVault(s => s.session?.identity.account);
  const [parent, setParent] = useState<PostView>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setParent(undefined); setError("");
    void indexer.post(parentId, viewer).then(found => {
      if (!active) return;
      if (found?.postId === parentId && found.state === LIFECYCLE.ACTIVE) setParent(found);
      else setError("The thread for this comment is unavailable.");
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [indexer, parentId, viewer]);
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!parent) return <Spinner label="Checking the thread audience"/>;
  return <PrivateReply post={parent} editor={editor} onSubmitted={editor.onSubmitted!} onCancel={editor.onCancel!}/>;
}

export function PostPage() {
  const { postId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const { indexer } = useServices();
  const publishing = usePublishing();
  const pending = publishing.posts.filter(d => d.replyTo === postId || d.edit?.postId === postId);
  const account = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const viewer = status === "unlocked" ? account : undefined;
  const can = useCanAct();
  const submit = useSubmitContext();
  const requestVersion = useRef(0);
  const [waiting, setWaiting] = useState(false);
  const [post, setPost] = useState<PostView | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<PostView>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replying, setReplying] = useState(false);

  const load = useCallback(async (quiet = false) => {
    const request = ++requestVersion.current;
    if (!quiet) setLoading(true);
    setError(undefined);
    try {
      const found = await indexer.post(postId, viewer);
      if (request !== requestVersion.current) return;
      setPost(found);
      setWaiting(!found);
    } catch (e) {
      if (request === requestVersion.current) setError(errorMessage(e));
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  }, [indexer, postId, viewer]);

  useEffect(() => {
    setEditing(undefined);
    setPost(undefined);
    setWaiting(false);
    void load();
    return () => { requestVersion.current++; };
  }, [load]);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

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

  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") { void load(true); void replies.refresh(true); } }, 3000);
    return () => window.clearInterval(timer);
  }, [hasPending, load, replies.refresh]);
  const loadedPost = post?.postId;
  useEffect(() => {
    if (loadedPost !== postId || hash !== "#post-comments") return;
    setReplying(can.ok);
    document.getElementById("post-comments")?.scrollIntoView?.({ block: "start" });
  }, [hash, loadedPost, postId, can.ok]);
  const mine = post !== undefined && account !== undefined && post.author === account;

  useEffect(() => {
    if (params.get("edit") !== "1" || !post || post.postId !== postId) return;
    if (mine && can.ok && !post.poll && post.state === LIFECYCLE.ACTIVE) setEditing(post);
    const next = new URLSearchParams(params);
    next.delete("edit");
    setParams(next, { replace: true });
  }, [params, post, postId, mine, can.ok, setParams]);

  return (
    <div className="page post-page">
      <Link className="back-link" to="/"><Icon name="back" size={18}/>Back to feed</Link>
      {loading && <Spinner />}
      {waiting && <Notice>This post has not appeared in the feed service yet. Checking automatically… <Button onClick={() => void load()} disabled={loading}>Check now</Button></Notice>}
      {error && <Notice kind="error">{error} <Button onClick={() => void load()} disabled={loading}>Retry</Button></Notice>}
      {post && (
        <>
          <PendingPosts posts={pending.filter(d => !!d.edit)} indexed={[post]}/>
          <PostCard post={post} expanded onChanged={() => void load()} />
          {mine && post.state !== LIFECYCLE.DELETED && (
            <div className="row">
              <Button onClick={() => setEditing(editing ? undefined : post)} disabled={!can.ok || !!post.poll || post.state !== LIFECYCLE.ACTIVE} title={can.ok ? undefined : can.reason}>
                {editing ? "Close editor" : post.poll ? "Poll cannot be edited" : post.audience===AUDIENCE.CUSTOM ? "Edit / manage sharing" : "Edit"}
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={!can.ok} title={can.ok ? undefined : can.reason}>
                Delete
              </Button>
            </div>
          )}
          {mine && post.state === LIFECYCLE.ACTIVE && editing?.postId === post.postId && (
            <EditDialog
              post={editing}
              onDone={() => {
                setEditing(undefined);
                void load(true);
              }}
              onCancel={() => setEditing(undefined)}
            />
          )}
          <ConfirmDialog open={confirmDelete} title="Mark this post as deleted?" confirmLabel="Mark as deleted" danger busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()}>
            <p>
              This records a deletion on the network so clients stop showing the post. It cannot erase the post from the public history or from anyone who
              already read or saved it.
            </p>
          </ConfirmDialog>
          {post.versions.length > 1 && post.state === LIFECYCLE.ACTIVE && (
            <RevisionHistory key={post.postId} post={post} initiallyOpen={params.get("history") === "1"} />
          )}
          <Card className="replies-card" title={<span id="post-comments">Comments</span>} actions={can.ok && post.state !== LIFECYCLE.DELETED ? <Button variant="ghost" aria-label={replying ? "Close comment editor" : "Write a comment"} title={replying ? "Close" : "Comment"} onClick={() => setReplying((v) => !v)}><Icon name={replying ? "close" : "message"} size={18}/></Button> : undefined}>
            {replying && (
              <PrivateReply post={post} onSubmitted={()=>{setReplying(false);void replies.refresh(true);void load(true);}} onCancel={()=>setReplying(false)}/>

            )}
            {replies.error && <Notice kind="error">{replies.error}</Notice>}
            {!replies.loading && replies.items.length === 0 && !pending.some(d => !d.edit) && <Empty>No replies yet.</Empty>}
            <PendingPosts posts={pending.filter(d => !d.edit)} indexed={replies.items}/>
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

function PrivateReply({post,editor,onSubmitted,onCancel}:{post:PostView;editor?:ComposerFormProps;onSubmitted:NonNullable<ComposerFormProps["onSubmitted"]>;onCancel:()=>void}) {
  const opened = usePostContent(post);
  const { protocol, indexer } = useServices();
  const me = useVault(s => s.session?.identity.account);
  const [friends, setFriends] = useState<Awaited<ReturnType<typeof threadFriends>>>();
  const [error, setError] = useState("");
  const fromFriends = post.audience === AUDIENCE.FRIENDS;
  useEffect(() => {
    let active = true;
    setFriends(undefined); setError("");
    if (fromFriends && me && protocol) void threadFriends(protocol, indexer, post.author, me)
      .then(value => { if (active) setFriends(value); })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [fromFriends, post.author, post.contentHash, me, protocol, indexer]);
  if (error) return <Notice kind="error">{error}</Notice>;
  if (post.audience !== AUDIENCE.EVERYONE && opened && !("content" in opened))
    return <Notice>{"message" in opened ? opened.message : "This thread is unavailable."}</Notice>;
  if (post.audience !== AUDIENCE.EVERYONE && (!opened || (fromFriends && !friends)))
    return <Notice>Verifying this private thread’s audience…</Notice>;
  const allowed = friends?.selected ?? (opened && "content" in opened ? [...new Set([post.author, ...(opened.content.share_with ?? [])])] : []);
  const restricted = post.audience !== AUDIENCE.EVERYONE;
  if (editor && restricted && editor.edit?.audience === AUDIENCE.FRIENDS && !(fromFriends && me === post.author)) {
    return <Notice>This older comment used its author’s friends list. Write a new reply to share an update with the current thread readers.</Notice>;
  }
  const selected = editor
    ? (editor.selectedAccounts ?? []).filter(account => !restricted || allowed.includes(account))
    : allowed;
  return <>
    {restricted && <p className="hint">This reply will be encrypted for the readers of this thread.</p>}
    <ComposerForm {...editor} key={post.contentHash} replyTo={post.postId} defaultAudience={editor?.defaultAudience ?? (restricted ? AUDIENCE.CUSTOM : AUDIENCE.EVERYONE)}
      replyGuard={restricted ? { parentHash: post.contentHash, friendsEpoch: friends?.epoch } : undefined}
      selectedAccounts={selected} collectionId={post.collectionId} audienceLocked={restricted}
      compact onSubmitted={onSubmitted} onCancel={onCancel}/>
  </>;
}
