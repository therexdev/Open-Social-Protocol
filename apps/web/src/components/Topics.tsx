import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useServices } from "../api/services";
import { recentTopics } from "../features/feed/recentTopics";
import { usePublishing } from "../features/composer/PublishingProvider";
import { Icon } from "./Icon";
import { normalizeTag, tagHref } from "../util/postText";

export function Topics() {
  const { indexer, protocol } = useServices(), navigate = useNavigate(), location = useLocation();
  const store = useMemo(() => recentTopics(indexer, protocol), [indexer, protocol]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { posts } = usePublishing();
  const published = posts.filter(p => p.state === "published" && p.audience === 0).map(p => p.id).join(",");
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") void store.refresh(); };
    refresh(); const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus",refresh); window.addEventListener("online",refresh); document.addEventListener("visibilitychange",refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus",refresh); window.removeEventListener("online",refresh); document.removeEventListener("visibilitychange",refresh); };
  }, [store]);
  useEffect(() => { if (published) void store.refresh(true); }, [published, store]);
  useEffect(() => { void store.refresh(); }, [location.pathname, store]);
  return <section className="sidebar-topics" aria-label="Recent public topics"><div className="topics-heading"><h2>Recent topics</h2><button type="button" className="icon-button" aria-label="Refresh topics" title="Refresh topics" onClick={() => void store.refresh(true)}><Icon name="refresh" size={14}/></button></div>
    <form onSubmit={event => { event.preventDefault(); const tag = normalizeTag(String(new FormData(event.currentTarget).get("tag") ?? "").trim()); if (tag) navigate(tagHref(tag)); }}><Icon name="search" size={16}/><input name="tag" aria-label="Search hashtags" placeholder="Search topics" maxLength={64}/></form>
    {snapshot.topics.slice(0,4).map(topic => <Link key={topic.tag} to={tagHref(topic.tag)} title={`Used in ${topic.posts} recent public ${topic.posts === 1 ? "post" : "posts"}`}># <span>{topic.tag}</span></Link>)}
    {!snapshot.topics.length && <p className="hint">{snapshot.loading ? "Finding recent topics…" : snapshot.unavailable ? "Topics are temporarily unavailable." : "No hashtags in recent public posts yet."}</p>}
  </section>;
}
