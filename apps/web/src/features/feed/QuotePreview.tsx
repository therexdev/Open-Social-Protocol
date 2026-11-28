import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AUDIENCE, LIFECYCLE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Avatar, Icon } from "../../components/Icon";
import { AccountLink } from "../../components/ui";
import { timeAgo } from "../../util/format";
import { useProfileName } from "../profile/useProfileName";
import { usePostContent } from "./usePostContent";
import { PostBody } from "./PostCard";

type Quote = { postId: string; version: string };
/** A bounded preview: never recursively open a chain of quoted posts. */
export function QuotePreview({ quote }: { quote: Quote }) {
  const { indexer } = useServices();
  const [source, setSource] = useState<{ key: string; post?: PostView; done: boolean }>();
  const key = `${quote.postId}:${quote.version}`;
  useEffect(() => {
    let live = true;
    let checking = false;
    const refresh = () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      void indexer.post(quote.postId).then(post => {
        if (live) setSource({ key, post: post?.postId === quote.postId && post.audience === AUDIENCE.EVERYONE && !post.collectionId && post.state === LIFECYCLE.ACTIVE ? post : undefined, done: true });
      }).catch(() => { if (live) setSource({ key, done: true }); }).finally(() => { checking = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [indexer, key]);
  const current = source?.key === key ? source : undefined;
  return <section className="quoted-post" aria-label="Shared post">
    <div className="quote-label"><Icon name="share" size={14}/><Link to={`/post/${encodeURIComponent(quote.postId)}`}>Shared post</Link></div>
    {current?.post ? <OpenedQuote key={key} post={current.post} quote={quote}/> : <p className="muted">{current?.done ? "This shared post is unavailable." : "Loading shared post…"}</p>}
  </section>;
}

function OpenedQuote({ post, quote }: { post: PostView; quote: Quote }) {
  const version = post.versions.find(v => v.contentHash === quote.version);
  const content = usePostContent(post, version);
  const name = useProfileName(post.author);
  const known = post.contentHash === quote.version || !!version;
  return <>
    <header className="quote-header"><Avatar account={post.author} name={name}/><div><AccountLink account={post.author} name={name}/><Link className="post-meta" to={`/post/${post.postId}`}>{timeAgo(post.createdAt)}</Link></div></header>
    {known && content?.status === "plain" ? <PostBody content={content}/> : <p className="muted">{!known ? "The original shared version is unavailable." : !content ? "Opening shared post…" : "This shared post could not be verified or is unavailable."}</p>}
    {known && content?.status === "plain" && post.quotePostId && <Link className="hint" to={`/post/${post.quotePostId}`}>View the earlier shared post</Link>}
    {known && post.contentHash !== quote.version && <Link className="hint" to={`/post/${post.postId}`}>Edited since this was shared · view latest</Link>}
    <Link className="quote-open" to={`/post/${post.postId}`}>Open post and comments<Icon name="arrow" size={15}/></Link>
  </>;
}
