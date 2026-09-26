/** Own or others' profile: name and bio from the profile document, posts, relationship actions. */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useServices } from "../../api/services";
import { buildProfileDocument, PROFILE_URI_MAX_CHARS } from "../../api/profiles";
import { Avatar, Icon } from "../../components/Icon";
import { Button, Card, CopyButton, Empty, Field, Notice, Spinner } from "../../components/ui";
import { useProfiles } from "../../stores/profiles";
import { submitAction } from "../../tx/submit";
import { shortAddress } from "../../util/format";
import { useVault } from "../../vault/context";
import { PostCard } from "../feed/PostCard";
import { usePagedPosts } from "../feed/FeedPage";
import { RelationshipActions, useGraph } from "../friends/RelationshipActions";
import { useCanAct, useSubmitContext } from "../session";
import { useProfileInfo } from "./useProfileName";

function ProfileEditor({ account, name, bio, onDone }: { account: string; name: string; bio: string; onDone: () => void }) {
  const ctx = useSubmitContext();
  const { indexer } = useServices();
  const load = useProfiles((s) => s.load);
  const [displayName, setDisplayName] = useState(name);
  const [about, setAbout] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const document = buildProfileDocument({ display_name: displayName.trim(), bio: about.trim() });
  const tooLong = document.uri.length > PROFILE_URI_MAX_CHARS;

  const save = async () => {
    if (!ctx) return;
    setBusy(true);
    setError(undefined);
    try {
      const op = await ctx.client.ops.identity.update_profile({ account, profile_hash: document.hash, profile_uri: document.uri });
      await submitAction(ctx, [op], { label: "Saving your profile", success: "Profile saved" });
      setTimeout(() => void load(indexer, account, true), 1500);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Display name" hint="Your nickname. People can search for this name; it doesn’t have to be unique.">{(id) => <input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} />}</Field>
      <Field label="About you" hint={`${PROFILE_URI_MAX_CHARS - document.uri.length} characters left in the on-chain profile reference. Profiles are public.`}>
        {(id) => <textarea id={id} value={about} onChange={(e) => setAbout(e.target.value)} rows={3} maxLength={300} aria-invalid={tooLong || undefined} />}
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy} disabled={tooLong || !ctx}>
          Save profile
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ProfilePage() {
  const { account = "" } = useParams();
  const { indexer } = useServices();
  const me = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const viewer = status === "unlocked" ? me : undefined;
  const info = useProfileInfo(account);
  const can = useCanAct();
  const { graph, refresh } = useGraph(viewer);
  const [editing, setEditing] = useState(false);
  const posts = usePagedPosts((cursor) => indexer.accountPosts(account, { ...(cursor && { cursor }), ...(viewer && { viewer }), limit: 20 }), [indexer, account, viewer]);
  const mine = me === account;
  const view = info?.view;

  useEffect(() => {
    setEditing(false);
  }, [account]);

  return (
    <div className="page">
      <Card className="profile-card">
        <div className="profile-cover"><span>YOUR PEOPLE. YOUR POSTS. YOURS.</span></div>
        <div className="profile-header">
          <div className="profile-identity">
            <Avatar account={account} name={info?.displayName} large/>
            {mine && <span className="eyebrow">YOUR PROFILE</span>}
            <h1>{info?.displayName || shortAddress(account)}</h1>
            <p className="mono muted address">
              {account} <CopyButton text={account} label="Copy address" />
            </p>
            {info?.bio && <p className="bio">{info.bio}</p>}
            {info && !info.registered && indexer.configured && <p className="muted">This account is not registered on the network (or the indexer has not seen it yet).</p>}
            {view && (
              <div className="profile-stats">{Object.entries(view.counts).map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
            )}
          </div>
          <div>
            {mine ? (
              <Button onClick={() => setEditing((v) => !v)} disabled={!can.ok} title={can.ok ? undefined : can.reason}>
                <Icon name={editing ? "close" : "edit"} size={17}/>{editing ? "Close" : "Edit profile"}
              </Button>
            ) : (
              <RelationshipActions target={account} graph={graph} onChanged={() => void refresh()} />
            )}
          </div>
        </div>
        {editing && mine && <ProfileEditor account={account} name={info?.displayName ?? ""} bio={info?.bio ?? ""} onDone={() => setEditing(false)} />}
      </Card>
      <div className="page-header"><h2>{mine ? "Your posts" : "Posts"}</h2>{mine && <Link to="/compose" className="btn btn-ghost"><Icon name="plus" size={18}/>New post</Link>}</div>
      {posts.error && <Notice kind="error">{posts.error} <Button onClick={() => void posts.refresh()}>Retry loading posts</Button></Notice>}
      {!posts.loading && !posts.error && posts.items.length === 0 && <Empty>No posts yet.</Empty>}
      <div className="post-list">
        {posts.items.map((post) => (
          <PostCard key={`${post.postId}:${post.contentHash}`} post={post} onChanged={() => void posts.refresh()} />
        ))}
      </div>
      {posts.loading && <Spinner />}
      {posts.hasMore && (
        <Button onClick={() => void posts.more()} disabled={posts.loading}>
          Load more
        </Button>
      )}
    </div>
  );
}
