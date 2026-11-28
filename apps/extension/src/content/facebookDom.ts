/** Shared DOM markers for the desktop and mobile Facebook website. */
export const FACEBOOK_TEXTBOX = '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor="true"], textarea[name="xc_message"], textarea[name="message"]';
export const FACEBOOK_COMPOSER = '[role="dialog"], dialog, [data-osp-facebook-composer]';
export const FACEBOOK_POST = '[aria-posinset], [data-pagelet^="FeedUnit_"], [role="article"], article[data-ft], [data-ft*="top_level_post_id"]';

/** Scope mobile discovery to post forms or a bounded composer with a Post button. */
export function mobileFacebookComposers(root: ParentNode): HTMLElement[] {
  const doc = root.nodeType === 9 ? root as Document : root.ownerDocument;
  if (!doc || !["m.facebook.com", "facebook.com"].includes(doc.location.hostname)) return [];
  const found = new Set<HTMLElement>();
  for (const editor of root.querySelectorAll<HTMLElement>(FACEBOOK_TEXTBOX)) {
    if (editor.closest('[role="dialog"], dialog, [data-osp-feed]') || /\/messages(?:\/|$)/.test(doc.location.pathname)) continue;
    const form = editor.closest<HTMLElement>('form');
    const action = form?.getAttribute('action') || '';
    if (form) {
      if (/(?:composer|post\/|updatestatus)/i.test(action) && !/(?:comment|reply|message)/i.test(action)) found.add(form);
      continue;
    }
    let container = editor.parentElement;
    for (let depth = 0; container && depth < 14; depth++, container = container.parentElement) {
      if (container.matches('body, [role="feed"]')) break;
      if (container.querySelector(FACEBOOK_POST) || container.querySelectorAll(FACEBOOK_TEXTBOX).length !== 1) break;
      if ([...container.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')].some(button =>
        /^(post|publish)$/i.test((button.getAttribute('aria-label') || (button as HTMLInputElement).value || button.textContent || '').trim()))) {
        found.add(container); break;
      }
    }
  }
  return [...found].filter(container => !container.querySelector('[name="comment_text"], [name="body"]'));
}
