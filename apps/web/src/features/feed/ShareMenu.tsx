import { copyText } from "../../util/clipboard";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { PostView } from "../../api/indexer";
import { Button } from "../../components/ui";
import { Icon } from "../../components/Icon";

export function postPermalink(postId: string): string {
  return `https://opensocial.online/post/${encodeURIComponent(postId)}`;
}

/** Copying a link is available to guests and for private posts; access stays unchanged. */
export function ShareMenu({ post, canQuote }: { post: PostView; canQuote: boolean }) {
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), id = useId();
  const close = () => { setPosition(undefined); trigger.current?.querySelector("button")?.focus(); };
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(window.innerWidth - 248, rect.left)), top: rect.bottom + 138 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 132) });
  };
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLElement>('a, button')?.focus();
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(undefined); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('a, button') ?? []);
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
    };

    document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside); document.addEventListener("keydown", keydown);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", keydown); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [!!position]);
  return <div className="share-control" ref={trigger}>
    <Button variant="ghost" className="engagement-icon" aria-label="Share post" title="Share" aria-expanded={!!position} aria-controls={id}
      onClick={() => {
        if (position) { close(); return; }
        setMessage(""); place();
      }}><Icon name="share" size={18}/></Button>
    {position && createPortal(<div className="share-menu" id={id} ref={menu} style={position} aria-label="Share this post">
      {canQuote ? <Link to={`/compose?quote=${encodeURIComponent(post.postId)}&version=${encodeURIComponent(post.contentHash)}`} onClick={() => setPosition(undefined)}><Icon name="share" size={18}/>Share to Open Social</Link>
        : <p className="hint">Only public posts can be quoted. A private link keeps its reading permissions.</p>}
      <button type="button" onClick={() => {
        void copyText(postPermalink(post.postId)).then(() => { setMessage("Link copied"); close(); }, () => { setMessage("Could not copy the link. Open the post and copy its address."); close(); });
      }}><Icon name="link" size={18}/>Copy Link</button>
    </div>, document.body)}
    <span className="share-status" role="status">{message}</span>
  </div>;
}
