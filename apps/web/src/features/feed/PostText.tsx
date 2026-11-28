import { useLayoutEffect, useRef, useState } from "react";
import { PostMarkdown } from "../../components/PostMarkdown";

export function PostText({ text, expanded = false }: { text: string; expanded?: boolean }) {
  const [show, setShow] = useState(false), [overflow, setOverflow] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const shortened = text.length > 800, collapsed = !expanded && !show;
  let preview = text.slice(0, 600);
  const boundary = Math.max(preview.lastIndexOf(" "), preview.lastIndexOf("\n"));
  if (boundary > 500) preview = preview.slice(0, boundary);
  if (/[\uD800-\uDBFF]$/.test(preview)) preview = preview.slice(0, -1);
  useLayoutEffect(() => {
    if (!collapsed || !body.current) return;
    const node = body.current, measure = () => setOverflow(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(node); return () => observer?.disconnect();
  }, [text, collapsed]);
  return <><div ref={body} className={`post-text${collapsed ? " post-text-preview" : ""}`}><PostMarkdown text={collapsed && shortened ? `${preview}…` : text}/></div>
    {collapsed && (shortened || overflow) && <button type="button" className="btn btn-ghost" onClick={() => setShow(true)}>Read more</button>}
    {show && !expanded && <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Show less</button>}</>;
}
