import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../../api/services";
import type { PostView } from "../../api/indexer";
import { Icon } from "../../components/Icon";
import { Button, Empty, Notice, Spinner } from "../../components/ui";
import { useVault } from "../../vault/context";
import { usePagedPosts } from "../feed/FeedPage";
import { OpenedPostCard } from "../feed/PostCard";
import { usePostContent } from "../feed/usePostContent";

const version = (post: PostView) => [post.postId, post.contentHash, post.state].join(":");

function VideoPost({ post, report, refresh }: {
  post: PostView;
  report: (id: string, match: boolean) => void;
  refresh: () => void;
}) {
  const opened = usePostContent(post);
  const match = (opened?.status === "plain" || opened?.status === "decrypted") &&
    opened.content.media.some(item => item.mime.startsWith("video/") && item.locations[0]?.startsWith("osp-clip://"));
  const id = version(post);
  useEffect(() => { if (opened) report(id, match); }, [id, opened, match, report]);
  return match ? <OpenedPostCard post={post} content={opened} onChanged={refresh}/> : null;
}

export function VideoSection({ owner }: { owner: string }) {
  const { indexer } = useServices();
  const viewer = useVault(s => s.session?.identity.account);
  const posts = usePagedPosts(cursor => indexer.accountPosts(owner, { viewer, cursor, limit: 20, media: "video" }), [indexer, owner, viewer]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"tiles" | "list">(() => {
    try { return localStorage.getItem("osp.video.view") === "list" ? "list" : "tiles"; } catch { return "tiles"; }
  });
  const report = useCallback((id: string, match: boolean) => {
    setChecked(old => old[id] === match ? old : { ...old, [id]: match });
  }, []);
  const candidates = posts.items.filter(p => !p.replyTo && !p.galleryOnly && (
    p.audience === 0
      ? p.media.some(m => m.mime.startsWith("video/") && m.locations[0]?.startsWith("osp-clip://"))
      : !!viewer
  ));
  const pending = posts.loading || candidates.some(p => checked[version(p)] === undefined);
  const found = candidates.some(p => checked[version(p)] === true);
  return <section className="card video-section" aria-label="Profile videos">
    <div className="music-gallery-toolbar"><h2 className="card-title">Videos</h2>
      {owner === viewer && <Link to="/compose?mode=video" className="btn btn-primary"><Icon name="plus" size={17}/>Add video</Link>}
      <div className="music-view-switch" role="group" aria-label="Video view">
        {(["tiles", "list"] as const).map(mode => <button key={mode} type="button" aria-pressed={mode === view} onClick={() => {
          setView(mode);
          try { localStorage.setItem("osp.video.view", mode); } catch { /* session selection */ }
        }}><Icon name={mode === "tiles" ? "grid" : "list"} size={17}/>{mode === "tiles" ? "Tiles" : "List"}</button>)}
      </div>
    </div>
    {posts.error && <Notice kind="error">{posts.error} <Button onClick={() => void posts.refresh()}>Retry</Button></Notice>}
    <div className={`music-gallery-items music-view-${view}`}>{candidates.map(post =>
      <VideoPost key={version(post)} post={post} report={report} refresh={() => void posts.refresh(true)}/>)}</div>
    {pending && <Spinner label="Checking videos"/>}
    {!pending && !found && !posts.error && <Empty>{posts.hasMore ? "No videos in these recent posts." : "No videos to show yet."}</Empty>}
    {posts.hasMore && <Button disabled={pending} onClick={() => void posts.more()}>Check older posts</Button>}
  </section>;
}
