// Real Firefox engine at phone dimensions, shipped pages/content bundles and CSP.
// Browser APIs and host sites are fixtures: no Facebook/X account or transaction is used.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const { firefox } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const dist = path.resolve(fileURLToPath(new URL('../dist-firefox/', import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const postId = 'a'.repeat(43) + '=';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNwaDgARAwQCgAoDgYBQzpj2gAAAABJRU5ErkJggg==';
const browser = await firefox.launch({ headless: true });
try {
  for (const site of ['facebook', 'x']) {
    const host = site === 'facebook' ? 'https://m.facebook.com' : 'https://x.com';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const errors = [];
    await context.addInitScript(({ postId, image }) => {
      const events = new Set(); window.__calls = [];
      let comment, reaction = 0;
      const item = { postId, author: 'alex', authorName: 'Alex River', viewer: 'reader', audience: 0, epoch: 0,
        createdAt: String(Date.now() - 60000), versionNumber: 1, contentHash: 'v'.repeat(43) + '=', status: 'plain',
        text: 'An Open Social post inside the mobile feed.', reactions: 0, viewerReaction: 0, replyCount: 0, labels: [],
        media: [{ mime: 'image/png', locations: ['osp-photo://archive/fixture'], contentHash: 'h'.repeat(43) + '=', alt_text: 'Fixture photo' }] };
      window.browser = { runtime: { id: 'firefox-fixture', getURL: p => 'https://extension.fixture/' + p,
        onMessage: { addListener: fn => events.add(fn), removeListener: fn => events.delete(fn) },
        sendMessage: async message => {
          window.__calls.push(message);
          const { type, payload } = message; let result;
          if (type === 'adapter.preferences') result = { facebookAttribution: false, facebookAutoCheck: true, xEnabled: true, xAutoCheck: true, xAttribution: false };
          else if (type === 'feed.request') result = { enabled: true, items: [{ postId }], nextCursor: null };
          else if (type === 'embed.post') result = { enabled: true, item: { ...item, viewerReaction: reaction } };
          else if (type === 'embed.media') result = { data: image, mime: 'image/png' };
          else if (type === 'embed.react') { reaction = payload.remove ? 0 : payload.reaction; result = { reaction }; }
          else if (type === 'embed.replies') result = { items: comment ? [comment] : [], nextCursor: null };
          else if (type === 'embed.comment') { comment = { ...item, postId: 'b'.repeat(43) + '=', replyTo: postId, author: 'reader', authorName: 'You', media: [], text: payload.text }; result = { postId: comment.postId, confirmed: true }; }
          else if (type === 'crosspost.publish') result = { awaitingFacebook: true, profileUrl: 'https://opensocial.online/u/1J2gZWvrR23739vw3y9s8J5DKj7hbJnDv7' };
          else if (type === 'crosspost.xPrepare') result = { awaitingX: true, profileUrl: 'https://opensocial.online/u/1J2gZWvrR23739vw3y9s8J5DKj7hbJnDv7' };
          else if (type === 'crosspost.facebookComplete' || type === 'crosspost.xComplete') result = { status: 'published', message: 'Published to Open Social with the source post link.' };
          else throw Error('Unexpected fixture request: ' + type);
          return { ok: true, result };
        } }, storage: { onChanged: { addListener() {}, removeListener() {} } } };
    }, { postId, image });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === host) {
        const native = site === 'facebook'
          ? Array.from({ length: 6 }, (_, n) => `<article data-ft='{"top_level_post_id":"${n + 1}"}'><p>Facebook post ${n + 1}</p></article>`).join('')
          : Array.from({ length: 6 }, (_, n) => `<div data-testid="cellInnerDiv"><div><article data-testid="tweet"><a href="/alex/status/${n + 1}"><time>Now</time></a><div data-testid="tweetText">X post ${n + 1}</div></article></div></div>`).join('');
        const composer = site === 'facebook'
          ? '<section role="dialog"><div role="textbox" contenteditable="true"></div><footer><button type="button">Post</button></footer></section>'
          : '<a data-testid="AppTabBar_Profile_Link" href="/tester">Profile</a><section><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0"></div><footer data-testid="toolBar"><button data-testid="tweetButton">Post</button></footer></section>';
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px system-ui}main{max-width:600px}article{padding:12px;min-height:55px;border-bottom:1px solid #ccc}[role=textbox]{min-height:50px;border:1px solid gray}button{min-height:44px}</style></head><body><main role="main" ${site === 'x' ? 'data-testid="primaryColumn"' : ''}><div role="feed" id="lane">${native}</div>${composer}</main></body></html>` });
      }
      const file = path.resolve(dist, '.' + url.pathname);
      assert.ok(url.origin === 'https://extension.fixture' && file.startsWith(dist + path.sep) && existsSync(file), 'Unexpected fixture request: ' + url.href);
      return route.fulfill({ body: readFileSync(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream',
        headers: { 'content-security-policy': manifest.content_security_policy.extension_pages } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(host + (site === 'x' ? '/home' : '/'));
    await page.addScriptTag({ path: path.join(dist, `content/${site}.js`) });
    const card = page.frameLocator('iframe[title="Open Social post"]').first();
    await card.getByText('An Open Social post inside the mobile feed.', { exact: true }).waitFor();
    await card.locator('.card-photo img').evaluate(img => img.decode());
    assert.ok(await card.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Card fits a phone screen');
    await card.getByRole('button', { name: 'React', exact: true }).click();
    await card.getByRole('button', { name: 'Happy', exact: true }).click();
    await card.getByRole('button', { name: 'Change reaction, Happy', exact: true }).waitFor();
    await card.getByRole('button', { name: 'Comment', exact: true }).click();
    await card.getByRole('textbox', { name: 'Write a comment' }).fill('A reply from mobile Firefox.');
    await card.getByRole('button', { name: 'Post comment', exact: true }).click();
    await card.getByText('A reply from mobile Firefox.', { exact: true }).waitFor();
    await page.setViewportSize({ width: 844, height: 390 });
    assert.ok(await card.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await card.getByRole('button', { name: 'Change reaction, Happy', exact: true }).click();
    await card.getByRole('button', { name: 'Surprised', exact: true }).click();
    await card.getByRole('button', { name: 'Change reaction, Surprised', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-osp-control] input').check();
    const editor = page.locator('[contenteditable]'); await editor.fill('My mobile Firefox post');
    await page.evaluate(site => {
      const button = site === 'facebook' ? document.querySelector('footer button') : document.querySelector('[data-testid="tweetButton"]');
      button.addEventListener('click', () => {
        const row = document.createElement(site === 'facebook' ? 'article' : 'div');
        if (site === 'facebook') {
          row.setAttribute('data-ft', '{"top_level_post_id":"789"}'); row.innerHTML = '<a href="/tester/posts/789">Just now</a><p>My mobile Firefox post</p>';
        } else {
          row.innerHTML = '<article data-testid="tweet"><a href="/tester/status/789"><time>Now</time></a><div data-testid="tweetText">My mobile Firefox post</div></article>';
          const notice = document.createElement('div'); notice.dataset.testid = 'toast'; notice.innerHTML = '<a href="/tester/status/789">View</a>'; document.body.append(notice);
        }
        document.querySelector('#lane').prepend(row);
      });
    }, site);
    await page.locator(site === 'facebook' ? 'footer button' : '[data-testid="tweetButton"]').click();
    await page.waitForFunction(type => window.__calls.some(call => call.type === type), site === 'facebook' ? 'crosspost.facebookComplete' : 'crosspost.xComplete');
    const calls = await page.evaluate(() => window.__calls);
    assert.equal(calls.filter(call => call.type === (site === 'facebook' ? 'crosspost.publish' : 'crosspost.xPrepare')).length, 1);
    assert.equal(calls.filter(call => call.type.endsWith('Complete')).length, 1);
    assert.ok(calls.find(call => call.type.endsWith('Complete')).payload.url.endsWith('/789'));
    assert.deepEqual(errors, []);
    console.log(`Firefox phone fixture passed: ${site} feed, photo, reaction, comment, rotation and one cross-post with permalink`);
    await context.close();
  }
} finally { await browser.close(); }
