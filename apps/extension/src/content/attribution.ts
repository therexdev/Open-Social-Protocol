/** Visible Facebook composer attribution. Native editing commands notify Draft/Lexical and
 * preserve the editor's undo stack; assigning textContent would only change its DOM view. */
import { CONTROL_ATTR, readComposerText, type ComposerAdapter } from "./adapter";

export const ATTRIBUTION_LABEL = "Posted on Open Social";
export const ATTRIBUTION_URL = "https://opensocial.online/about";
export const ATTRIBUTION_TEXT = `${ATTRIBUTION_LABEL}\n${ATTRIBUTION_URL}`;
const footerPattern = /Posted on Open Social\s*https:\/\/opensocial\.online\/about/g;

function textNodes(editor: HTMLElement): Text[] {
  const walker = editor.ownerDocument.createTreeWalker(editor, 4 /* SHOW_TEXT */);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

function footerRange(editor: HTMLElement): Range | undefined {
  const nodes = textNodes(editor);
  const text = nodes.map(node => node.data).join("");
  const match = [...text.matchAll(footerPattern)].at(-1);
  if (!match || match.index === undefined) return;
  let start = match.index;
  // insertText can represent the leading blank line as text or as paragraph boundaries.
  while (start > 0 && text[start - 1] === "\n" && match.index - start < 2) start--;
  const end = match.index + match[0].length;
  const point = (offset: number): [Text, number] => {
    for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
    return [nodes.at(-1)!, nodes.at(-1)!.length];
  };
  const range = editor.ownerDocument.createRange();
  range.setStart(...point(start)); range.setEnd(...point(end));
  return range;
}

/** Change only a selected range through the browser's editing pipeline. No editor internals,
 * page-world script injection, replacement HTML, or clipboard access. */
function edit(editor: HTMLElement, range: Range, text: string): boolean {
  const doc = editor.ownerDocument;
  const selection = doc.getSelection();
  if (!selection || typeof doc.execCommand !== "function") return false;
  const previous = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  const focus = doc.activeElement as HTMLElement | null;
  try {
    editor.focus({ preventScroll: true });
    selection.removeAllRanges(); selection.addRange(range);
    return doc.execCommand(text ? "insertText" : "delete", false, text);
  } catch { return false; }
  finally {
    if (previous?.startContainer.isConnected && previous.endContainer.isConnected) {
      selection.removeAllRanges(); selection.addRange(previous);
    }
    if (focus?.isConnected && focus !== editor) focus.focus({ preventScroll: true });
  }
}

export class ComposerAttribution {
  private inserted = false;
  private changing = false;
  constructor(private dialog: HTMLElement, private adapter: ComposerAdapter) {}

  /** Only remove the footer this controller added, not a link the author wrote themselves. */
  text(): string {
    const text = readComposerText(this.dialog, this.adapter);
    const footer = this.inserted ? [...text.matchAll(footerPattern)].at(-1) : undefined;
    return footer?.index === undefined ? text : `${text.slice(0, footer.index)}${text.slice(footer.index + footer[0].length)}`.trim();
  }

  sync(enabled: boolean): void {
    if (this.changing) return;
    const editor = this.adapter.findTextbox(this.dialog);
    if (!editor) return;
    const current = readComposerText(this.dialog, this.adapter);
    const range = this.inserted ? footerRange(editor) : undefined;
    if (!enabled && !range) { this.inserted = false; return; }
    if (enabled && current.trimEnd().endsWith(ATTRIBUTION_URL) && footerRange(editor)) return;
    // Do not turn an empty composer into a Facebook post consisting only of our link.
    if (enabled && !this.text()) return;
    this.changing = true;
    let success = true;
    try {
      if (range) success = edit(editor, range, "");
      if (success) this.inserted = false;
      if (enabled && success) {
        const end = editor.ownerDocument.createRange(); end.selectNodeContents(editor); end.collapse(false);
        success = edit(editor, end, `\n\n${ATTRIBUTION_TEXT}`);
        // Verify the visible result too: some hosts decline the native edit.
        this.inserted = success && !!footerRange(editor);
        success = this.inserted;
      }
    } finally { this.changing = false; }
    const host = this.dialog.querySelector(`[${CONTROL_ATTR}]`);
    host?.querySelector('[data-osp-attribution-warning]')?.remove();
    if (!success && host) {
      const warning = editor.ownerDocument.createElement("small");
      warning.setAttribute("data-osp-attribution-warning", "");
      warning.setAttribute("role", "status");
      warning.textContent = enabled ? `Facebook did not accept the automatic link. You can add it yourself: ${ATTRIBUTION_URL}` : "Facebook did not remove the Open Social link. Remove it from your draft if you don't want it included.";
      host.append(warning);
    }
  }
}
