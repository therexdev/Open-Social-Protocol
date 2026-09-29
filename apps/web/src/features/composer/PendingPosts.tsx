import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AUDIENCE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { Avatar, Icon } from "../../components/Icon";
import { Button, AccountLink } from "../../components/ui";
import { useSession } from "../session";
import { useProfileName } from "../profile/useProfileName";
import { audienceLabel } from "../feed/PostCard";
import type { DraftRecord } from "../../vault/store";
import { usePublishing } from "./PublishingProvider";
import { removeDraft } from "./drafts";
import { RichText } from "../../components/RichText";
import { MediaPhoto } from "../../components/MediaPhoto";

export function indexedDraft(draft: DraftRecord, posts: PostView[]): boolean {
  return !!draft.publication && posts.some(p => p.postId === draft.publication!.postId &&
    (!draft.edit || p.versionNumber >= draft.edit.versionNumber));
}
function PendingPost({ draft }: { draft: DraftRecord }) {
  const name = useProfileName(draft.account), publishing = usePublishing();
  const [localError, setLocalError] = useState("");
  const failed = draft.state === "failed", unknown = draft.state === "unknown";
  return <article className={`post pending-post ${failed ? "post-needs-attention" : ""}`} aria-label={`Your ${draft.edit ? "edit" : "post"}: ${failed ? "not sent" : draft.state === "published" ? "published" : "posting"}`}>
    <header className="post-header">
      <Avatar account={draft.account} name={name}/>
      <div className="post-heading"><AccountLink account={draft.account} name={name} className="post-author"/>
        <span className="post-meta" role="status">{failed ? "Not sent · saved on this device" : unknown ? "Still confirming · saved on this device" : draft.state === "published" ? "Published · updating your feed" : "Posting…"}</span>
      </div>
      <span className={`chip chip-${draft.audience === AUDIENCE.EVERYONE ? "public" : "friends"}`}><Icon name={draft.audience === AUDIENCE.EVERYONE ? "globe" : "lock"} size={13}/>{audienceLabel(draft.audience)}</span>
    </header>
    {draft.edit && <p className="muted">Your updated post</p>}
    {draft.replyTo && <p className="muted">Reply to <Link to={`/post/${draft.replyTo}`}>a post</Link></p>}
    <div className="post-body"><p className="post-text"><RichText text={draft.text}/></p>
      {draft.media?.map((m,i) => m.url.startsWith("ipfs://") ? <MediaPhoto key={`${m.url}:${i}`} location={m.url} hash={m.contentHash} mime={m.mime} alt={m.altText} encryption={m.encryption}/> : <p key={`${m.url}:${i}`}><a href={m.url} target="_blank" rel="noreferrer noopener">{m.altText || m.url}</a></p>)}
    </div>
    {(failed || unknown) && <footer className="pending-actions">
      <p>{localError || (failed ? draft.lastError : "You can keep browsing. We’re checking whether your post was published.")}</p>
      <div className="row">
        {unknown && <Button variant="ghost" onClick={() => void publishing.check()}>Check status</Button>}
        <Button onClick={() => { setLocalError(""); void publishing.start({ draft }).catch(error => setLocalError(error instanceof Error ? error.message : String(error))); }}>{unknown ? "Try again safely" : "Try again"}</Button>
        {failed && <Link className="btn btn-ghost" to={`/compose?draft=${draft.id}`}>Edit saved post</Link>}
      </div>
    </footer>}
  </article>;
}
export function PendingPosts({ posts, indexed }: { posts: DraftRecord[]; indexed: PostView[] }) {
  const session = useSession();
  useEffect(() => {
    if (!session) return;
    for (const draft of posts) if (draft.state === "published" && indexedDraft(draft, indexed)) void removeDraft(session, draft.id).catch(() => undefined);
  }, [session, posts, indexed]);
  return <div className="post-list pending-posts">{posts.filter(d => !indexedDraft(d, indexed)).map(d => <PendingPost key={d.id} draft={d}/>)}</div>;
}
