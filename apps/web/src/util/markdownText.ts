import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import { markdownSource } from "./markdownSource";
/** Visible words for accessible labels and poll validation, without formatting tokens. */
export function markdownText(source: string): string {
  const read = (node: Root | RootContent): string => {
    if ("value" in node && typeof node.value === "string") return node.value;
    if (node.type === "image") return node.alt ?? "";
    if ("children" in node) return node.children.map(read).join(["root","list","listItem","blockquote"].includes(node.type) ? "\n" : "");
    return "";
  };
  return read(fromMarkdown(markdownSource(source)));
}
