import { readComposerText, type ComposerAdapter } from "./adapter";
import { EditorAttribution } from "./editorAttribution";
export { ATTRIBUTION_LABEL, attributionText } from "./attributionText";

/** Read Lexical's visible paragraph/line-break DOM, including empty paragraphs. A
 * paragraph boundary is one newline, independent of CSS margins and soft wrapping.
 * No framework state or private host APIs are inspected. */
export function readFacebookText(root: HTMLElement, adapter: ComposerAdapter): string {
  const editor = adapter.findTextbox(root);
  if (!editor?.matches('[data-lexical-editor="true"]') || !editor.children.length) return readComposerText(root, adapter);
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeName === "BR") return "\n";
    return [...node.childNodes].map(inline).join("");
  };
  return [...editor.childNodes].map(node => {
    let text = inline(node);
    // Lexical adds a final BR to render an empty paragraph or a trailing line break.
    if (node.lastChild?.nodeName === "BR") text = text.replace(/\n$/, "");
    return text;
  }).join("\n").replace(/\u200b/g, "").trim();
}

export class ComposerAttribution extends EditorAttribution {
  constructor(root: HTMLElement, adapter: ComposerAdapter) { super(root, adapter, readFacebookText, "Facebook"); }
}
