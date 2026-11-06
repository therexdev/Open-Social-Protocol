import { readComposerText, type ComposerAdapter } from "./adapter";
import { EditorAttribution } from "./editorAttribution";

const clean = (text: string) => text.replace(/\u200b/g, "");

/** Draft's empty blocks render an extra line in innerText. Read its public block DOM
 * instead, retaining paragraphs without reaching into React or editor internals. */
export function readXText(root: HTMLElement, adapter: ComposerAdapter): string {
  const editor = adapter.findTextbox(root);
  const blocks = editor ? [...editor.querySelectorAll<HTMLElement>('[data-block="true"]')] : [];
  return blocks.length ? blocks.map(block => clean(block.textContent || "")).join("\n").trim()
    : readComposerText(root, adapter);
}

export class XAttribution extends EditorAttribution {
  constructor(root: HTMLElement, adapter: ComposerAdapter) { super(root, adapter, readXText, "X"); }
}
