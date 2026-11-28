import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import { mentionPattern, parseMention } from "../../util/mentions";
/** Saved Markdown treats HTML as literal text; rich HTML is accepted only via the
 * sanitized clipboard path. Portable mention labels are atomic, including < >. */
export function editorMarkdownSource(text: string) {
  if (!text.includes("<")) return text;
  const mentions = [...text.matchAll(new RegExp(mentionPattern,"gu"))].filter(m => parseMention(m[0])).map(m => [m.index, m.index + m[0].length]);
  const edits: Array<{ from: number; to: number; text: string }> = [];
  const walk = (node: Root | RootContent) => {
    if (node.type === "html" && node.position) {
      const from = node.position.start.offset!, to = node.position.end.offset!;
      if (!mentions.some(([start,end]) => start! <= from && end! >= to)) edits.push({ from, to, text: text.slice(from,to).replace(/[\\`*{}\[\]()#+\-.!_>~|<&]/g,"\\$&") });
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(fromMarkdown(text));
  for (const edit of edits.sort((a,b)=>b.from-a.from)) text = text.slice(0,edit.from)+edit.text+text.slice(edit.to);
  return text;
}
