// The shipped classic adapter with real trusted browser clicks and native contenteditable
// input. Host publishing and all worker/network responses are fixtures; no live posts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const script = readFileSync(new URL('../dist/content/facebook.js', import.meta.url), 'utf8');
const profileUrl = 'https://opensocial.online/u/1JgvtKNBKCxT3D1xb8mmUJLCBpZnHqC3Rr';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main><div role="feed"></div></main></body></html>' }));
  await page.goto('https://www.facebook.com/');
  await page.evaluate(profileUrl => {
    window.__calls = []; window.__nativePosts = []; window.__auto = true; window.__attribution = true; window.__prepareError = false;
    window.chrome = { runtime: { id: 'fixture', getURL: p => 'https://extension.test/' + p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async m => {
      window.__calls.push(m);
      if (m.type === 'adapter.preferences') return { ok: true, result: { facebookAttribution: window.__attribution, facebookAutoCheck: window.__auto } };
      if (m.type === 'feed.request') return { ok: true, result: { enabled: false, items: [] } };
      if (m.type === 'crosspost.publish') {
        if (window.__prepareError) return { ok: false, error: { message: 'Unlock Open Social before cross-posting.' } };
        return { ok: true, result: { awaitingFacebook: true, profileUrl, status: 'pending', message: 'Waiting for Facebook' } };
      }
      if (m.type === 'crosspost.facebookComplete') return { ok: true, result: { status: 'published', message: 'Published to Open Social with the Facebook post link.' } };
      throw Error('Unexpected request ' + m.type);
    } } };
    window.__composer = () => {
      document.querySelector('[role="dialog"]')?.remove();
      const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<div contenteditable="true" role="textbox" data-lexical-editor="true"></div><footer><button>Post</button></footer>';
      let controlledText = '';
      const editor = dialog.querySelector('[contenteditable]');
      // Model a controlled editor: publishing reads committed input state, not the DOM.
      editor.addEventListener('input', () => { const value = editor.innerText; setTimeout(() => { controlledText = value; }, 20); });
      dialog.querySelector('button').addEventListener('click', () => {
        window.__nativePosts.push(controlledText);
        dialog.remove();
        // Expose the published result only after the test explicitly completes Facebook.
        window.__publishFacebook = (id = '1001') => {
          const article = document.createElement('article'); article.setAttribute('role', 'article'); article.textContent = controlledText;
          const link = document.createElement('a'); link.textContent = 'Just now'; link.href = 'https://www.facebook.com/tester/posts/' + id + '?__cft__=tracking';
          article.append(link); document.querySelector('[role="feed"]').append(article);
        };
      });
      document.body.append(dialog);
    };
    window.__composer();
  }, profileUrl);
  await page.addScriptTag({ content: script });
  const box = () => page.getByRole('checkbox', { name: 'Also publish to Open Social Protocol' });
  const editor = () => page.getByRole('textbox');
  const count = type => page.evaluate(type => window.__calls.filter(m => m.type === type).length, type);
  await box().waitFor(); await page.waitForFunction(() => document.querySelector('[data-osp-control] input')?.checked);
  const original = 'Hello from my browser.\nA second paragraph.';
  await editor().fill(original); await page.waitForTimeout(40);
  assert.equal(await editor().innerText(), original, 'Auto-check and typing must not append the footer');
  await page.getByRole('combobox', { name: 'Open Social audience' }).selectOption('1');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.waitForFunction(() => window.__nativePosts.length === 1);
  const sent = await page.evaluate(() => window.__calls.find(m => m.type === 'crosspost.publish').payload);
  assert.equal(sent.text, original); assert.equal(sent.audience, 1); assert.equal(sent.waitForFacebook, true); assert.equal(sent.userGesture, true);
  const native = await page.evaluate(() => window.__nativePosts[0]);
  // Native editors represent blank paragraphs differently; the content and footer must be exact.
  const footer = 'Join Me On Open Social: ' + profileUrl;
  assert.ok(native.endsWith(footer), 'Native input committed the exact spaced footer before the host Post handler');
  assert.equal(native.slice(0, -footer.length).trimEnd(), original, 'All original paragraphs remain intact and the footer is added once');
  assert.equal(await count('crosspost.facebookComplete'), 0, 'No Open Social completion before Facebook exposes a permalink');
  await page.evaluate(() => {
    history.pushState({}, '', '/someone/posts/999'); // unrelated navigation is not proof of this publication
    document.querySelector('[role="feed"]').innerHTML = '<article role="article">Unrelated post<a href="https://www.facebook.com/someone/posts/999">Now</a></article>';
  });
  await page.waitForTimeout(220);
  assert.equal(await count('crosspost.facebookComplete'), 0, 'Unrelated navigation or feed links cannot complete the draft');
  await page.evaluate(() => window.__publishFacebook());
  await page.waitForFunction(() => window.__calls.some(m => m.type === 'crosspost.facebookComplete'));
  assert.deepEqual(await page.evaluate(() => window.__calls.find(m => m.type === 'crosspost.facebookComplete').payload), { attemptId: sent.attemptId, url: 'https://www.facebook.com/tester/posts/1001' });
  await page.evaluate(() => window.__publishFacebook()); await page.waitForTimeout(220);
  assert.equal(await count('crosspost.facebookComplete'), 1, 'Duplicate DOM updates cannot submit twice');

  await page.evaluate(() => { window.__auto = false; window.__composer(); }); await page.addScriptTag({ content: script });
  await box().waitFor(); assert.equal(await box().isChecked(), false, 'Saved opt-out applies to new composers');
  await box().check(); await page.addScriptTag({ content: script }); await page.waitForTimeout(40);
  assert.equal(await box().isChecked(), true, 'Manual choice survives a preference refresh');
  await box().uncheck(); await editor().fill('Facebook only'); await page.waitForTimeout(40);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  assert.equal(await count('crosspost.publish'), 1); assert.equal(await page.evaluate(() => window.__nativePosts[1]), 'Facebook only');

  await page.evaluate(() => { window.__auto = true; window.__prepareError = true; window.__composer(); }); await page.addScriptTag({ content: script });
  await box().waitFor(); await page.waitForFunction(() => document.querySelector('[data-osp-control] input')?.checked);
  await editor().fill('Keep my draft if preparation fails'); await page.waitForTimeout(40);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByText('Post paused: Unlock Open Social before cross-posting.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__nativePosts.length), 2, 'A failed preparation does not silently post or lose the editor');
  assert.equal(await editor().innerText(), 'Keep my draft if preparation fails');
  // Per-post opt-out is a direct escape hatch even while the worker is locked.
  await box().uncheck(); await page.getByRole('button', { name: 'Post', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__nativePosts.length), 3);
  assert.equal(context.pages().length, 1); assert.deepEqual(errors, []);
  console.log('Facebook publishing browser checks passed: default and manual choices, native controlled-editor footer on trusted Post, delayed canonical permalink, unrelated navigation ignored, duplicate suppression, preparation failure and Facebook-only fallback; fixture network only');
  await page.evaluate(() => window.__ospFacebook.stop()); await context.close();
} finally { await browser.close(); }
