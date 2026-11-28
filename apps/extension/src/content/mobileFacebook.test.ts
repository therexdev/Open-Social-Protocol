// @vitest-environment-options {"url":"https://m.facebook.com/"}
import { afterEach, expect, it, vi } from 'vitest';
import { facebookAdapter, startFacebookAdapter, type RunningAdapter } from './facebookAdapter';
import { ComposerAttribution } from './attribution';
import { findFeedLocation, maybeInsertFeedCards, resetFeedCards } from './feedCards';
import { createTestBackground } from '../test/support';
import { xPostUrl } from '../shared/xUrl';
let running: RunningAdapter | null;
afterEach(() => { running?.stop(); running = null; resetFeedCards(document); document.body.replaceChildren(); });

it('finds a full-page mobile composer and excludes comment/message forms', () => {
  document.body.innerHTML = '<main><form action="/composer/mbasic"><textarea name="xc_message">Mobile post</textarea><button type="submit">Post</button></form><form action="/a/comment.php"><textarea name="message">Private reply</textarea><button>Post</button></form></main>';
  expect(facebookAdapter.findComposers(document)).toEqual([document.querySelector('form')]);
  document.body.innerHTML = '<main><section><div contenteditable="true" role="textbox">Mobile React post</div><footer><button>Post</button></footer></section></main>';
  expect(facebookAdapter.findComposers(document)).toHaveLength(1);
});

it('keeps the mobile Facebook feed in its vertical lane and inserts extension-owned cards', async () => {
  document.body.innerHTML = '<main><div id="lane">' + [1,2,3,4,5,6].map(id => `<article data-ft='{"top_level_post_id":"${id}"}'><p>Facebook post ${id}</p></article>`).join('') + '</div></main>';
  expect(findFeedLocation(document)?.column.id).toBe('lane');
  await maybeInsertFeedCards({ document, sendMessage: async () => ({ ok: true, result: { enabled: true, items: [{ postId: 'a'.repeat(43) }, { postId: 'b'.repeat(43) }], nextCursor: null } }) });
  const cards = [...document.querySelectorAll('[data-osp-feed]')];
  expect(cards).toHaveLength(2);
  expect(cards[0]!.previousElementSibling?.textContent).toBe('Facebook post 3');
  expect(cards[0]!.querySelector('iframe')?.src).toContain('/src/embed/index.html#post=');
});

it('prepares one mobile post, lets Facebook publish, then signs the Open Social copy with its source link', async () => {
  const t = createTestBackground({ indexer: true, sponsor: false, origins: ['https://m.facebook.com/*'] });
  const passphrase = 'correct horse battery';
  await t.call('vault.create', { passphrase }); await t.call('device.authorize', { passphrase, keepOwnerSeed: true });
  await t.call('settings.update', { patch: { payment: 'self-only', facebookAdapter: true, facebookAttribution: false, facebookAutoCheck: true } });
  const sender = t.chrome._contentSender('https://m.facebook.com/');
  document.body.innerHTML = '<main><div role="feed"></div><form action="/composer/mbasic"><textarea name="xc_message">My mobile post</textarea><button type="submit">Post</button></form></main>';
  const native = vi.fn((event: Event) => {
    event.preventDefault();
    document.querySelector('form')!.remove();
    document.querySelector('[role="feed"]')!.innerHTML = '<article data-ft=\'{"top_level_post_id":"789"}\'><a href="/story.php?story_fbid=789&id=456">Just now</a><p>My mobile post</p></article>';
  });
  document.querySelector('form')!.addEventListener('submit', native);
  const attemptId = 'ba'.repeat(16);
  running = startFacebookAdapter({ document, location: () => document.location.href, randomAttemptId: () => attemptId,
    trustedEvent: () => true, sendMessage: message => t.background.router.handle(message, sender) });
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-osp-control] input')?.checked).toBe(true));
  document.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(async () => expect((await t.background.crossposts.get(attemptId))?.koinosStatus).toBe('ok'), { timeout: 5000 });
  expect(native).toHaveBeenCalledOnce();
  expect(t.state.posts).toHaveLength(1);
  expect(await t.background.crossposts.get(attemptId)).toMatchObject({ facebookPostUrl: 'https://www.facebook.com/story.php?story_fbid=789&id=456' });
});

it('adds and removes the optional invitation footer through a native textarea value', async () => {
  document.body.innerHTML = '<form action="/composer/"><textarea name="xc_message">Original text</textarea><button>Post</button></form>';
  const editor = new ComposerAttribution(document.querySelector('form')!, facebookAdapter);
  const profile = 'https://opensocial.online/u/1J2gZWvrR23739vw3y9s8J5DKj7hbJnDv7';
  expect(await editor.sync(true, profile)).toBe(true);
  expect(document.querySelector('textarea')!.value).toContain('\n\nJoin Me On Open Social: ');
  expect(editor.text()).toBe('Original text');
  expect(await editor.sync(false)).toBe(true);
  expect(document.querySelector('textarea')!.value).toBe('Original text'); editor.dispose();
});

it.each(['https://mobile.x.com/me/status/123', 'https://mobile.twitter.com/me/status/123'])('normalizes a published mobile X permalink: %s', value => {
  expect(xPostUrl(value)).toBe('https://x.com/me/status/123');
});
