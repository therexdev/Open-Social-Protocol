import { afterEach, expect, it, vi } from 'vitest';
import { fromHex, toBase64url } from '@osp/sdk';
import { createTestBackground } from '../test/support';
import { startFacebookAdapter, type RunningAdapter } from './facebookAdapter';

let running: RunningAdapter | null;
afterEach(() => { running?.stop(); running = null; document.body.replaceChildren(); vi.useRealTimers(); });

it.each([0, 1])('hands a newly hydrated Facebook URL from the composer to the real worker and signed %s post exactly once', async audience => {
  const t = createTestBackground({ indexer: true, sponsor: false, origins: ['https://www.facebook.com/*'] });
  const passphrase = 'correct horse battery';
  await t.call('vault.create', { passphrase }); await t.call('device.authorize', { passphrase, keepOwnerSeed: true });
  await t.call('settings.update', { patch: { payment: 'self-only', facebookAdapter: true, facebookAttribution: false, facebookAutoCheck: true, feedInsertion: false } });
  const sender = t.chrome._contentSender('https://www.facebook.com/');
  const attemptId = 'ac'.repeat(16), text = 'First paragraph\nSecond paragraph', url = 'https://www.facebook.com/fixture/posts/pfbid123';
  document.body.innerHTML = '<div role="main"><div role="feed"></div></div><section role="dialog"><div role="textbox" contenteditable="true" data-lexical-editor="true"><p>First paragraph</p><p>Second paragraph</p></div><footer><button>Post</button></footer></section>';
  const native = vi.fn(() => {
    document.querySelector('[role="dialog"]')!.remove();
    const row = document.createElement('div'); row.setAttribute('aria-posinset', '1');
    row.innerHTML = '<a href="?__cft__[0]=placeholder"><span><svg><use></use></svg></span></a><div data-ad-preview="message"><div>First paragraph</div><div>Second paragraph</div></div>';
    row.querySelector('a')!.addEventListener('mouseover', () => { row.querySelector('a')!.href = url + '?__cft__[0]=tracking'; });
    document.querySelector('[role="feed"]')!.append(row);
  });
  document.querySelector('button')!.addEventListener('click', native);
  running = startFacebookAdapter({ document, location: () => 'https://www.facebook.com/', randomAttemptId: () => attemptId, trustedEvent: () => true,
    sendMessage: message => t.background.router.handle(message, sender) });
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-osp-control] input')!.checked).toBe(true));
  const select = document.querySelector<HTMLSelectElement>('[data-osp-control] select')!; select.value = String(audience); select.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector<HTMLButtonElement>('footer button')!.click();
  await vi.waitFor(async () => expect((await t.background.crossposts.get(attemptId))?.koinosStatus).toBe('ok'), { timeout: 5000 });
  const record = (await t.background.crossposts.get(attemptId))!;
  expect(record).toMatchObject({ audience, awaitingFacebook: false, facebookPostUrl: url });
  const card = await t.background.feed.card(toBase64url(fromHex(record.postId!)));
  expect(card).toMatchObject({ text: `${text}\n\n${url}`, externalRef: url });
  expect(native).toHaveBeenCalledOnce(); expect(t.state.posts).toHaveLength(1);
  expect(document.querySelector('[data-osp-facebook-publish]')?.textContent).toContain('Published to Open Social with the Facebook post link.');
  document.querySelector('a')!.setAttribute('href', url + '?ref=another');
  await new Promise(resolve => setTimeout(resolve, 200)); expect(t.state.posts).toHaveLength(1);
});
