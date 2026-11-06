import { facebookPostUrl } from "../shared/facebookUrl";

const ROW = '[aria-posinset], [data-pagelet^="FeedUnit_"], [role="article"]';
const MESSAGE = '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"], [data-testid="post_message"]';
const EXCLUDED = '[role="dialog"], [data-osp-feed], [data-osp-control], [data-osp-toast], [data-osp-facebook-publish], [role="complementary"], aside, [hidden], [aria-hidden="true"]';
const normalize = (text: string) => text.replace(/[\u200b-\u200f\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim();
const links = (root: ParentNode) => [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => !a.closest(EXCLUDED));
const rows = (doc: Document) => [...doc.querySelectorAll<HTMLElement>(ROW)].filter(row => !row.closest(EXCLUDED) && !row.parentElement?.closest(ROW));

/** Preserve block boundaries: textContent joins adjacent Facebook paragraph DIVs. */
function renderedText(node: Node): string {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (element.matches('[hidden], [aria-hidden="true"], [data-osp-feed], script, style')) return '';
  if (element.tagName === 'BR') return '\n';
  const text = [...node.childNodes].map(renderedText).join('');
  return /^(DIV|P|LI|SECTION|ARTICLE|H[1-6])$/.test(element.tagName) ? `\n${text}\n` : text;
}
const body = (row: HTMLElement) => row.querySelector<HTMLElement>(MESSAGE) ?? row;
const rowText = (row: HTMLElement) => normalize(renderedText(body(row)));

/** Timestamp URLs can be hydrated only on hover. Target only unresolved timestamps
 * on a new matching post, never click/navigate, inspect private state, or invent IDs. */
function lazyTimestamp(link: HTMLAnchorElement): boolean {
  if (link.closest(MESSAGE) || facebookPostUrl(link.href)) return false;
  const raw = link.getAttribute('href') || '';
  if (raw && !raw.startsWith('?') && raw !== '#') return false;
  return !!link.querySelector('time, abbr, svg use') || /^(?:just now|now|\d+\s*(?:s|m|h|d|min|mins|minutes?|hours?|days?))$/i.test(normalize(link.textContent || link.getAttribute('aria-label') || ''));
}

/** Observe this submission. URLs must come from a new matching post or a new
 * publication notice. Existing rows, unrelated links and quotes are ignored. */
export function watchPublishedPost(doc: Document, text: string, found: (url: string) => void, timeout: () => void, timeoutMs = 60_000): () => void {
  const baseline = new Set(links(doc).map(a => facebookPostUrl(a.href)).filter(Boolean));
  const previousRows = new WeakMap(rows(doc).map(row => [row, rowText(row)]));
  const oldNotices = new WeakMap([...doc.querySelectorAll('[role="alert"], [role="status"]')].map(notice => [notice, normalize(notice.textContent || '')]));
  const snippet = normalize(text).slice(0, 160);
  const prompted = new WeakSet<HTMLAnchorElement>();
  let alive = true, scheduled: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { alive = false; observer.disconnect(); clearTimeout(timer); clearTimeout(scheduled); };
  const schedule = () => { if (alive && !scheduled) scheduled = setTimeout(scan, 150); };
  const scan = () => {
    scheduled = undefined; if (!alive) return;
    const matches = new Set<string>();
    const matchingRows = rows(doc).filter(row => {
      const current = rowText(row);
      return snippet && current.includes(snippet) && previousRows.get(row) !== current;
    });
    // Even an unresolved second match is ambiguous; do not race its lazy URL.
    for (const row of matchingRows.length === 1 ? matchingRows : []) {
      for (const link of links(row)) {
        if (link.closest(MESSAGE) || link.closest(ROW) !== row && link.closest(ROW) !== body(row).closest(ROW)) continue;
        const url = facebookPostUrl(link.href);
        if (url && !baseline.has(url)) matches.add(url);
        else if (!url && !prompted.has(link) && lazyTimestamp(link)) {
          prompted.add(link);
          // Invoke public hover handlers to populate the normal href, then read the
          // resulting DOM. This never clicks a link or submits a host action.
          if (typeof PointerEvent !== 'undefined') link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
          link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          link.dispatchEvent(new MouseEvent('mouseenter'));
          schedule();
        }
      }
    }
    for (const link of links(doc)) {
      const notice = link.closest('[role="alert"], [role="status"]');
      if (!notice || oldNotices.get(notice) === normalize(notice.textContent || '')) continue;
      const url = facebookPostUrl(link.href);
      if (url && !baseline.has(url) && /^(?:view|see)(?: your)?(?: post)?$/i.test(normalize(link.textContent || link.getAttribute('aria-label') || ''))) matches.add(url);
    }
    if (matches.size === 1) { const url = [...matches][0]!; stop(); found(url); }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'], characterData: true });
  const timer = setTimeout(() => { scan(); if (alive) { stop(); timeout(); } }, timeoutMs);
  return stop;
}
