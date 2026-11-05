// Standalone panel acceptance with real Chromium, an encrypted local fixture account,
// the shipped CSP and intercepted protocol reads. No website or live transaction is used.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {identityFromSeed,lockVault,encodeProfile,toBase64url,encode} from '@osp/sdk';
import {ABIS} from '@osp/proto';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url))),manifest=JSON.parse(readFileSync(path.join(dist,'manifest.json'),'utf8'));
const seed=new Uint8Array(32).fill(31),me=identityFromSeed(seed),passphrase='fixture passphrase';
const deployment=JSON.parse(readFileSync(new URL('../../../deployments/harbinger.json',import.meta.url),'utf8'));
const profileUri='data:application/x-osp-profile;base64,'+toBase64url(encodeProfile({display_name:'Extension QA',bio:'Local browser test'}));
const profile={account:me.account,profileUri,profileHash:'',encryptionKey:toBase64url(me.encryption.publicKey),keyVersion:1,counts:{posts:0,friends:0,followers:0,following:0}};
const blob=await lockVault({seed,keyVersion:1,account:me.account},passphrase,{kdf:{N:1024,r:8,p:1}});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH&&{executablePath:process.env.CHROMIUM_PATH}),args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
try {
 const context=await browser.newContext({viewport:{width:390,height:900}}),requests=[],errors=[];
 await context.addInitScript(({account})=>{
  const listeners=new Set();window.__xEnabled=false;window.__xScope="all";window.__permissions=[];
  window.chrome={runtime:{getManifest:()=>({version:'0.6.0'}),getURL:p=>'https://extension.test/'+p,openOptionsPage:async()=>{},sendMessage:async({type,payload})=>{
   if(type==='vault.status')return{ok:true,result:{status:'locked',account,mode:'device',deviceAuthorized:true,network:{deployed:true}}};
   if(type==='crosspost.list')return{ok:true,result:{items:[]}};
   if(type==='settings.get')return{ok:true,result:{settings:{network:'harbinger',rpcUrls:[],indexerUrl:'',sponsorUrls:[],autoLockMinutes:15,payment:'sponsor-then-self',xFeedInsertion:window.__xEnabled,xFeedScope:window.__xScope},resolved:{network:'harbinger',deployed:true,rpcUrls:[],indexerUrl:'',sponsorUrls:[]},networks:['harbinger']}};
   if(type==='adapter.status')return{ok:true,result:{facebook:{wanted:false,granted:false,registered:false},x:{wanted:window.__xEnabled,granted:window.__xEnabled,registered:window.__xEnabled},feedInsertion:false}};
   if(type==='adapter.enable'&&payload.adapter==='x'){window.__xEnabled=true;return{ok:true,result:{}};}
   if(type==='adapter.disable'&&payload.adapter==='x'){window.__xEnabled=false;return{ok:true,result:{}};}
   if(type==='settings.update'&&payload.patch.xFeedScope){window.__xScope=payload.patch.xFeedScope;return{ok:true,result:{}};}
   if(type==='vault.lock')return{ok:true,result:{}};
   throw Error('Unexpected fixture worker request '+type);
  }},permissions:{request:async({origins})=>{window.__permissions.push(origins);return true;}},storage:{onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}}};
 },{account:me.account});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push(url.href);
  if(url.origin==='https://extension.test') {
   if(url.pathname==='/setup')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture setup</body>'});
   const file=path.resolve(dist,'.'+url.pathname);
   assert.ok(file.startsWith(dist+path.sep)&&existsSync(file),'Only packaged extension resources are loaded');
   return route.fulfill({body:readFileSync(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream',headers:{'content-security-policy':manifest.content_security_policy.extension_pages}});
  }
  assert.notEqual(url.hostname,'opensocial.online','The website is never loaded');
  if(req.method()==='POST') {
   const input=req.postDataJSON();
   const answer=m=>{
    assert.ok(!/submit|broadcast|send_transaction/.test(m.method),'Fixture must never submit a transaction');
    if(m.method==='chain.read_contract') {
      const namespace=Object.entries(deployment.contracts).find(([,c])=>c.address===m.params.contract_id)?.[0];
      const method=Object.entries(ABIS[namespace]?.methods??{}).find(([,v])=>v.entry_point===m.params.entry_point);
      let value={};
      if(method?.[0]==='get_identity')value={value:{account:me.account,owner:me.account,encryption_key:me.encryption.publicKey,key_version:1,protocol_version:1,profile_uri:profileUri}};
      if(method?.[0]==='balance_of')value={value:'70'};
      if(namespace==='token'&&method?.[0]==='get_account')value={value:{balance:'70',free_credits:'100',token_credits:'100',resource_version:2,free_ticks:'10000',token_ticks:'10000',ticks_per_unit:'100'},capacity:'100'};
      return {jsonrpc:'2.0',id:m.id,result:{result:method?toBase64url(encode(method[1].return,value)):''}};
    }
    return {jsonrpc:'2.0',id:m.id,result:m.method==='chain.read_contract'?{result:'',logs:[]}:m.method==='chain.get_head_info'?{head_topology:{height:'1'},head_block_time:String(Date.now())}:m.method==='chain.get_chain_id'?{chain_id:'EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ=='}:{}};
   };
   return route.fulfill({json:Array.isArray(input)?input.map(answer):answer(input)});
  }
  if(url.pathname.startsWith('/v1/profiles/'))return route.fulfill({json:profile});
  if(url.pathname.startsWith('/v1/graph/'))return route.fulfill({json:{account:me.account,friends:[],followers:[],following:[],pendingIncoming:[],pendingOutgoing:[],audienceEpoch:0,blocked:[]}});
  return route.fulfill({json:{items:[],nextCursor:null,counts:{},pending:0}});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://extension.test/setup');
 await page.evaluate(async record=>{
  await new Promise((resolve,reject)=>{const open=indexedDB.open('osp-web');open.onupgradeneeded=()=>open.result.createObjectStore('vault');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('vault','readwrite');tx.objectStore('vault').put(record,'osp.web.vault');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 },{version:1,account:me.account,blob,createdAt:Date.now()});
 await page.goto('https://extension.test/src/sidepanel/index.html#/compose');
 await page.getByRole('heading',{name:'Unlock your account'}).waitFor();
 await page.getByLabel('Passphrase',{exact:true}).fill(passphrase);await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('heading',{name:'Create a post'}).waitFor();
 assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.getByRole('button',{name:/Open in tab|^Social$/}).count(),0);
 assert.equal(await page.locator('.client-nav a').count(),6);
 const nav=page.getByRole('navigation',{name:'Browser tools navigation'});
 await page.getByText('Total: $11.90',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Voice',exact:true}).click();await page.getByRole('button',{name:'Record voice',exact:true}).click();
 await page.getByRole('button',{name:/^Stop/}).waitFor();await page.waitForTimeout(1100);await page.getByRole('button',{name:/^Stop/}).click();
 await page.getByRole('button',{name:'Remove recording',exact:true}).click();
 await page.getByRole('button',{name:'Video',exact:true}).click();await page.locator('input[type=file][accept*="video"]').waitFor({state:'attached'});
 if(process.env.TEST_VIDEO) {await page.getByLabel('Choose a video file').setInputFiles(process.env.TEST_VIDEO);await page.getByText('Video preview ready',{exact:false}).waitFor();}
 await nav.getByRole('link',{name:'Profile',exact:true}).click();await page.getByRole('tab',{name:'Videos',exact:true}).waitFor();
 assert.deepEqual(await page.locator('[aria-label="Profile views"] [role="tab"]').allTextContents(),['Posts','Groups','About','Photos','Music','Videos']);
 await nav.getByRole('link',{name:'Groups',exact:true}).click();await page.getByRole('heading',{name:'Your groups'}).waitFor();
 await nav.getByRole('link',{name:'Messages',exact:true}).click();await page.getByRole('heading',{name:'Messages',exact:true}).waitFor();
 await nav.getByRole('link',{name:'Friends',exact:true}).click();await page.getByRole('heading',{name:/Friends/}).first().waitFor();
 await nav.getByRole('link',{name:'Post',exact:true}).click();await page.getByRole('heading',{name:'Create a post'}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Panel fits a 390px browser sidebar');
 await page.screenshot({path:'/tmp/open-social-native-panel.png',fullPage:true});
 await page.getByRole('button',{name:'More menu',exact:true}).click();
 await page.getByRole('link',{name:'Account & settings',exact:true}).click();await page.locator('.settings-nav').waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings fit the panel');
 const wasmModule=readdirSync(path.join(dist,'assets')).find(p=>/^vodozemac-.*\.js$/.test(p));
 const publicKey=await page.evaluate(async url=>{const m=await import(url);await m.initAsync();const a=new m.Account();const key=a.curve25519_key;a.free();return key;},'https://extension.test/assets/'+wasmModule);
 assert.ok(publicKey,'Encrypted-messaging WASM initializes under the shipped CSP');
 await page.getByRole('button',{name:'More menu',exact:true}).click();await page.getByRole('link',{name:'Browser connections',exact:true}).click();
 await page.getByRole('heading',{name:'Browser connections',exact:true}).waitFor();
 const xSettings=page.locator('section').filter({has:page.getByRole('heading',{name:'X feed integration',exact:true})});
 await xSettings.getByRole('button',{name:'Enable X feed (asks for site access)',exact:true}).click();
 await xSettings.getByRole('button',{name:'Disable X and remove site access',exact:true}).waitFor();
 await xSettings.getByRole('combobox').selectOption('friends');
 assert.deepEqual(await page.evaluate(()=>window.__permissions),[['https://x.com/*','https://www.x.com/*']]);
 assert.equal(await page.evaluate(()=>window.__xScope),'friends');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Connection settings fit the panel');
 await xSettings.getByRole('button',{name:'Disable X and remove site access',exact:true}).click();await xSettings.getByRole('button',{name:'Enable X feed (asks for site access)',exact:true}).waitFor();
 await page.getByRole('button',{name:'More menu',exact:true}).click();await page.getByRole('button',{name:'Lock account and site connections',exact:true}).click();
 await nav.getByRole('link',{name:'Groups',exact:true}).click();await page.getByRole('heading',{name:'Unlock your account'}).waitFor();
 assert.equal(context.pages().length,1,'Feature navigation stays inside the panel');assert.deepEqual(errors,[]);
 console.log('Standalone panel browser checks passed: encrypted account reuse/unlock, native composer/voice/video, groups/messages/friends, settings, lock, narrow layout, no website/iframe/new-tab navigation; fixture network only');
 await context.close();
} finally {await browser.close();}
