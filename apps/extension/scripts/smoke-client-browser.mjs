// Standalone panel acceptance with real Chromium, an encrypted local fixture account,
// the shipped CSP and intercepted protocol reads. No website or live transaction is used.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {identityFromSeed,lockVault,encodeProfile,toBase64url,encode,contentHash,encryptContent,decode,fromBase64url,decodeEnvelope,decryptContent} from '@osp/sdk';
import {ABIS} from '@osp/proto';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url))),manifest=JSON.parse(readFileSync(path.join(dist,'manifest.json'),'utf8'));
const webDist=path.resolve(fileURLToPath(new URL('../../web/dist/',import.meta.url)));
const mainnetDeployment=JSON.parse(readFileSync(new URL('../../../deployments/mainnet.json',import.meta.url),'utf8'));
const seed=new Uint8Array(32).fill(31),me=identityFromSeed(seed),passphrase='fixture passphrase';
const deployment=JSON.parse(readFileSync(new URL('../../../deployments/harbinger.json',import.meta.url),'utf8'));
const profileUri='data:application/x-osp-profile;base64,'+toBase64url(encodeProfile({display_name:'Extension QA',bio:'Local browser test'}));
const profile={account:me.account,profileUri,profileHash:'',encryptionKey:toBase64url(me.encryption.publicKey),keyVersion:1,counts:{posts:0,friends:0,followers:0,following:0}};
let topicPosts=[];
let revisionFixture;
const topicPost=(text,n)=>{
 const sealed=encryptContent({content:{version:1,mime:'text/plain',text}}),hash=toBase64url(sealed.contentHash);
 return {postId:toBase64url(new Uint8Array(32).fill(n)),author:me.account,sequence:String(n),versionNumber:1,contentHash:hash,envelope:toBase64url(sealed.bytes),audience:0,audienceId:'',epoch:0,replyTo:'',state:0,stateReason:'',createdAt:String(Date.now()),updatedAt:String(Date.now()),txId:'fixture-only',blockHeight:'1',labels:[],versions:[],media:[],reactions:{total:0,byType:{}},replyCount:0};
};
const blob=await lockVault({seed,keyVersion:1,account:me.account},passphrase,{kdf:{N:1024,r:8,p:1}});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH&&{executablePath:process.env.CHROMIUM_PATH}),args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
try {
 const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),requests=[],errors=[],hostedFiles=new Map();
 await context.addInitScript(({account})=>{
  const listeners=new Set();window.__xEnabled=false;window.__xFeed=false;window.__xAuto=true;window.__xAttribution=true;window.__xScope="all";window.__permissions=[];
  window.chrome={runtime:{getManifest:()=>({version:'0.7.0'}),getURL:p=>'https://extension.test/'+p,openOptionsPage:async()=>{},sendMessage:async({type,payload})=>{
   if(type==='vault.status')return{ok:true,result:{status:'locked',account,mode:'device',deviceAuthorized:true,network:{deployed:true}}};
   if(type==='crosspost.list')return{ok:true,result:{items:[]}};
   if(type==='settings.get')return{ok:true,result:{settings:{network:'harbinger',rpcUrls:[],indexerUrl:'',sponsorUrls:[],autoLockMinutes:15,payment:'sponsor-then-self',xAdapter:window.__xEnabled,xFeedInsertion:window.__xFeed,xAutoCheck:window.__xAuto,xAttribution:window.__xAttribution,xFeedScope:window.__xScope},resolved:{network:'harbinger',deployed:true,rpcUrls:[],indexerUrl:'',sponsorUrls:[]},networks:['harbinger']}};
   if(type==='adapter.status')return{ok:true,result:{facebook:{wanted:false,granted:false,registered:false},x:{wanted:window.__xEnabled,granted:window.__xEnabled,registered:window.__xEnabled},feedInsertion:false}};
   if(type==='adapter.enable'&&payload.adapter==='x'){window.__xEnabled=true;window.__xFeed=true;return{ok:true,result:{}};}
   if(type==='adapter.disable'&&payload.adapter==='x'){window.__xEnabled=false;return{ok:true,result:{}};}
   if(type==='settings.update'){const p=payload.patch;if(p.xFeedScope)window.__xScope=p.xFeedScope;if(typeof p.xAutoCheck==='boolean')window.__xAuto=p.xAutoCheck;if(typeof p.xAttribution==='boolean')window.__xAttribution=p.xAttribution;if(typeof p.xFeedInsertion==='boolean')window.__xFeed=p.xFeedInsertion;return{ok:true,result:{}};}
   if(type==='vault.lock')return{ok:true,result:{}};
   throw Error('Unexpected fixture worker request '+type);
  }},permissions:{request:async({origins})=>{window.__permissions.push(origins);return true;}},storage:{onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}}};
 },{account:me.account});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push(url.href);
  const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,HEAD,POST,OPTIONS','access-control-allow-headers':'*','access-control-expose-headers':'Content-Length'};
  const fulfill=options=>route.fulfill({...options,headers:{...options.headers,...cors}});
  if(req.method()==='OPTIONS')return fulfill({status:204});
  if(['https://extension.test','https://public.fixture.test'].includes(url.origin)) {
   if(url.pathname==='/setup')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Fixture setup</body>'});
   const root=url.origin==='https://extension.test'?dist:webDist;
   const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   assert.ok(file.startsWith(root+path.sep)&&existsSync(file),'Only packaged extension resources are loaded');
   return route.fulfill({body:readFileSync(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream',headers:url.origin==='https://extension.test'?{'content-security-policy':manifest.content_security_policy.extension_pages}:{}});
  }
  assert.notEqual(url.hostname,'opensocial.online','The website is never loaded');
  if(url.hostname==='media.fixture.test'){
   const body=hostedFiles.get(url.pathname);assert.ok(body,'Only fixture-owned recordings are delivered');
   return fulfill({status:200,headers:{'content-length':String(body.length),'content-type':'application/octet-stream'},...(req.method()!=='HEAD'&&{body})});
  }
  if(url.pathname==='/v1/media'){
   if(req.method()==='POST'){
    const body=req.postDataBuffer(),hash=toBase64url(contentHash(body)),key=`/osp/test/identity/${hash}`;hostedFiles.set(key,body);
    return fulfill({json:{url:`https://media.fixture.test${key}`,hash,size:body.length}});
   }
   return fulfill({json:{enabled:true,provider:'r2',chainId:deployment.chainId,contract:deployment.contracts.identity.address,publicUrl:'https://media.fixture.test',maxFileBytes:26214400}});
  }
  if(req.method()==='POST') {
   const input=req.postDataJSON();
   const answer=m=>{
    assert.ok(!/submit|broadcast|send_transaction/.test(m.method),'Fixture must never submit a transaction');
    if(m.method==='block_store.get_blocks_by_height'&&revisionFixture){
      const activeDeployment=mainnetDeployment.rpc.some(endpoint=>new URL(endpoint).origin===url.origin)?mainnetDeployment:deployment;
      const {post,original}=revisionFixture;
      const data=encode('publications.published_event',{author:post.author,post_id:fromBase64url(post.postId),audience:0,version_number:1,content_hash:fromBase64url(original.contentHash),envelope:fromBase64url(original.envelope)});
      return {jsonrpc:'2.0',id:m.id,result:{block_items:[{block_height:'1',block_id:'fixture-head',receipt:{transaction_receipts:[{id:'revision-fixture',reverted:false,events:[{sequence:1,source:activeDeployment.contracts.publications.address,name:'osp.publications.published',data:toBase64url(data)}]}]}}]}};
    }
    if(m.method==='chain.read_contract') {
      const namespace=[...Object.entries(deployment.contracts),...Object.entries(mainnetDeployment.contracts)].find(([,c])=>c.address===m.params.contract_id)?.[0];
      const method=Object.entries(ABIS[namespace]?.methods??{}).find(([,v])=>v.entry_point===m.params.entry_point);
      let value={};
      if(method?.[0]==='get_identity')value={value:{account:me.account,owner:me.account,encryption_key:me.encryption.publicKey,key_version:1,protocol_version:1,profile_uri:profileUri}};
      if(method?.[0]==='get_post') {
        const args=decode('publications.get_post_arguments',fromBase64url(m.params.args)),post=topicPosts.find(p=>p.postId===toBase64url(args.post_id));
        if(post)value={value:{author:post.author,audience:post.audience,state:post.state,version_count:post.versionNumber,latest_version:fromBase64url(post.contentHash),reply_to:fromBase64url(post.replyTo||''),quote_post_id:fromBase64url(post.quotePostId||''),quote_version:fromBase64url(post.quoteVersion||'')}};
      }
      if(method?.[0]==='get_library_version')value={version:1,external_media_version:1,content_reference_version:1,hosted_manifest_version:1,quote_reference_version:1};
      if(method?.[0]==='balance_of')value={value:'70'};
      if(namespace==='token'&&method?.[0]==='get_account')value={value:{balance:'70',free_credits:'100',token_credits:'100',resource_version:2,free_ticks:'10000',token_ticks:'10000',ticks_per_unit:'100'},capacity:'100'};
      return {jsonrpc:'2.0',id:m.id,result:{result:method?toBase64url(encode(method[1].return,value)):''}};
    }
    return {jsonrpc:'2.0',id:m.id,result:m.method==='chain.read_contract'?{result:'',logs:[]}:m.method==='chain.get_head_info'?{head_topology:{height:'1',id:'fixture-head'},head_block_time:String(Date.now())}:m.method==='chain.get_chain_id'?{chain_id:mainnetDeployment.rpc.some(endpoint=>new URL(endpoint).origin===url.origin)?mainnetDeployment.chainId:deployment.chainId}:{}};
   };
   return fulfill({json:Array.isArray(input)?input.map(answer):answer(input)});
  }
  if(['/v1/feed','/v2/feed'].includes(url.pathname))return fulfill({json:{items:topicPosts,nextCursor:null}});
  if(/^\/v1\/posts\/[^/]+\/preview$/.test(url.pathname)){
   const post=topicPosts.find(p=>p.postId===decodeURIComponent(url.pathname.split('/')[3]));
   return fulfill({json:post&&post.audience===0&&post.state===0?{version:1,public:true,title:'Extension QA on Open Social',description:decryptContent({envelope:decodeEnvelope(fromBase64url(post.envelope))}).text}:{version:1,public:false,title:'Open Social',description:'Your people. Your world.'}});
  }
  if(/^\/v1\/posts\/[^/]+\/replies$/.test(url.pathname))return fulfill({json:{items:[],nextCursor:null}});
  if(url.pathname.startsWith('/v1/posts/'))return fulfill({json:topicPosts.find(p=>p.postId===decodeURIComponent(url.pathname.split('/')[3]))??{}});
  if(url.pathname.startsWith('/v1/profiles/'))return fulfill({json:profile});
  if(url.pathname.startsWith('/v1/graph/'))return fulfill({json:{account:me.account,friends:[],followers:[],following:[],pendingIncoming:[],pendingOutgoing:[],audienceEpoch:0,blocked:[]}});
  return fulfill({json:{items:[],nextCursor:null,counts:{},pending:0}});
 });
 if(!process.env.TOPICS_ONLY){
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 // First-time visitors can browse; writing still asks them to create an account.
 await page.goto('https://extension.test/src/sidepanel/index.html#/');
 await page.getByRole('tab',{name:'Public',exact:true}).waitFor();
 await page.getByText('Join Open Social to post, comment and react. Public posts are free to explore.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Welcome to Open Social',exact:true}).count(),0);
 await page.goto('https://extension.test/src/sidepanel/index.html#/compose');
 await page.getByRole('heading',{name:'Continue with your account',exact:true}).waitFor();
 await page.goto('https://extension.test/setup');
 await page.evaluate(async record=>{
  await new Promise((resolve,reject)=>{const open=indexedDB.open('osp-web');open.onupgradeneeded=()=>open.result.createObjectStore('vault');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('vault','readwrite');tx.objectStore('vault').put(record,'osp.web.vault');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 },{version:1,account:me.account,blob,createdAt:Date.now()});
 await page.goto('https://extension.test/src/sidepanel/index.html#/compose');
 await page.getByRole('heading',{name:'Unlock your account'}).waitFor();
 await page.getByLabel('Passphrase',{exact:true}).fill(passphrase);await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('button',{name:'Close composer',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Create a post',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Add media by URL',exact:true}).count(),0);
 const header=await page.locator('.composer-identity').evaluate(el=>{
  const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
  return{avatar:rect(el.querySelector('.avatar')),you:rect(el.querySelector('strong')),audience:rect(el.querySelector('select')),modes:rect(el.querySelector('.composer-modes'))};
 });
 assert.ok(Math.abs(header.you.top-header.audience.top)<12,'Audience dropdown aligns with You');
 assert.ok(header.modes.top>header.you.top&&header.modes.bottom<=header.avatar.bottom+8,'Both header rows fit beside the avatar');
 assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.getByRole('button',{name:/Open in tab|^Social$/}).count(),0);
 assert.equal(await page.locator('.client-nav a').count(),6);
 const nav=page.getByRole('navigation',{name:'Browser tools navigation'});
 await page.getByText('Total: $11.90',{exact:true}).waitFor();
 const ending='The final sentence is here.';
 const story=('A complete short story with paragraphs and room to breathe. '.repeat(4)+'\n\n').repeat(500).slice(0,100000-ending.length)+ending;
 assert.equal(story.length,100000);
 const storyField=page.getByRole('textbox',{name:'Write a post',exact:true});
 assert.equal(await storyField.getAttribute('data-max-characters'),'100000');
 await storyField.fill('A formatted post');
 await storyField.press('ControlOrMeta+a');
 await page.getByRole('button',{name:'Bold',exact:true}).click();
 assert.equal(await storyField.locator('strong').textContent(),'A formatted post');
 assert.equal(await storyField.textContent(),'A formatted post');
 await page.getByRole('button',{name:'Heading',exact:true}).click();
 assert.equal(await storyField.locator('h2 strong').textContent(),'A formatted post');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await storyField.locator('h2').count(),0);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 assert.equal(await storyField.locator('h2 strong').textContent(),'A formatted post');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The rich editor fits the narrow panel');
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await storyField.fill('');
 const pasted='<h2>Copied from a document</h2><p><strong>Bold words</strong> and <em>italic words</em> with a <a href="https://example.org">source</a>.</p><ul><li>First point</li><li>Second point</li></ul>';
 await page.evaluate(async html=>navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob(['Copied from a document'],{type:'text/plain'})})]),pasted);
 await storyField.click();await page.keyboard.press('ControlOrMeta+v');
 await storyField.locator('h2').waitFor();
 assert.equal(await storyField.locator('strong').textContent(),'Bold words');
 assert.equal(await storyField.locator('em').textContent(),'italic words');
 assert.equal(await storyField.locator('li').count(),2);
 assert.equal(new URL(await storyField.locator('a').getAttribute('href')).href,'https://example.org/');
 if(process.env.COMPOSER_SCREENSHOT){
   await page.screenshot({path:process.env.COMPOSER_SCREENSHOT});
   await page.setViewportSize({width:1280,height:950});await page.screenshot({path:process.env.COMPOSER_SCREENSHOT.replace('.png','-desktop.png')});
   await page.setViewportSize({width:320,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Composer fits 320px');
   await page.setViewportSize({width:390,height:900});
 }
 await page.getByRole('button',{name:'Review and publish',exact:true}).click();
 const pastedReview=page.getByRole('dialog');await pastedReview.waitFor();
 assert.equal(await pastedReview.locator('.post-markdown strong').textContent(),'Bold words');
 await pastedReview.getByRole('button',{name:'Cancel',exact:true}).click();
 await storyField.fill('Which format?');
 await page.getByRole('button',{name:'Add poll',exact:true}).click();
 const question=page.getByRole('textbox',{name:'Your poll question',exact:true});
 await question.click();await question.press('ControlOrMeta+a');
 await page.locator('.composer-content .rich-post-editor').getByRole('button',{name:'Bold',exact:true}).click();
 const firstAnswer=page.getByRole('textbox',{name:'Answer 1',exact:true}),secondAnswer=page.getByRole('textbox',{name:'Answer 2',exact:true});
 await firstAnswer.fill('Yes please');await firstAnswer.press('ControlOrMeta+a');
 await page.locator('.poll-editor .rich-post-editor').nth(0).getByRole('button',{name:'Bold',exact:true}).click();
 await secondAnswer.fill('No thanks');await secondAnswer.press('ControlOrMeta+a');
 await page.locator('.poll-editor .rich-post-editor').nth(1).getByRole('button',{name:'Italic',exact:true}).click();
 assert.equal(await question.locator('strong').textContent(),'Which format?');
 await page.getByRole('button',{name:'Review and publish',exact:true}).click();
 const pollReview=page.getByRole('dialog');await pollReview.waitFor();
 assert.equal(await pollReview.locator('.preview strong').textContent(),'Which format?');
 assert.equal(await pollReview.locator('li strong').textContent(),'Yes please');
 assert.equal(await pollReview.locator('li em').textContent(),'No thanks');
 await pollReview.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Remove poll',exact:true}).click();
 await storyField.fill('');
 await page.evaluate(text=>navigator.clipboard.writeText(text),story);
 await storyField.click();await page.keyboard.press('ControlOrMeta+v');
 await page.waitForFunction(()=>document.querySelector('.rich-post-content')?.textContent.includes('The final sentence is here.'));
 const savedStory=await storyField.evaluate(el=>el.editor.getMarkdown());
 assert.equal(savedStory,story,'A maximum-length pasted story keeps every character');
 await page.getByRole('button',{name:'Review and publish',exact:true}).click();
 const review=page.getByRole('dialog');await review.waitFor();
 assert.equal((await review.locator('.post-markdown').textContent()).replace(/\s+/g,' ').trim(),story.replace(/\s+/g,' ').trim(),'The complete story reaches the rendered Markdown review');
 await review.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await storyField.evaluate(el=>el.editor.getMarkdown()),story,'Cancelling keeps the entire story');
 await storyField.fill('');
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
 await nav.getByRole('link',{name:'Post',exact:true}).click();await page.getByRole('button',{name:'Close composer',exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Panel fits a 390px browser sidebar');
 await page.screenshot({path:'/tmp/open-social-native-panel.png',fullPage:true});
 const original=topicPost('Original public post with **bold** text',51);
 topicPosts=[original];await nav.getByRole('link',{name:'Feed',exact:true}).click();
 const originalCard=page.locator('article.post').last();await originalCard.getByText('Original public post with',{exact:false}).waitFor();
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://extension.test'});
 await originalCard.getByRole('button',{name:'Share post',exact:true}).click();
 await page.getByRole('button',{name:'Copy Link',exact:true}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),`https://opensocial.online/post/${encodeURIComponent(original.postId)}`);
 await originalCard.getByRole('button',{name:'Share post',exact:true}).click();
 await page.getByRole('link',{name:'Share to Open Social',exact:true}).click();
 await page.locator('.composer-quote').getByText('Original public post with',{exact:false}).waitFor();
 assert.equal((await page.getByRole('textbox',{name:'Write a post',exact:true}).innerText()).trim(),'');
 await page.getByRole('button',{name:'Review and publish',exact:true}).click();
 await page.getByRole('dialog').getByText('Original public post with',{exact:false}).waitFor();
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Remove shared post',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Review and publish',exact:true}).isDisabled(),true);
 topicPosts=[];
 await page.getByRole('button',{name:'More menu',exact:true}).click();
 await page.getByRole('link',{name:'Account & settings',exact:true}).click();await page.locator('.settings-nav').waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings fit the panel');
 const wasmModule=readdirSync(path.join(dist,'assets')).find(p=>/^vodozemac-.*\.js$/.test(p));
 const publicKey=await page.evaluate(async url=>{const m=await import(url);await m.initAsync();const a=new m.Account();const key=a.curve25519_key;a.free();return key;},'https://extension.test/assets/'+wasmModule);
 assert.ok(publicKey,'Encrypted-messaging WASM initializes under the shipped CSP');
 await page.getByRole('button',{name:'More menu',exact:true}).click();await page.getByRole('link',{name:'Browser connections',exact:true}).click();
 await page.getByRole('heading',{name:'Browser connections',exact:true}).waitFor();
 const xSettings=page.locator('section').filter({has:page.getByRole('heading',{name:'X integration',exact:true})});
 await xSettings.getByRole('button',{name:'Enable X (asks for site access)',exact:true}).click();
 await xSettings.getByRole('button',{name:'Disable X and remove site access',exact:true}).waitFor();
 await xSettings.getByRole('combobox').selectOption('friends');
 assert.deepEqual(await page.evaluate(()=>window.__permissions),[['https://x.com/*','https://www.x.com/*']]);
 assert.equal(await page.evaluate(()=>window.__xScope),'friends');
 const auto=xSettings.getByRole('checkbox',{name:'Automatically check “Also publish to Open Social” on new X posts'});
 const invite=xSettings.getByRole('checkbox',{name:'Add “Join Me On Open Social: ” and my profile link when I post on X'});
 assert.equal(await auto.isChecked(),true);assert.equal(await invite.isChecked(),true);
 await auto.uncheck();await page.waitForFunction(()=>window.__xAuto===false);await invite.uncheck();await page.waitForFunction(()=>window.__xAttribution===false);
 await xSettings.getByRole('checkbox',{name:'Show Open Social post cards in the X Home timeline'}).uncheck();await page.waitForFunction(()=>window.__xFeed===false);
 assert.equal(await page.evaluate(()=>window.__xEnabled),true,'Disabling feed leaves X composer integration active');

 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Connection settings fit the panel');
 await xSettings.getByRole('button',{name:'Disable X and remove site access',exact:true}).click();await xSettings.getByRole('button',{name:'Enable X (asks for site access)',exact:true}).waitFor();
 await page.getByRole('button',{name:'More menu',exact:true}).click();await page.getByRole('button',{name:'Lock account and site connections',exact:true}).click();
 await nav.getByRole('link',{name:'Groups',exact:true}).click();await page.getByRole('heading',{name:'Unlock your account'}).waitFor();
 assert.equal(context.pages().length,1,'Feature navigation stays inside the panel');assert.deepEqual(errors,[]);
 console.log('Standalone panel browser checks passed: encrypted account reuse/unlock, guest public feed and protected compose, visual rich-text formatting, native rich clipboard paste, formatted poll questions/answers, undo/redo, 100,000-character story review and retention, native composer/voice/video, quote-only share review, canonical copy link, groups/messages/friends, settings, lock, 320px composer layout, no website/iframe/new-tab navigation; fixture network only');
 }
 // Check the real website shell as an anonymous desktop visitor too.
 const publicPage=await context.newPage();await publicPage.setViewportSize({width:1440,height:1000});
 publicPage.on('pageerror',e=>errors.push(e.message));
 topicPosts=[topicPost('#Koinos #FreshTopic',41)];
 await publicPage.goto('https://public.fixture.test/');
 const topics=publicPage.getByRole('region',{name:'Recent public topics'});
 await topics.getByRole('link',{name:'# freshtopic',exact:true}).waitFor();
 assert.equal(await topics.getByRole('link',{name:'# photography',exact:true}).count(),0);
 topicPosts=[topicPost('#NewestTopic',42)];
 await topics.getByRole('button',{name:'Refresh topics',exact:true}).click();
 await topics.getByRole('link',{name:'# newesttopic',exact:true}).waitFor();
 assert.equal(await topics.getByRole('link',{name:'# freshtopic',exact:true}).count(),0);
 topicPosts=[];await topics.getByRole('button',{name:'Refresh topics',exact:true}).click();
 await topics.getByText('No hashtags in recent public posts yet.',{exact:true}).waitFor();
 const publicSource=topicPost('Public original **quoted formatting**',61),publicShare=topicPost('My separate share',62);
 publicShare.quotePostId=publicSource.postId;publicShare.quoteVersion=publicSource.contentHash;topicPosts=[publicShare,publicSource];
 await publicPage.reload();await publicPage.locator('.quoted-post strong').getByText('quoted formatting',{exact:true}).waitFor();
 await publicPage.getByRole('article',{name:'Post by Extension QA',exact:true}).first().getByRole('link',{name:/Open post from/}).click();
 await publicPage.locator('.quoted-post strong').getByText('quoted formatting',{exact:true}).waitFor();
 assert.ok(publicPage.url().includes('/post/'),'A shared post opens its own public page without sign-in');
 await publicPage.waitForFunction(()=>document.querySelector('meta[property="og:description"]')?.content==='My separate share');
 assert.equal(await publicPage.title(),'Extension QA on Open Social');
 assert.equal(await publicPage.locator('link[rel="canonical"]').getAttribute('href'),`https://opensocial.online/post/${encodeURIComponent(publicShare.postId)}`);
 await publicPage.locator('.sidebar a[href="/"]').first().click();
 await publicPage.waitForFunction(()=>document.querySelector('meta[property="og:title"]')?.content==='Open Social');
 assert.equal(await publicPage.locator('meta[property="og:image"]').getAttribute('content'),'https://opensocial.online/social-card.png');
 // The feed stays compact, and hiding either promotion placement persists across reloads.
 assert.equal(await publicPage.getByRole('heading',{name:'Your people. Your world.',exact:true}).count(),0);
 await publicPage.setViewportSize({width:390,height:900});
 await publicPage.getByRole('button',{name:'Dismiss browser plugin suggestion',exact:true}).waitFor();
 await publicPage.screenshot({path:'/tmp/osp-feed-compact-mobile.png'});
 await publicPage.getByRole('button',{name:'Dismiss browser plugin suggestion',exact:true}).click();
 assert.equal(await publicPage.locator('.plugin-promo').count(),0);
 await publicPage.reload();
 await publicPage.getByRole('tab',{name:'Public',exact:true}).waitFor();
 assert.equal(await publicPage.locator('.plugin-promo').count(),0);
 await publicPage.getByRole('button',{name:'More menu',exact:true}).click();
 await publicPage.getByRole('dialog',{name:'More to explore'}).getByRole('link',{name:'Browser Plugin',exact:true}).waitFor();
 await publicPage.getByRole('button',{name:'Close menu',exact:true}).click();
 await publicPage.setViewportSize({width:1440,height:1000});
 assert.equal(await publicPage.locator('.plugin-promo').count(),0);
 // Open a current and a historical version using the same verified history reads as the app.
 const original=topicPost('Original text before the edit. '+('An earlier part of the story. '.repeat(30))+'The original ending.',63);
 const revised=topicPost('Updated text after the edit.',63);revised.versionNumber=2;
 revised.versions=[{versionNumber:1,contentHash:original.contentHash,txId:'revision-fixture',blockHeight:'1',timestamp:String(Date.now()-3600000)},{versionNumber:2,contentHash:revised.contentHash,txId:'current-fixture',blockHeight:'1',timestamp:String(Date.now())}];
 revisionFixture={post:revised,original};topicPosts=[revised];
 await publicPage.reload();
 await publicPage.getByRole('link',{name:/Open post from/}).first().click();
 const history=publicPage.getByRole('button',{name:/^Revision history/});
 await history.waitFor();assert.equal(await history.getAttribute('aria-expanded'),'false');
 await history.focus();await publicPage.keyboard.press('Enter');
 const current=publicPage.getByRole('button',{name:/^Version 2/}),older=publicPage.getByRole('button',{name:/^Version 1/});
 await current.click();await publicPage.locator('.revision-body').getByText('Updated text after the edit.',{exact:true}).waitFor();
 await older.click();await publicPage.locator('.revision-body').getByText(/The original ending\./).waitFor();
 assert.equal(await current.getAttribute('aria-expanded'),'false');assert.equal(await older.getAttribute('aria-expanded'),'true');
 assert.equal(await publicPage.locator('.revision-body').getByRole('button',{name:'Read more',exact:true}).count(),0);
 await publicPage.locator('.revision-history').scrollIntoViewIfNeeded();await publicPage.screenshot({path:'/tmp/osp-history-desktop.png'});
 for(const width of [390,320]){
   await publicPage.setViewportSize({width,height:900});await publicPage.locator('.revision-history').scrollIntoViewIfNeeded();
   assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Revision cards fit narrow screens');
   assert.equal(await older.evaluate(el=>getComputedStyle(el).textAlign),'left');
   if(width===390)await publicPage.screenshot({path:'/tmp/osp-history-mobile.png'});
 }
 await history.click();assert.equal(await publicPage.locator('.revision-body').count(),0);
 await publicPage.getByRole('link',{name:'Edited',exact:true}).click();
 await publicPage.waitForFunction(()=>document.querySelector('.revision-history-toggle')?.getAttribute('aria-expanded')==='true');
 assert.deepEqual(errors,[]);await publicPage.close();
 console.log('Public website checks passed: public topics and quotes, link metadata, compact feed, persistent plugin dismissal, and keyboard-friendly revision cards with verified current/older content at desktop, 390px and 320px.');
 await context.close();
} finally {await browser.close();}
