// The previous plain-contenteditable fixture could not reproduce Draft's data loss.
// Run the shipped adapter against real Draft.js/React state, never live X APIs.
// Setup: npm ci --prefix apps/extension/scripts/fixtures/x-draft --ignore-scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const fixture = fileURLToPath(new URL('./fixtures/x-draft/', import.meta.url));
const bundle = await build({ entryPoints: [path.join(fixture, 'editor.jsx')], bundle: true, write: false, define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' } });
const script = readFileSync(new URL('../dist/content/x.js', import.meta.url), 'utf8');
const profile = 'https://opensocial.online/u/1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4';
const invitation = 'Join Me On Open Social: ' + profile;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><a data-testid="AppTabBar_Profile_Link" href="/fixture">Profile</a><main><div id="app"></div></main><div id="timeline"></div></body></html>' }));
  const setup = async (text, options = {}) => {
    await page.goto('https://x.com/home');
    await page.addStyleTag({ content: readFileSync(path.join(fixture, 'node_modules/draft-js/dist/Draft.css'), 'utf8') + '[contenteditable]{min-height:80px;min-width:400px;border:1px solid #888;padding:10px}' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ text, options, profile }) => {
      window.__limit = options.limit ?? 10000; window.__pasteMode = options.pasteMode ?? ''; window.__calls = []; window.__attribution = true; window.__invalidated = options.invalidated ?? false;
      window.__mount(text, options.modal);
      window.chrome = { runtime: { id: 'fixture', getURL: p => 'https://extension.test/' + p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: m => {
        if (window.__invalidated) throw Error('Extension context invalidated.');
        window.__calls.push(m);
        if (m.type === 'adapter.preferences') return { ok: true, result: { xEnabled: true, xAutoCheck: true, xAttribution: window.__attribution } };
        if (m.type === 'feed.request') return { ok: true, result: { enabled: false, items: [] } };
        if (m.type === 'crosspost.xPrepare') return { ok: true, result: { awaitingX: true, profileUrl: profile } };
        if (m.type === 'crosspost.xComplete') return { ok: true, result: { status: 'published', message: 'Published fixture' } };
        throw Error('Unexpected fixture request ' + m.type);
      } } };
    }, { text, options, profile });
    if(options.isolated) {
      await page.evaluate(()=>document.addEventListener('osp-fixture-rpc',e=>window.__calls.push(JSON.parse(e.detail))));
      const cdp=await context.newCDPSession(page),tree=await cdp.send('Page.getFrameTree');
      const world=await cdp.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'osp-draft-fixture'});
      const bootstrap=`globalThis.chrome={runtime:{id:'fixture',getURL:p=>'https://extension.test/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{
        document.dispatchEvent(new CustomEvent('osp-fixture-rpc',{detail:JSON.stringify(m)}));
        if(m.type==='adapter.preferences')return{ok:true,result:{xEnabled:true,xAutoCheck:true,xAttribution:true}};
        if(m.type==='feed.request')return{ok:true,result:{enabled:false,items:[]}};
        if(m.type==='crosspost.xPrepare')return{ok:true,result:{awaitingX:true,profileUrl:${JSON.stringify(profile)}}};
        if(m.type==='crosspost.xComplete')return{ok:true,result:{status:'published'}};throw Error(m.type);
      }}};`;
      const executed=await cdp.send('Runtime.evaluate',{contextId:world.executionContextId,expression:bootstrap+script,awaitPromise:true});
      assert.equal(executed.exceptionDetails,undefined);await cdp.detach();
    } else await page.addScriptTag({ content: script });
    if(options.invalidated) await page.getByRole('alert').filter({hasText:'The extension was reloaded.'}).waitFor();
    else await page.getByRole('checkbox').waitFor();
  };
  const post = () => page.getByRole('button', { name: 'Post', exact: true }).click();
  const model = () => page.evaluate(() => window.__model());
  for (const [text, selection, modal, isolated] of [
    ['Big things are coming to Open Social', 'End', false],
    ['Big things are coming to Open Social', 'Home', true],
    ['@friend news 🚀\n\nSecond paragraph https://example.test/page', 'Control+a', false, true],
  ]) {
    await setup(text, { modal, isolated });
    await page.getByRole('textbox').click(); await page.keyboard.press(selection);
    const before = await model(); await post();
    await page.waitForFunction(() => window.__posts.length === 1);
    const expected = text + '\n\n' + invitation;
    assert.equal(await page.evaluate(() => window.__posts[0]), expected);
    assert.equal((await model()).text, expected);
    assert.deepEqual((await model()).raw.entityMap, before.raw.entityMap, 'Mentions survive the insertion');
    assert.equal(await page.evaluate(() => window.__pastes), 1);
    assert.equal(await page.evaluate(() => window.__calls.find(m => m.type === 'crosspost.xPrepare').payload.text), text);
    assert.equal(await page.evaluate(() => window.__calls.some(m => m.type === 'crosspost.xComplete')), false);
    await page.evaluate(() => { const toast = document.createElement('div'); toast.dataset.testid = 'toast'; toast.innerHTML = '<a href="https://x.com/fixture/status/123">View</a>'; document.querySelector('#timeline').append(toast); });
    await page.waitForFunction(() => window.__calls.some(m => m.type === 'crosspost.xComplete'));
  }
  await setup('Keep this draft', { limit: 50 }); await post();
  await page.getByText(/Post paused: X cannot submit/).waitFor();
  assert.equal((await model()).text, 'Keep this draft', 'Native cut removes only the managed footer and blank blocks');
  assert.deepEqual(await page.evaluate(() => window.__posts), []);
  await page.evaluate(() => window.__attribution = false); await page.addScriptTag({ content: script }); await page.waitForTimeout(100); await post();
  await page.waitForFunction(() => window.__posts.length === 1); assert.equal(await page.evaluate(() => window.__posts[0]), 'Keep this draft');

  for (const pasteMode of ['refuse', 'corrupt']) {
    await setup('Preserve original sentence', { pasteMode }); await post();
    await page.getByRole('textbox', { name: 'Original post text' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Original post text' }).inputValue(), 'Preserve original sentence');
    await page.evaluate(()=>document.querySelector('[data-osp-control]').remove());
    await page.getByRole('checkbox').waitFor();
    await page.getByRole('textbox', { name: 'Original post text' }).waitFor();
    await post(); await post();
    assert.equal(await page.evaluate(() => window.__pastes), 1, 'A failed write never repeats or appends extra links');
    assert.equal(await page.evaluate(() => window.__calls.filter(m => m.type === 'crosspost.xPrepare').length), 1);
    assert.deepEqual(await page.evaluate(() => window.__posts), []);
    await page.getByRole('checkbox').uncheck(); await post();
    assert.equal(await page.evaluate(() => window.__posts.length), 1, 'Opt-out releases the host composer');
  }
  await setup('Draft survives extension reload'); await page.evaluate(() => window.__invalidated = true); await post();
  await page.getByRole('alert').filter({ hasText: 'The extension was reloaded.' }).waitFor();
  assert.equal((await model()).text, 'Draft survives extension reload');
  assert.equal(await page.locator('[data-osp-control]').count(), 0); assert.equal(await page.evaluate(() => window.__posts.length), 0);
  await post(); assert.equal(await page.evaluate(() => window.__posts.length), 1, 'Invalidated controls do not keep swallowing native Post');
  await setup('Old script at startup', {invalidated:true});
  assert.equal(await page.locator('[data-osp-control]').count(),0);await post();assert.equal(await page.evaluate(()=>window.__posts[0]),'Old script at startup');
  await setup('Already sent on X');await post();await page.waitForFunction(()=>window.__posts.length===1);
  await page.evaluate(()=>{window.__invalidated=true;const toast=document.createElement('div');toast.dataset.testid='toast';toast.innerHTML='<a href="https://x.com/fixture/status/987">View</a>';document.querySelector('#timeline').append(toast);});
  await page.getByRole('alert').filter({hasText:'Do not post it again.'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__posts.length),1);assert.equal(await page.locator('[data-osp-control]').count(),0);
  assert.deepEqual(errors, []); await context.close();
  console.log('Real Draft.js X regression passed: original sentence, start/end/selected text, decorated links/mentions, paragraphs, one invitation in committed state, native submit, long-draft rollback, refused/corrupt paste no retries, backup and stale-context release; fixture network only');
} finally { await browser.close(); }
