import { expect, it } from 'vitest';
import { createRouter, defineHandler } from './messages';
const id = 'opensocial@opensocial.online';
const url = 'moz-extension://a357d980-1111-2222-aaaa-a00000000001/';
const postId = 'a'.repeat(43);
function router() { return createRouter({ runtimeId: id, extensionUrl: url, grantedOrigins: async () => ['https://m.facebook.com/*', 'https://x.com/*'], handlers: {
  'vault.status': defineHandler({ source: 'extension', validate: value => value, handle: async () => 'trusted' }),
  'embed.post': defineHandler({ source: 'embed', validate: value => value, handle: async () => 'card' }),
  'feed.request': defineHandler({ source: 'content', validate: value => value, handle: async () => 'feed' }),
} }); }
it('recognizes Firefox pages by their actual UUID URL with no sender.origin field', async () => {
  const r = router();
  expect(await r.handle({ type: 'vault.status' }, { id, url: url + 'src/sidepanel/index.html' })).toEqual({ ok: true, result: 'trusted' });
  expect((await r.handle({ type: 'vault.status' }, { id, url: 'moz-extension://another-addon/src/sidepanel/index.html' })).ok).toBe(false);
});
it('keeps a Firefox card restricted to its post on a granted host tab', async () => {
  const r = router();
  const sender = { id, url: url + 'src/embed/index.html#post=' + postId, frameId: 1, tab: { id: 1, index: 0, active: true, url: 'https://m.facebook.com/' } as chrome.tabs.Tab };
  expect(await r.handle({ type: 'embed.post', payload: { postId } }, sender)).toEqual({ ok: true, result: 'card' });
  expect((await r.handle({ type: 'vault.status' }, sender)).ok).toBe(false);
  expect((await r.handle({ type: 'embed.post', payload: { postId: 'b'.repeat(43) } }, sender)).ok).toBe(false);
  expect((await r.handle({ type: 'embed.post', payload: { postId } }, { ...sender, tab: { ...sender.tab, url: 'https://evil.test/' } })).ok).toBe(false);
});
it('accepts only granted mobile host traffic and refuses privileged calls from host pages', async () => {
  const r = router(), sender = { id, url: 'https://m.facebook.com/', frameId: 0, tab: { id: 3, index: 0, active: true } as chrome.tabs.Tab };
  expect((await r.handle({ type: 'feed.request' }, sender)).ok).toBe(true);
  expect((await r.handle({ type: 'vault.status' }, sender)).ok).toBe(false);
  expect((await r.handle({ type: 'feed.request' }, { ...sender, url: 'https://mobile.twitter.com/' })).ok).toBe(false);
});
