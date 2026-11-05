/** Visible Facebook composer attribution. Native editing commands notify Draft/Lexical and
 * preserve the editor's undo stack; assigning textContent would only change its DOM view. */
import { CONTROL_ATTR, readComposerText, type ComposerAdapter } from "./adapter";

export const ATTRIBUTION_LABEL = "Join Me On Open Social:";
export function attributionText(url: string): string {
  return /^https:\/\/opensocial\.online\/u\/[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(url) ? `${ATTRIBUTION_LABEL} ${url}` : "";
}

function textNodes(editor: HTMLElement): Text[] {
  const walker = editor.ownerDocument.createTreeWalker(editor, 4 /* SHOW_TEXT */);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

function footerRange(editor: HTMLElement, footer: string): Range | undefined {
  const nodes = textNodes(editor);
  const text = nodes.map(node => node.data).join("");
  const index = footer ? text.lastIndexOf(footer) : -1;
  if (index < 0) return;
  let start = index;
  // insertText can represent the leading blank line as text or as paragraph boundaries.
  while (start > 0 && text[start - 1] === "\n" && index - start < 2) start--;
  const end = index + footer.length;
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
  private inserted = "";
  private changing = false;
  constructor(private dialog: HTMLElement, private adapter: ComposerAdapter) {}

  text(): string {
    const text = readComposerText(this.dialog, this.adapter);
    const index = this.inserted ? text.lastIndexOf(this.inserted) : -1;
    return index < 0 ? text : `${text.slice(0, index)}${text.slice(index + this.inserted.length)}`.trim();
  }

  /** Called on Post, never while typing or when auto-checking the control. */
  sync(enabled: boolean, profileUrl = ""): boolean {
    if (this.changing) return false;
    const editor = this.adapter.findTextbox(this.dialog);
    if (!editor) return false;
    const footer = attributionText(profileUrl);
    if (enabled && !footer) return false;
    const current = readComposerText(this.dialog, this.adapter);
    const range = this.inserted ? footerRange(editor, this.inserted) : undefined;
    if (!enabled && !range) { this.inserted = ""; return true; }
    if (enabled && current.trimEnd().endsWith(footer) && footerRange(editor, footer)) return true;
    if (enabled && !this.text()) return true;
    this.changing = true;
    let success = true;
    try {
      if (range) success = edit(editor, range, "");
      if (success) this.inserted = "";
      if (enabled && success) {
        const end = editor.ownerDocument.createRange(); end.selectNodeContents(editor); end.collapse(false);
        success = edit(editor, end, `\n\n${footer}`);
        this.inserted = success && footerRange(editor, footer) ? footer : "";
        success = !!this.inserted;
      }
    } finally { this.changing = false; }
    const host = this.dialog.querySelector(`[${CONTROL_ATTR}]`);
    host?.querySelector('[data-osp-attribution-warning]')?.remove();
    if (!success && host) {
      const warning = editor.ownerDocument.createElement("small");
      warning.setAttribute("data-osp-attribution-warning", ""); warning.setAttribute("role", "status");
      warning.textContent = enabled ? `Facebook did not accept the automatic link. Add it to your draft, then click Post again: ${footer}` : "Remove the Open Social link from the draft if you don't want it included.";
      host.append(warning);
    }
    return success;
  }
}
