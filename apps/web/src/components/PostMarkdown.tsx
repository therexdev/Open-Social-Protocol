/** Shared post renderer. Markdown is data: raw HTML is never executed. */
import { memo, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useInRouterContext } from "react-router-dom";
import { isAddress } from "@osp/sdk";
import { splitPostText, tagHref } from "../util/postText";
import type { Root, RootContent, PhrasingContent } from "mdast";
import "./post-markdown.css";

/** Keep the existing social links, but never create nested links or format code. */
function socialLinks() {
  return (tree: Root) => {
    const walk = (node: Root | RootContent) => {
      if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode" || !("children" in node)) return;
      const children: RootContent[] = [];
      for (const child of node.children as RootContent[]) {
        if (child.type !== "text") { walk(child); children.push(child); continue; }
        children.push(...splitPostText(child.value).map((part): PhrasingContent => part.kind === "text"
          ? { type: "text", value: part.text }
          : { type: "link", url: part.kind === "tag" ? tagHref(part.tag) : part.kind === "mention" ? `/u/${part.account}` : part.href,
              children: [{ type: "text", value: part.kind === "mention" ? `@${part.name}` : part.text }] }));
      }
      node.children = children as typeof node.children;
    };
    walk(tree);
  };
}

function safeUrl(url: string): string {
  if (/[\u0000-\u0020\\]/.test(url)) return "";
  if (url.startsWith("osp:")) return isAddress(url.slice(4)) ? `/u/${url.slice(4)}` : "";
  // Restrict link schemes. Inline Markdown images are links, not automatic fetches.
  return /^(?:https?:\/\/|mailto:)/i.test(url) || /^\/(?!\/)/.test(url) || url.startsWith("#") ? url : "";
}

export const PostMarkdown = memo(function PostMarkdown({ text, linkBase = "" }: { text: string; linkBase?: string }) {
  const router = useInRouterContext();
  const linkClass = (href: string) => `text-link${href.startsWith("/u/") ? " mention-link" : href.startsWith("/tags/") ? " hashtag-link" : ""}`;
  const components = useMemo<Components>(() => ({
    a: ({ href, children, title }) => !href ? <>{children}</> : router && href.startsWith("/") && !href.startsWith("//")
      ? <Link className={linkClass(href)} to={href} title={title}>{children}</Link>
      : <a className={linkClass(href)} href={href.startsWith("/") || href.startsWith("#") ? `${linkBase}${href}` : href} title={title} target="_blank" rel="noopener noreferrer ugc">{children}</a>,
    img: ({ src, alt }) => typeof src === "string" && src ? <a className="text-link" href={src.startsWith("/") ? `${linkBase}${src}` : src} target="_blank" rel="noopener noreferrer ugc">{alt || "View image"}</a> : <>{alt}</>,
    // A post heading stays inside the surrounding page's heading hierarchy.
    h1: ({ children }) => <h2 className="markdown-h1">{children}</h2>,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
  }), [router, linkBase]);
  return <div className="post-markdown"><Markdown remarkPlugins={[remarkGfm, socialLinks]} components={components} urlTransform={safeUrl}>{text}</Markdown></div>;
});
