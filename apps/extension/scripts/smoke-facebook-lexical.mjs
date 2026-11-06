// Real Lexical model + packaged content script + trusted clicks. All requests are fixtures.
// Setup: npm ci --prefix apps/extension/scripts/fixtures/facebook-lexical --ignore-scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const fixture = fileURLToPath(new URL('./fixtures/facebook-lexical/', import.meta.url));
const bundle = await build({ entryPoints: [path.join(fixture, 'editor.js')], bundle: true, write: false });
const script = readFileSync(new URL('../dist/content/facebook.js', import.meta.url), 'utf8');
const profile = 'https://opensocial.online/u/1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4';
const invitation = 'Join Me On Open Social: ' + profile;
const original = "Who's ready for a censorship free, user owned, free and open social network. Check Out Open Social: https://opensocial.online/";
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><style>[contenteditable]{min-height:100px;border:1px solid gray}p{margin:0}section{width:470px}</style><body><main><div role="feed"></div></main></body></html>' }));
  const setup = async (text = original, options = {}) => {
    await page.goto('https://www.facebook.com/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ text, options, profile }) => {
      window.__calls = []; window.__attribution = true; window.__lazyLink = options.lazyLink; window.__pasteMode = options.pasteMode;
      window.__holdPrepare = options.holdPrepare; window.__blockAfterPaste = options.blockAfterPaste;
      window.__mount(text, options.plain);
      window.chrome = { runtime: { id: 'fixture', getURL: p => 'https://extension.test/' + p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async m => {
        window.__calls.push(m);
        if (m.type === 'adapter.preferences') return { ok: true, result: { facebookAutoCheck: true, facebookAttribution: window.__attribution } };
        if (m.type === 'feed.request') return { ok: true, result: { enabled: false, items: [] } };
        if (m.type === 'crosspost.publish') {
          if (window.__holdPrepare) await new Promise(resolve => window.__releasePrepare = resolve);
          return { ok: true, result: { awaitingFacebook: true, profileUrl: profile } };
        }
        if (m.type === 'crosspost.facebookComplete') return { ok: true, result: { status: 'published', message: 'Published fixture' } };
        throw Error('Unexpected fixture request ' + m.type);
      } } };
    }, { text, options, profile });
    if (options.isolated) {
      await page.evaluate(() => document.addEventListener('osp-fixture-rpc', e => window.__calls.push(JSON.parse(e.detail))));
      const cdp = await context.newCDPSession(page), tree = await cdp.send('Page.getFrameTree');
      const world = await cdp.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'osp-lexical-fixture' });
      const bootstrap = `globalThis.chrome={runtime:{id:'fixture',getURL:p=>'https://extension.test/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{
        document.dispatchEvent(new CustomEvent('osp-fixture-rpc',{detail:JSON.stringify(m)}));
        if(m.type==='adapter.preferences')return{ok:true,result:{facebookAutoCheck:true,facebookAttribution:true}};
        if(m.type==='feed.request')return{ok:true,result:{enabled:false,items:[]}};
        if(m.type==='crosspost.publish')return{ok:true,result:{awaitingFacebook:true,profileUrl:${JSON.stringify(profile)}}};
        if(m.type==='crosspost.facebookComplete')return{ok:true,result:{status:'published'}};throw Error(m.type);
      }}};`;
      const executed = await cdp.send('Runtime.evaluate', { contextId: world.executionContextId, expression: bootstrap + script, awaitPromise: true });
      assert.equal(executed.exceptionDetails, undefined); await cdp.detach();
    } else await page.addScriptTag({ content: script });
    await page.waitForFunction(() => document.querySelector('[data-osp-control] input')?.checked);
  };
  const post = () => page.getByRole('button', { name: 'Post', exact: true }).click();
  const model = () => page.evaluate(() => window.__model());
  for (const [text, selection, options] of [
    [original, 'End', {}],
    [original, 'Home', { isolated: true, lazyLink: true }],
    ['Friends 🚀\n\nNews https://example.test/page', 'Control+a', { isolated: true, lazyLink: true }],
    ['First line\nSecond line https://opensocial.online/', 'Home', { plain: true }],
  ]) {
    await setup(text, options); await page.getByRole('textbox').click(); await page.keyboard.press(selection);
    const before = await model(); await post();
    await page.waitForFunction(() => window.__posts.length === 1);
    const after = await model();
    assert.equal(after.blocks.join('\n'), text + '\n\n' + invitation, 'Committed paragraphs preserve the text and blank line before the invitation');
    assert.equal(after.text.split(profile).length, 2, 'Exactly one profile URL');
    if (!options.plain) assert.deepEqual(after.json.root.children.slice(0, before.json.root.children.length), before.json.root.children, 'Original link nodes, formatting and text unchanged');
    assert.deepEqual(await page.evaluate(() => window.__posts[0]), after, 'Native submit reads the committed Lexical model');
    assert.equal(await page.evaluate(() => window.__pastes), 1);
    assert.equal(await page.evaluate(() => window.__calls.find(m => m.type === 'crosspost.publish').payload.text), text);
    assert.equal(await page.evaluate(() => window.__calls.some(m => m.type === 'crosspost.facebookComplete')), false);
    assert.equal(await page.locator('[data-preview]').innerText(), 'Open Social link preview');
    await page.evaluate(() => window.__published());
    await page.waitForFunction(() => window.__calls.some(m => m.type === 'crosspost.facebookComplete'));
    assert.equal(await page.evaluate(() => window.__calls.find(m => m.type === 'crosspost.facebookComplete').payload.url), 'https://www.facebook.com/fixture/posts/12345');
    if (options.lazyLink) assert.equal(await page.evaluate(() => window.__linkHovers), 1);
    assert.equal(await page.evaluate(() => window.__linkClicks || 0), 0, 'Permalink discovery never clicks or navigates');
    await page.locator('[data-osp-facebook-publish] [role="status"]').filter({ hasText: /Published/ }).waitFor();
  }
  // Pending upload/host validation: one managed invitation survives retry; opt-out removes it.
  await setup(original, { blockAfterPaste: true }); await post();
  await page.getByText(/Post paused: Facebook is still preparing/).waitFor();
  await page.getByRole('checkbox').uncheck();
  await page.waitForFunction(text => window.__model().blocks.join('\n') === text, original);
  assert.deepEqual(await page.evaluate(() => window.__posts), []);
  await page.evaluate(() => document.querySelector('footer button').disabled = false); await post();
  assert.equal(await page.evaluate(() => window.__posts.length), 0, 'Native Post is blocked while footer removal is still being verified');
  await page.waitForTimeout(400); await post();
  assert.equal((await page.evaluate(() => window.__posts[0])).blocks.join('\n'), original);

  await setup(original, { blockAfterPaste: true }); await post();
  await page.getByText(/Post paused: Facebook is still preparing/).waitFor();
  await page.waitForTimeout(2050); await page.evaluate(() => document.querySelector('footer button').disabled = false); await post();
  await page.waitForFunction(() => window.__posts.length === 1);
  assert.equal(await page.evaluate(() => window.__pastes), 1, 'Retry never duplicates a successfully inserted invitation');
  assert.equal((await model()).blocks.join('\n'), original + '\n\n' + invitation);

  for (const pasteMode of ['refuse', 'corrupt']) {
    await setup(original, { pasteMode }); await post();
    await page.getByRole('textbox', { name: 'Original post text' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Original post text' }).inputValue(), original);
    await page.evaluate(() => document.querySelector('[data-osp-control]').remove());
    await page.getByRole('textbox', { name: 'Original post text' }).waitFor();
    assert.equal(await page.getByRole('checkbox').isChecked(), true);
    await post(); await post();
    assert.equal(await page.evaluate(() => window.__pastes), 1, 'Rejected insertion never retries, including after control recreation');
    assert.equal(await page.evaluate(() => window.__calls.filter(m => m.type === 'crosspost.publish').length), 1);
    assert.deepEqual(await page.evaluate(() => window.__posts), []);
    await page.getByRole('checkbox').uncheck(); await post();
    assert.equal(await page.evaluate(() => window.__posts.length), 1, 'Opt-out releases the native composer');
  }
  // Audience changes during preparation must never send with the previous audience.
  await setup(original, { holdPrepare: true }); await post();
  await page.waitForFunction(() => !!window.__releasePrepare);
  await page.getByRole('combobox').selectOption('1'); await page.evaluate(() => window.__releasePrepare());
  await page.getByText(/Post paused: Your draft/).waitFor();
  assert.equal((await model()).blocks.join('\n'), original); assert.deepEqual(await page.evaluate(() => window.__posts), []);

  // Turning off the preference removes only our invitation from the editor model.
  await setup(original, { blockAfterPaste: true }); await post();
  await page.getByText(/Post paused: Facebook is still preparing/).waitFor();
  await page.evaluate(() => window.__attribution = false); await page.addScriptTag({ content: script });
  await page.waitForFunction(text => window.__model().blocks.join('\n') === text, original);
  assert.equal(await page.locator('[contenteditable] a').getAttribute('href'), 'https://opensocial.online/');
  assert.deepEqual(errors, []); await context.close();
  console.log('Real Lexical Facebook regression passed: exact reported URL-ending draft, rich/plain editor state, start/end/selected text, isolated world, blank paragraph, original links preserved, one native submit, permalink completion, opt-out, refusal/corruption recovery, retry without duplicate links, audience changes and preference removal; fixture network only');
} finally { await browser.close(); }
