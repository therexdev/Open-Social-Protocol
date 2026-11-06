// Shipped Facebook script + trusted browser inputs. All publication/network handlers are fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const script = readFileSync(new URL('../dist/content/facebook.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(20000);
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main><div role="feed"></div></main><section role="dialog"><div role="textbox" contenteditable="true">A saved Facebook draft</div><footer><button>Post</button></footer></section></body></html>' }));
  await page.goto('https://www.facebook.com/');
  await page.evaluate(() => {
    window.__calls = []; window.__nativePosts = 0; window.__protocolPosts = 0; window.__fail = true;
    document.querySelector('footer button').addEventListener('click', () => { window.__nativePosts++; document.querySelector('[role="dialog"]').remove(); });
    window.chrome = { runtime: { id: 'fixture', getURL: p => 'https://extension.test/' + p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async m => {
      window.__calls.push(m);
      if (m.type === 'adapter.preferences') return { ok: true, result: { facebookAutoCheck: true, facebookAttribution: false } };
      if (m.type === 'feed.request') return { ok: true, result: { enabled: false, items: [] } };
      if (m.type === 'crosspost.publish') return { ok: true, result: { awaitingFacebook: true, status: 'pending' } };
      if (m.type === 'crosspost.facebookComplete') {
        if (!m.payload.url.includes('/fixture/posts/')) return { ok: false, error: { message: 'Paste a published Facebook post link, not a profile.' } };
        if (window.__fail) return { ok: true, result: { status: 'failed', message: 'Fixture transaction rejected. Retry the Open Social copy.' } };
        window.__protocolPosts++; return { ok: true, result: { status: 'published', message: 'Published to Open Social with the Facebook post link.' } };
      }
      throw Error('Unexpected fixture request ' + m.type);
    } } };
  });
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => document.querySelector('[data-osp-control] input')?.checked);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.waitForFunction(() => window.__nativePosts === 1);
  const notice = page.locator('[data-osp-facebook-publish]');
  await notice.getByText(/Finding your published Facebook link/).waitFor();
  // The persistent recovery form appears even if Facebook never reveals a permalink.
  const input = notice.getByRole('textbox', { name: 'Published Facebook post link' });
  await input.waitFor();
  assert.equal(await page.evaluate(() => window.__protocolPosts), 0);
  await input.fill('https://www.facebook.com/profile.php?id=1');
  await notice.getByRole('button', { name: 'Finish Open Social post' }).click();
  await notice.getByText(/Paste a published Facebook post link/).waitFor();
  await input.fill('https://www.facebook.com/fixture/posts/12345');
  await notice.getByRole('button', { name: 'Finish Open Social post' }).click();
  await notice.getByText('Fixture transaction rejected. Retry the Open Social copy.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__protocolPosts), 0);
  await page.evaluate(() => window.__fail = false);
  await notice.getByRole('button', { name: 'Retry Open Social post' }).click();
  await notice.getByRole('status').filter({ hasText: 'Published to Open Social with the Facebook post link.' }).waitFor();
  const calls = await page.evaluate(() => window.__calls);
  const prepared = calls.find(m => m.type === 'crosspost.publish').payload;
  assert.equal(prepared.text, 'A saved Facebook draft');
  const completions = calls.filter(m => m.type === 'crosspost.facebookComplete');
  assert.equal(completions.length, 3); assert.ok(completions.every(m => m.payload.attemptId === prepared.attemptId));
  assert.equal(completions.at(-1).payload.url, 'https://www.facebook.com/fixture/posts/12345');
  assert.equal(await page.evaluate(() => window.__nativePosts), 1, 'Recovery never reposts to Facebook');
  assert.equal(await page.evaluate(() => window.__protocolPosts), 1);
  await notice.getByRole('button', { name: 'Dismiss Open Social publishing status' }).click();
  assert.equal(await notice.count(), 0); assert.deepEqual(errors, []);
  await page.evaluate(() => window.__ospFacebook.stop()); await context.close();
  console.log('Facebook recovery browser checks passed: persistent pending status, missing-link recovery in feed, invalid-link error, explicit failure/retry with same attempt, confirmed success, no second Facebook post; fixture network only');
} finally { await browser.close(); }
