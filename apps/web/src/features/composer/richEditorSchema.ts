import { Node, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { isAddress } from "@osp/sdk";
import { encodeMention, mentionName, mentionPattern, parseMention } from "../../util/mentions";

export const safeEditorLink = (url: string) => !/[\u0000-\u0020\\]/.test(url) && (/^(https?:\/\/|mailto:)/i.test(url) || /^\/(?!\/)/.test(url) || url.startsWith("#"));
const pattern = new RegExp(`^${mentionPattern}`, "u");
export const OspMention = Node.create({
  name: "ospMention", group: "inline", inline: true, atom: true, selectable: false,
  addAttributes: () => ({ account: { default: "" }, label: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-osp-mention]", getAttrs: el => {
    const account = el.getAttribute("data-osp-mention") ?? "";
    return isAddress(account) ? { account, label: mentionName(el.getAttribute("data-label") ?? "", account) } : false;
  } }],
  renderHTML: ({ node }) => ["span", { "data-osp-mention": node.attrs.account, "data-label": node.attrs.label, class: "editor-mention" }, `@${node.attrs.label}`],
  renderText: ({ node }) => `@${node.attrs.label}`,
  markdownTokenizer: { name: "ospMention", level: "inline", start: src => src.indexOf("@["), tokenize: src => {
    const match = pattern.exec(src), mention = match && parseMention(match[0]);
    return mention ? { type: "ospMention", raw: match![0], account: mention.account, label: mention.name } : undefined;
  } },
  parseMarkdown: token => ({ type: "ospMention", attrs: { account: token.account, label: token.label } }),
  renderMarkdown: node => encodeMention(node.attrs!.label, node.attrs!.account),
});
export function richEditorExtensions() {
  return [StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: safeEditorLink }, trailingNode: false }),
    TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }), OspMention,
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } })];
}
export const emptyRichDocument = (): JSONContent => ({ type: "doc", content: [{ type: "paragraph" }] });
