import { CONTROL_ATTR, readComposerText, type ComposerAdapter } from "./adapter";
import { attributionText } from "./attribution";

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const clean = (text: string) => text.replace(/\u200b/g, "");

/** Draft's empty blocks render an extra line in innerText. Read its public block DOM
 * instead, retaining paragraphs without reaching into React or editor internals. */
export function readXText(root: HTMLElement, adapter: ComposerAdapter): string {
  const editor = adapter.findTextbox(root);
  const blocks = editor ? [...editor.querySelectorAll<HTMLElement>('[data-block="true"]')] : [];
  return blocks.length ? blocks.map(block => clean(block.textContent || "")).join("\n").trim()
    : readComposerText(root, adapter);
}

function textNodes(editor: HTMLElement): Text[] {
  const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

/** Selection endpoints must be inside Draft's text leaves, not around the editor
 * element. Let its selection event commit before sending one paste/cut event. */
async function select(editor: HTMLElement, range: () => Range | undefined, valid: () => boolean): Promise<boolean> {
  const doc = editor.ownerDocument;
  editor.focus({ preventScroll: true });
  await pause(50);
  if (!valid()) return false;
  const selected = range(), selection = doc.getSelection();
  if (!selected || !selection) return false;
  selection.removeAllRanges(); selection.addRange(selected);
  doc.dispatchEvent(new Event("selectionchange"));
  await pause(60);
  return valid() && !!selection.anchorNode && editor.contains(selection.anchorNode)
    && !!selection.focusNode && editor.contains(selection.focusNode);
}

export class XAttribution {
  private inserted = "";
  private blocked = false;
  private busy = false;
  private disposed = false;
  private originalBackup?: string;
  constructor(private root: HTMLElement, private adapter: ComposerAdapter) {}

  text(): string {
    const text = readXText(this.root, this.adapter);
    const index = this.inserted ? text.lastIndexOf(this.inserted) : -1;
    return index < 0 ? text : (text.slice(0, index).replace(/\n{1,2}$/, "") + text.slice(index + this.inserted.length)).trim();
  }

  showBackup() {
    if(this.originalBackup === undefined) return;
    const host = this.root.querySelector(`[${CONTROL_ATTR}]`);
    if (host && !host.querySelector('[data-osp-original]')) {
      const label = this.root.ownerDocument.createElement('label');
      label.textContent = 'Original text (copy into a fresh X composer):';
      const backup = this.root.ownerDocument.createElement('textarea');
      backup.setAttribute('data-osp-original', ''); backup.readOnly = true;
      backup.value = this.originalBackup; backup.setAttribute('aria-label', 'Original post text');
      Object.assign(backup.style, { width: '100%', minHeight: '80px', color: '#1b2340', background: '#fff' });
      label.append(backup); host.append(label);
    }
  }

  private fail(original: string): never {
    this.blocked = true;this.originalBackup = original;this.showBackup();
    throw Error('X did not keep the draft intact. No post was sent. Copy the original text below into a fresh composer; automatic insertion is stopped for this draft.');
  }

  async sync(enabled: boolean, profileUrl = '', active: () => boolean = () => true): Promise<boolean> {
    if (this.disposed) return false;
    if (this.blocked) throw Error('Automatic link insertion is stopped for this draft. Copy the saved original text into a fresh X composer.');
    if (this.busy) return false;
    const editor = this.adapter.findTextbox(this.root), doc = this.root.ownerDocument;
    if (!editor) return false;
    const footer = attributionText(profileUrl), before = readXText(this.root, this.adapter), original = this.text();
    if (enabled && !footer) return false;
    if (!enabled && (!this.inserted || !before.includes(this.inserted))) { this.inserted = ''; return true; }
    // Never append again after a host re-render or an author edit following our footer.
    if (enabled && this.inserted && before.includes(this.inserted)) return true;
    if (enabled && before.endsWith(footer)) return true; // Author-supplied footer is not ours to remove.
    if (!before) return false;
    const valid = () => !this.disposed && this.root.isConnected && editor.isConnected && active()
      && readXText(this.root, this.adapter) === before;
    this.busy = true;
    try {
      const ready = await select(editor, () => {
        const nodes = textNodes(editor), last = nodes.at(-1);
        if (!last) return;
        const range = doc.createRange();
        if (enabled) { range.setStart(last, last.length); range.collapse(true); }
        else {
          const flat = nodes.map(node => node.data).join(''), at = flat.lastIndexOf(this.inserted);
          if (at < 0) return;
          let start = at;
          while (start > 0 && at - start < 2 && flat[start - 1] === '\n') start--;
          const point = (offset: number): [Text, number] => {
            for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
            return [last, last.length];
          };
          range.setStart(...point(start)); range.setEnd(...point(at + this.inserted.length));
        }
        return range;
      }, valid);
      if (!ready) return false;
      // Event-local plain text only. No clipboard permission/access, execCommand,
      // replacement DOM, React property probing, or repeated fallback writes.
      const data = new DataTransfer();
      if (enabled) data.setData('text/plain', `\n\n${footer}`);
      editor.dispatchEvent(new ClipboardEvent(enabled ? 'paste' : 'cut', { bubbles: true, cancelable: true, clipboardData: data }));
      const expected = enabled ? `${before}\n\n${footer}` : original;
      // Validate after the controlled editor renders, then once more after a settling
      // interval. Any mismatch stops this draft permanently instead of retrying edits.
      for (const wait of [180, 100]) {
        await pause(wait);
        if (this.disposed || !editor.isConnected) return false;
        if (readXText(this.root, this.adapter) !== expected) return this.fail(original);
      }
      this.inserted = enabled ? footer : '';
      return active();
    } finally { this.busy = false; }
  }

  get failed() { return this.blocked; }
  get editing() { return this.busy; }
  dispose() { this.disposed = true; }
}
