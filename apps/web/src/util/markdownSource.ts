import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import { mentionPattern, parseMention } from "./mentions";

/** The portable mention format predates Markdown. Quote its labels for display
 * without changing saved text, code examples, or mentions inside another link. */
export function markdownSource(text: string): string {
  if (!text.includes("](osp:")) return text;
  const protectedRanges: Array<[number, number]> = [];
  const walk = (node: Root | RootContent) => {
    if (node.type === "code" || node.type === "inlineCode" || node.type === "image" || node.type === "imageReference" ||
      node.type === "linkReference" || (node.type === "link" && !node.url.startsWith("osp:"))) {
      if (node.position) protectedRanges.push([node.position.start.offset!, node.position.end.offset!]);
      return;
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(fromMarkdown(text));
  return text.replace(new RegExp(mentionPattern, "gu"), (token: string, _name: string, _account: string, offset: number) => {
    const mention = parseMention(token);
    if (!mention || protectedRanges.some(([start, end]) => start <= offset && end >= offset + token.length)) return token;
    const label = mention.name.replace(/[\\`*{}\[\]()#+\-.!_>~|<&]/g, "\\$&");
    return `@[${label}](osp:${mention.account})`;
  });
}
