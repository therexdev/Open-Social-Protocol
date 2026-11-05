import { showToast } from './adapter';

export function contextInvalidated(error: unknown): boolean {
  return /extension context invalidated/i.test(error instanceof Error ? error.message : String(error));
}

export function showRefreshNotice(doc: Document, host: 'X' | 'Facebook', alreadyPosted = false): void {
  const toast = showToast(doc, alreadyPosted
    ? `The extension was reloaded. Keep the published ${host} link, refresh this page, then open Unfinished browser posts to finish the saved Open Social copy. Do not post it again.`
    : `The extension was reloaded. Your draft has been kept. Copy it before refreshing ${host}, then reopen the composer to cross-post. The old Open Social controls have been removed; normal ${host} posting is available.`, 120_000);
  toast.setAttribute('role', 'alert');
}
