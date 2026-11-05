import { VideoSection } from "../media/VideoSection";
import { MusicSection } from "../music/MusicSection";
import { PhotoGallery, CollectionList } from "../library/LibraryPages";
/** Own or others' profile: name and bio from the profile document, posts, relationship actions. */
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useServices } from "../../api/services";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileImage } from "./ProfileImage";
import { Avatar, Icon } from "../../components/Icon";
import { Button, Card, CopyButton, Empty, Notice, Spinner, Tabs } from "../../components/ui";
import { QuickComposer } from "../../components/QuickComposer";
import { shortAddress } from "../../util/format";
import { useVault } from "../../vault/context";
import { PostCard } from "../feed/PostCard";
import { usePagedPosts } from "../feed/FeedPage";
import { RelationshipActions, useGraph } from "../friends/RelationshipActions";
import { useCanAct } from "../session";
import { useProfileInfo } from "./useProfileName";

export function ProfilePage() {
  const { account = "" } = useParams();
  const [search] = useSearchParams();
  const requestedTab = search.get("tab");
  const { indexer } = useServices();
  const me = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const viewer = status === "unlocked" ? me : undefined;
  const info = useProfileInfo(account);
  const can = useCanAct();
  const { graph, refresh } = useGraph(viewer);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"posts" | "about" | "photos" | "groups" | "music" | "videos">("posts");
  const [mobileTabs, setMobileTabs] = useState(() => window.matchMedia?.("(max-width: 700px)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 700px)"); if (!query) return;
    const changed = () => setMobileTabs(query.matches);
    query.addEventListener("change", changed); return () => query.removeEventListener("change", changed);
  }, []);
  const tabOrder: typeof tab[] = mobileTabs ? ["posts", "groups", "about", "photos", "music", "videos"] : ["posts", "photos", "music", "videos", "groups", "about"];
  const posts = usePagedPosts((cursor) => indexer.accountPosts(account, { ...(cursor && { cursor }), ...(viewer && { viewer }), limit: 20 }), [indexer, account, viewer]);
  const mine = me === account;
  const view = info?.view;

  useEffect(() => {
    setEditing(false);
    setTab(requestedTab === "videos" || requestedTab === "music" ? requestedTab : "posts");
  }, [account, requestedTab]);

  return (
    <div className="page profile-page">
      <Card className="profile-card">
        <div className="profile-cover" aria-hidden="true">{info?.document?.banner_photo_hash?.length === 32 && <ProfileImage banner account={account} document={info.document}/>}</div>
        <div className="profile-header">
          <div className="profile-identity">
            <Avatar account={account} name={info?.displayName} large/>
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
              <Button onClick={() => setEditing((v) => !v)} disabled={!can.ok || !view} title={can.ok ? undefined : can.reason}>
                <Icon name={editing ? "close" : "edit"} size={17}/>{editing ? "Close" : "Edit profile"}
              </Button>
            ) : (
              <div className="profile-contact-actions">
                {viewer && !graph?.blocked.includes(account) && <Link to={`/messages?to=${encodeURIComponent(account)}`} className="btn btn-primary"><Icon name="message" size={18} />Message</Link>}
                <RelationshipActions target={account} graph={graph} onChanged={() => void refresh()} />
              </div>
            )}
          </div>
        </div>
        {editing && mine && view && <ProfileEditor key={account} account={account} view={view} onDone={() => setEditing(false)} />}
      </Card>
      <Tabs value={tab} onChange={setTab} label="Profile views" options={tabOrder.map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))}/>
      {tab === "videos" && <VideoSection key={`${account}:${viewer ?? "guest"}`} owner={account}/>}
      {tab === "music" && <MusicSection owner={account}/>}
      {tab === "photos" && <PhotoGallery key={`${account}:${viewer ?? "locked"}`} owner={account}/>}
      {tab === "groups" && <CollectionList key={`${account}:${viewer ?? "locked"}`} kind={2} owner={account}/>}
      {tab === "about" && <Card title={`About ${info?.displayName || shortAddress(account)}`}><p className="profile-about-bio">{info?.bio || "No bio added yet."}</p><p className="hint">Account address</p><p className="mono address">{account}</p><CopyButton text={account} label="Copy address"/></Card>}
      <section className="stack" hidden={tab !== "posts"} aria-label={mine ? "Your posts" : "Posts"}>
      {mine && <QuickComposer account={account} name={info?.displayName}/>}
      {posts.error && <Notice kind="error">{posts.error} <Button onClick={() => void posts.refresh()}>Retry loading posts</Button></Notice>}
      {!posts.loading && !posts.error && posts.items.length === 0 && <Empty>No posts yet.</Empty>}
      <div className="post-list">
        {posts.items.filter(p=>!p.galleryOnly && !p.collectionId).map((post) => (
          <PostCard key={`${post.postId}:${post.contentHash}`} post={post} onChanged={() => void posts.refresh()} />
        ))}
      </div>
      {posts.loading && <Spinner />}
      {posts.hasMore && (
        <Button onClick={() => void posts.more()} disabled={posts.loading}>
          Load more
        </Button>
      )}
      </section>
    </div>
  );
}
