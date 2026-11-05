import { facebookPostUrl } from "../shared/facebookUrl";
const normalize = (text: string) => text.replace(/[\s\u200b]+/g, " ").trim();
const links = (doc: Document) => [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => !a.closest('[role="dialog"], [data-osp-feed], [data-osp-control]'));

/** Observe the result of this submission. Never invent a URL from the composer/profile. */
export function watchPublishedPost(doc: Document, text: string, found: (url: string) => void, timeout: () => void, timeoutMs = 60_000): () => void {
  const baseline = new Set(links(doc).map(a => facebookPostUrl(a.href)).filter(Boolean));
  const snippet = normalize(text).slice(0, 160);
  let alive = true, scheduled: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { alive = false; observer.disconnect(); clearTimeout(timer); clearTimeout(scheduled); };
  const scan = () => {
    scheduled = undefined; if (!alive) return;
    const matches = new Set<string>();
    for (const link of links(doc)) {
      const url = facebookPostUrl(link.href);
      if (!url || baseline.has(url)) continue;
      const row = link.closest('[aria-posinset], [data-pagelet^="FeedUnit_"], [role="article"]');
      const success = link.closest('[role="alert"], [role="status"]') && /view (?:your )?post|see (?:your )?post/i.test(link.textContent || link.getAttribute('aria-label') || '');
      if (success || row && snippet && normalize(row.textContent || '').includes(snippet)) matches.add(url);
    }
    // Multiple new matching posts are ambiguous. Leave recovery to the saved draft.
    if (matches.size === 1) { const url = [...matches][0]!; stop(); found(url); }
  };
  const observer = new MutationObserver(() => { if (!scheduled) scheduled = setTimeout(scan, 150); });
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'], characterData: true });
  const timer = setTimeout(() => { scan(); if (alive) { stop(); timeout(); } }, timeoutMs);
  return stop;
}
