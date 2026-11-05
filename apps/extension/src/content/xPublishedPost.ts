import { xPostUrl } from "../shared/xUrl";
const normalize = (text: string) => text.replace(/[\s\u200b]+/g, " ").trim();
const links = (doc: Document) => [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => !a.closest('[data-osp-feed], [data-osp-control]'));

export function xAccountHandle(doc: Document): string | undefined {
  const href = doc.querySelector<HTMLAnchorElement>('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  return href?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1]?.toLowerCase();
}

/** Observe one user-submitted post. Only a new success-toast permalink or a new text-matching
 * post by the current X account is accepted. Navigation/other authors/quotes are not proof. */
export function watchXPublishedPost(doc: Document, text: string, found: (url: string) => void, timeout: () => void, timeoutMs = 60_000): () => void {
  const statusId = (url: string) => url.split("/status/")[1]!;
  const baseline = new Set(links(doc).map(a => xPostUrl(a.href)).filter((u): u is string => !!u).map(statusId));
  const handle = xAccountHandle(doc), snippet = normalize(text).slice(0,160);
  let alive = true, scheduled: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { alive = false; observer.disconnect(); clearTimeout(timer); clearTimeout(scheduled); };
  const scan = () => {
    scheduled = undefined; if (!alive) return;
    const matches = new Map<string,string>();
    for (const link of links(doc)) {
      const url = xPostUrl(link.href); if (!url || baseline.has(statusId(url))) continue;
      const success = !!link.closest('[data-testid="toast"]') || !!link.closest('[role="alert"], [role="status"]') && /^(view|view post|view your post)$/i.test((link.textContent || '').trim());
      const row = link.closest('article[data-testid="tweet"]');
      const rowText = row?.querySelector('[data-testid="tweetText"]');
      const own = handle && new URL(url).pathname.startsWith(`/${handle}/status/`);
      const timestamp = row?.querySelector('a[href] time')?.closest('a') === link;
      if (success || own && timestamp && rowText && snippet && normalize(rowText.textContent || '').includes(snippet)) matches.set(statusId(url),url);
    }
    if (matches.size === 1) { const url=[...matches.values()][0]!; stop(); found(url); }
  };
  const observer = new MutationObserver(() => { if (!scheduled) scheduled=setTimeout(scan,150); });
  observer.observe(doc.body, { childList:true, subtree:true, attributes:true, attributeFilter:['href'], characterData:true });
  const timer=setTimeout(() => { scan(); if (alive) { stop(); timeout(); } },timeoutMs);
  return stop;
}
