// Optional real-browser check of the packaged pages, under the shipped CSP.
// No live RPC/indexer requests or transactions: fixtures intercept every request.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ABIS } from '@osp/proto';
import { encode, exportIdentity, identityFromSeed, encodeProfile, toBase64url } from '@osp/sdk';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const deployment = JSON.parse(readFileSync(new URL('../../../deployments/harbinger.json', import.meta.url), 'utf8'));
const seed = new Uint8Array(32).fill(93), identity = identityFromSeed(seed, 1), account = identity.account;
const profileUri = 'data:application/x-osp-profile;base64,' + toBase64url(encodeProfile({ display_name: 'Extension QA', bio: 'Local browser test' }));
const profile = { account, profileUri, profileHash:'', encryptionKey: toBase64url(identity.encryption.publicKey), keyVersion: 1, counts:{posts:0,friends:0,followers:0,following:0} };
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const filename = path.resolve(dist, '.' + pathname);
  if (!filename.startsWith(dist + path.sep) || !existsSync(filename)) { res.writeHead(404);res.end();return; }
  const type = ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[path.extname(filename)] || 'application/octet-stream';
  res.writeHead(200, {'content-type':type,'content-security-policy':manifest.content_security_policy.extension_pages});res.end(readFileSync(filename));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH && {executablePath:process.env.CHROMIUM_PATH}),args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const failures=[], writes=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:950}});
  await context.addInitScript(({origin,version})=>{
    const event={addListener(){},removeListener(){}};
    window.__extensionCalls=[];
    window.chrome={runtime:{getURL:p=>origin+'/'+p,getManifest:()=>({version}),openOptionsPage:async()=>{},sendMessage:async({type})=>{
      if(type==='settings.get') return {ok:true,result:{settings:{network:'harbinger',rpcUrls:[],sponsorUrls:[],indexerUrl:'',payment:'sponsor-only',autoLockMinutes:15}}};
      if(type==='vault.status')return{ok:true,result:{status:'empty',network:{deployed:true,indexerUrl:''},pending:0}};
      if(type==='crosspost.list')return{ok:true,result:{items:[]}};
      throw Error('Unexpected worker request '+type);
    }},storage:{onChanged:event},tabs:{create:async data=>window.__extensionCalls.push(data)}};
  },{origin,version:manifest.version});
  await context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url()); if(url.origin===origin)return route.continue();
    if(req.method()==='POST') {
      const call=req.postDataJSON();
      if(call.method==='chain.get_chain_id')return route.fulfill({json:{jsonrpc:'2.0',id:call.id,result:{chain_id:deployment.chainId}}});
      if(call.method==='chain.read_contract') {
        const namespace=Object.entries(deployment.contracts).find(([,c])=>c.address===call.params.contract_id)?.[0];
        const method=Object.entries(ABIS[namespace]?.methods??{}).find(([,m])=>m.entry_point===call.params.entry_point);
        let value={};
        if(method?.[0]==='get_identity')value={value:{account,owner:account,encryption_key:identity.encryption.publicKey,key_version:1,protocol_version:1,profile_uri:profileUri}};
        if(method?.[0]==='balance_of')value={value:'70'};
        if(namespace==='token'&&method?.[0]==='get_account')value={value:{balance:'70',free_credits:'100',token_credits:'100',resource_version:2,free_ticks:'10000',token_ticks:'10000',ticks_per_unit:'100'},capacity:'100'};
        return route.fulfill({json:{jsonrpc:'2.0',id:call.id,result:{result:method?toBase64url(encode(method[1].return,value)):''}}});
      }
      if(/submit|broadcast|transaction/.test(call.method??''))writes.push(call.method);
      return route.fulfill({json:{jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'Fixture: no live writes'}}});
    }
    if(url.pathname.startsWith('/v1/graph/'))return route.fulfill({json:{account,friends:[],followers:[],following:[],pendingIncoming:[],pendingOutgoing:[],audienceEpoch:0,blocked:[]}});
    if(url.pathname.startsWith('/v1/profiles/'))return route.fulfill({json:profile});
    if(url.pathname==='/v1/people')return route.fulfill({json:{items:[profile]}});
    return route.fulfill({json:{items:[],nextCursor:null,counts:{},pending:0}});
  });
  const page=await context.newPage();page.on('pageerror',e=>{failures.push(e.message);console.error('PAGE ERROR',e.message)});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text())});page.setDefaultTimeout(20000);
  await page.goto(origin+'/src/sidepanel/index.html');
  const social=page.frameLocator('iframe.social-frame');
  await social.getByRole('button',{name:'Sign in with an identity file',exact:true}).waitFor().catch(async e=>{for(const f of page.frames())console.error('FRAME',f.url(),(await f.locator('body').innerText()).slice(0,1800));await page.screenshot({path:'/tmp/extension-failure.png',fullPage:true});throw e;});
  const originalFrame=page.frames().find(f=>f.url().includes('/social/'));
  await originalFrame.evaluate(()=>window.keepAliveTest='kept');
  await page.getByRole('button',{name:'Browser tools',exact:true}).click();
  await page.getByRole('button',{name:'Social',exact:true}).click();
  assert.equal(await originalFrame.evaluate(()=>window.keepAliveTest),'kept','Switching views must preserve pending uploads');
  await page.getByRole('button',{name:'Open in tab',exact:false}).click();
  assert.ok((await page.evaluate(()=>window.__extensionCalls))[0].url.startsWith(origin+'/social/index.html#/'));
  await social.getByRole('button',{name:'Sign in with an identity file',exact:true}).click();
  await social.getByLabel('Or paste its contents').fill(exportIdentity({seed,keyVersion:1,account}));
  await social.getByLabel('Passphrase',{exact:true}).fill('local test passphrase');
  await social.getByLabel('Repeat the passphrase').fill('local test passphrase');
  await social.getByRole('button',{name:'Import account',exact:true}).click();
  await social.getByText('Total: $11.90',{exact:true}).waitFor().catch(async e=>{console.error('SIGNIN',await social.locator('body').innerText());throw e;});
  assert.ok((await social.locator('body').innerText()).includes('Total: $11.90'));
  await originalFrame.evaluate(()=>location.hash='#/me');
  await social.getByRole('tab',{name:'Videos',exact:true}).waitFor();
  assert.deepEqual(await social.locator('[aria-label="Profile views"] [role="tab"]').allTextContents(),['Posts','Groups','About','Photos','Music','Videos']);
  await originalFrame.evaluate(()=>location.hash='#/compose?mode=voice');
  await social.getByRole('button',{name:'Record voice',exact:true}).click();
  await social.getByRole('button',{name:/^Stop/}).waitFor();
  await page.waitForTimeout(1200);
  await social.getByRole('button',{name:/^Stop/}).click();
  await social.getByRole('button',{name:'Remove recording',exact:true}).waitFor();
  await social.getByRole('button',{name:'Remove recording',exact:true}).click();
  if(process.env.TEST_VIDEO) {
    await originalFrame.evaluate(()=>location.hash='#/');
    await originalFrame.evaluate(()=>location.hash='#/compose?mode=video');
    await social.getByLabel('Choose a video file').setInputFiles(process.env.TEST_VIDEO);
    await social.getByText('Video preview ready',{exact:false}).waitFor();
  }
  // Exercise the actual shipped encrypted-messaging engine under the same CSP.
  const wasmModule=readdirSync(path.join(dist,'social/assets')).find(p=>/^vodozemac-.*\.js$/.test(p));
  const publicKey=await originalFrame.evaluate(async url=>{const m=await import(url);await m.initAsync();const a=new m.Account();const key=a.curve25519_key;a.free();return key;},origin+'/social/assets/'+wasmModule);
  assert.ok(publicKey,'Encrypted-messaging WASM must initialize');
  await page.screenshot({path:process.env.EXTENSION_SCREENSHOT || '/tmp/extension-social.png',fullPage:true});
  assert.deepEqual(writes,[],'Browser test must never publish');
  assert.deepEqual(failures,[],'No uncaught errors in the packaged pages');
  console.log('Browser smoke passed: shipped CSP, sign-in, OSAT total, profile tabs, view persistence, voice recording, video preview, messaging WASM. No live transactions.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
