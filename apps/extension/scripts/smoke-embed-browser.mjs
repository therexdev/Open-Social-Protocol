// Exercise the shipped iframe UI under its CSP with trusted browser input.
// All network and worker responses are fixtures; no account or chain is contacted.
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url))),manifest=JSON.parse(readFileSync(path.join(dist,'manifest.json'),'utf8'));
const ids={photo:'a'.repeat(43)+'=',poll:'b'.repeat(43)+'=',video:'c'.repeat(43)+'=',voice:'d'.repeat(43)+'=',comment:'e'.repeat(43)+'='};
const image=process.env.TEST_IMAGE?readFileSync(process.env.TEST_IMAGE).toString('base64url'):'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
const video=process.env.TEST_VIDEO?readFileSync(process.env.TEST_VIDEO).toString('base64url'):undefined;
// A small PCM WAV fixture verifies the audio element without live microphones.
const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH&&{executablePath:process.env.CHROMIUM_PATH}),args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:1100,height:1000}}),errors=[];
 await context.addInitScript(({ids,image,video,audio})=>{
  if(location.origin!=='https://extension.test')return;
  const listeners=new Set();window.__calls=[];window.__revoked=[];window.__locked=false;
  const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__revoked.push(url);revoke(url);};
  const postId=new URLSearchParams(location.hash.slice(1)).get('post');
  const base={postId,author:'alex',authorName:'Alex River',viewer:'reader',audience:0,epoch:0,createdAt:String(Date.now()-600000),versionNumber:1,contentHash:'v'.repeat(43)+'=',status:'plain',reactions:2,viewerReaction:0,replyCount:1,labels:[],text:'A little room for something new. Our community can stay connected, wherever we choose to spend our time.'};
  const media=(mime,scheme)=>({mime,locations:[scheme+'://archive/'+postId],contentHash:'h'.repeat(43)+'=',size:'100',alt_text:mime.startsWith('image')?'Community photo':mime.startsWith('video')?'Test animation':'Voice note'});
  if(postId===ids.photo)base.media=[media('image/png','osp-photo')];
  if(postId===ids.video){base.audience=1;base.status='decrypted';base.text='A short animation, shared with friends.';base.media=[{...media('video/mp4','osp-clip'),poster:{...media('image/jpeg','osp-photo')}}];}
  if(postId===ids.voice){base.text='A quick voice note for the group.';base.media=[media('audio/wav','osp-clip')];}
  let pollView={now:String(Date.now()),value:{definition:{question:'What should we build together next?',options:['More community events','Creative challenges','Learning sessions'],closes_at:String(Date.now()+86400000)},counts:[5,3,2],participants:10,engagement_milli:'1000'}};
  if(postId===ids.poll){base.text=pollView.value.definition.question;base.poll=pollView.value;}
  if(postId===ids.photo)base.authorAvatarHash='j'.repeat(43)+'=';
  let reaction=0,vote,comment,badAvatar=false;
  const inspection=()=>({policy:{max_vote_weight:'100'},account:{resource_version:2,token_ticks:'1000',ticks_per_unit:'100',transferable:'10'},version:base.contentHash,active:true,canVote:true,own:false,ownerAvailable:false,view:{block:'100',vote,...(vote&&{reward:{up:vote.direction===1?vote.weight:'0',down:vote.direction===2?vote.weight:'0'}})}});
  window.chrome={runtime:{getURL:p=>'https://extension.test/'+p,sendMessage:async m=>{
   window.__calls.push(m);
   const {type,payload}=m;
   if(type==='embed.post')return{ok:true,result:{enabled:true,item:{...base,viewer:window.__locked?undefined:'reader',viewerReaction:reaction,...(postId===ids.poll&&{pollView}),...(window.__locked&&base.audience===1?{status:'locked',text:undefined,media:undefined,message:'Unlock to read this private post.'}:{})}}};
   if(type==='embed.avatar')return{ok:true,result:{data:badAvatar?'bm90IGFuIGltYWdl':image,mime:'image/png'}};
   if(type==='embed.media')return{ok:true,result:{data:postId===ids.video&&!payload.poster?video:postId===ids.voice?audio:image,mime:postId===ids.video&&!payload.poster?'video/mp4':postId===ids.voice?'audio/wav':'image/png'}};
   if(type==='embed.inspect')return{ok:true,result:inspection()};
   if(type==='embed.vote'){vote={direction:payload.direction,weight:payload.weight,block:'101'};return{ok:true,result:inspection()};}
   if(type==='embed.react'){reaction=payload.remove?0:payload.reaction;return{ok:true,result:{reaction}};}
   if(type==='embed.poll'){pollView={...pollView,ballot:{option:payload.option}};return{ok:true,result:{pollView}};}
   if(type==='embed.replies')return{ok:true,result:{items:comment?[comment]:[],nextCursor:null}};
   if(type==='embed.comment'){comment={...base,postId:ids.comment,replyTo:postId,author:'reader',authorName:'You',media:undefined,text:payload.text,replyCount:0,reactions:0};return{ok:true,result:{postId:ids.comment,confirmed:true}};}
   throw Error('Unexpected card request '+type);
  }},storage:{onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}}};
  window.__lock=()=>{window.__locked=true;for(const f of listeners)f({'osp.session':{}},'session');};
  window.__profile=(hash,bad=false)=>{base.authorAvatarHash=hash;badAvatar=bad;document.dispatchEvent(new Event('visibilitychange'));};
  window.__touch=()=>{for(const f of listeners)f({'osp.session':{oldValue:{account:'reader',unlockedAt:1,lastActivity:1},newValue:{account:'reader',unlockedAt:1,lastActivity:2}}},'session');};
 },{ids,image,video,audio:wav.toString('base64url')});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin==='https://www.facebook.com')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>body{margin:0;background:#f0f2f5;font:14px Arial}header{height:55px;background:white;border-bottom:1px solid #ddd;padding:16px}main{max-width:680px;margin:22px auto}iframe{display:block;border:0;width:100%;height:180px;margin:16px 0}article{background:white;padding:25px;border-radius:10px;color:#666}@media(max-width:700px){main{margin:8px}}</style></head><body><header>Feed preview</header><main><article>Native feed post</article>${Object.entries(ids).filter(([k])=>k!=='comment'&&(k!=='video'||video)).map(([k,id])=>`<iframe title="${k}" allow="autoplay; fullscreen" src="https://extension.test/src/embed/index.html#post=${encodeURIComponent(id)}&host=https%3A%2F%2Fwww.facebook.com"></iframe><article>Native feed post</article>`).join('')}</main><script>addEventListener('message',e=>{for(const f of document.querySelectorAll('iframe'))if(e.source===f.contentWindow&&e.origin==='https://extension.test'&&e.data.type==='osp.card.height')f.style.height=e.data.height+'px'})</script></body></html>`});
  const file=path.resolve(dist,'.'+u.pathname);
  if(u.origin!=='https://extension.test'||!file.startsWith(dist+path.sep)||!existsSync(file))throw Error('Unexpected network request '+u.origin+u.pathname);
  return route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream',headers:{'content-security-policy':manifest.content_security_policy.extension_pages},body:readFileSync(file)});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://www.facebook.com/');
 const photo=page.frameLocator('iframe[title=photo]'),poll=page.frameLocator('iframe[title=poll]');
 await photo.locator('.card-photo img').waitFor();await photo.locator('.card-photo img').evaluate(i=>i.decode());assert.ok(await photo.locator('.card-photo img').evaluate(i=>i.complete&&i.naturalWidth>0),'Archived image loads automatically');
 assert.equal(await photo.locator('.social-card').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 const avatar=photo.locator('.card-header .card-avatar img');
 await avatar.waitFor();await avatar.evaluate(i=>i.decode());
 assert.ok(await avatar.evaluate(i=>i.naturalWidth>0&&getComputedStyle(i).objectFit==='cover'),'Profile photo decodes and fills its avatar circle');
 const oldAvatar=await avatar.getAttribute('src');
 await photo.locator('body').evaluate(()=>window.__profile('k'.repeat(43)+'='));
 await avatar.waitFor();
 await photo.locator('body').evaluate((_body,old)=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Avatar replacement timed out')),5000);const check=()=>window.__revoked.includes(old)?(clearTimeout(timeout),resolve()):setTimeout(check,10);check();}),oldAvatar);
 await avatar.evaluate(i=>i.decode());assert.notEqual(await avatar.getAttribute('src'),oldAvatar,'Profile refresh replaces the photo and revokes the old URL');
 await photo.locator('body').evaluate(()=>window.__profile(undefined));
 await avatar.waitFor({state:'detached'});assert.equal((await photo.locator('.card-avatar').textContent()).trim(),'AR','No profile photo falls back to initials');
 await photo.locator('body').evaluate(()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Broken avatar did not reach its fallback')),10000);
  const failed=e=>{if(e.target?.closest?.('.card-avatar')){document.removeEventListener('error',failed,true);clearTimeout(timer);setTimeout(resolve,0);}};
  document.addEventListener('error',failed,true);window.__profile('l'.repeat(43)+'=',true);
 }));
 await avatar.waitFor({state:'detached'});assert.equal((await photo.locator('.card-avatar').textContent()).trim(),'AR','Unreadable photo keeps initials');
 await photo.locator('body').evaluate(()=>window.__profile('j'.repeat(43)+'='));await avatar.waitFor();await avatar.evaluate(i=>i.decode());

 await photo.getByRole('button',{name:'React',exact:true}).click();
 await photo.getByRole('button',{name:'Happy',exact:true}).evaluate(b=>b.click());
 assert.equal(await photo.locator('body').evaluate(()=>window.__calls.filter(c=>c.type==='embed.react').length),0,'Synthetic clicks cannot submit reactions');
 await photo.getByRole('button',{name:'Happy',exact:true}).click();
 await photo.getByRole('button',{name:'Change reaction, Happy',exact:true}).waitFor();
 await photo.getByRole('button',{name:'Change reaction, Happy',exact:true}).click();await photo.getByRole('button',{name:'Surprised',exact:true}).click();
 await photo.getByRole('button',{name:'Change reaction, Surprised',exact:true}).waitFor();
 await photo.getByRole('button',{name:'Upvote',exact:true}).click();await photo.getByRole('spinbutton').fill('3');
 await photo.getByRole('button',{name:'Confirm upvote',exact:true}).click();await photo.getByText('Vote confirmed.',{exact:true}).waitFor();
 assert.equal(await photo.locator('body').evaluate(()=>window.__calls.find(c=>c.type==='embed.vote').payload.weight),'3');
 await photo.getByRole('button',{name:'Comment',exact:true}).click();await photo.getByRole('textbox',{name:'Write a comment'}).fill('Replying right here in the feed.');
 await photo.getByRole('button',{name:'Post comment',exact:true}).click();await photo.getByText('Replying right here in the feed.',{exact:true}).waitFor();
 await photo.locator('.comment-card .card-avatar img').waitFor();await photo.locator('.comment-card .card-avatar img').evaluate(i=>i.decode());
 await photo.locator('body').evaluate(()=>window.__touch());
 await photo.getByText('Replying right here in the feed.',{exact:true}).waitFor();
 await poll.getByRole('radio').nth(1).check();await poll.getByRole('button',{name:'Vote in poll',exact:true}).click();await poll.getByRole('button',{name:'Change answer',exact:true}).waitFor();
 await poll.getByRole('radio').nth(2).check();await poll.getByRole('button',{name:'Change answer',exact:true}).click();
 assert.equal(await poll.locator('body').evaluate(()=>window.__calls.filter(c=>c.type==='embed.poll').length),2);
 // Independent vote in another card checks downvoting, without violating one final vote per post.
 await poll.getByRole('button',{name:'Downvote',exact:true}).click();await poll.getByRole('button',{name:'Confirm downvote',exact:true}).click();
 await poll.getByText('Vote confirmed.',{exact:true}).waitFor();
 const voice=page.frameLocator('iframe[title=voice]');await voice.getByRole('button',{name:'Play audio',exact:true}).click();
 await voice.locator('audio').waitFor();await voice.locator('audio').evaluate(e=>new Promise((resolve,reject)=>{if(e.readyState>=2)return resolve();e.addEventListener('loadeddata',resolve,{once:true});e.addEventListener('error',()=>reject(Error('Audio decode failed')),{once:true});}));
 if(video){
  const clip=page.frameLocator('iframe[title=video]');await page.locator('iframe[title=video]').scrollIntoViewIfNeeded();
  await clip.locator('.media-preview img').waitFor();
  assert.equal(await clip.locator('body').evaluate(()=>window.__calls.some(c=>c.type==='embed.media'&&!c.payload.poster)),false,'Poster appears before full video download');
  await clip.getByRole('button',{name:'Play video',exact:true}).click();await clip.locator('video').waitFor();
  await clip.locator('video').evaluate(e=>new Promise((resolve,reject)=>{if(e.readyState>=2)return resolve();e.addEventListener('loadeddata',resolve,{once:true});e.addEventListener('error',()=>reject(Error('MP4 decode failed')),{once:true});}));
  assert.ok(await clip.locator('video').evaluate(e=>e.videoWidth>0&&e.duration>=29),'Real MP4 decodes inside the card');
  await clip.locator('body').evaluate(()=>window.__lock());await clip.getByText('Unlock to read this private post.',{exact:true}).waitFor();
  assert.equal(await clip.locator('video').count(),0);assert.ok(await clip.locator('body').evaluate(()=>window.__revoked.length>=2),'Lock revokes poster and video blobs');
 }
 assert.equal(context.pages().length,1,'Actions and playback never open another tab');
 await page.setViewportSize({width:390,height:900});await page.locator('iframe[title=photo]').scrollIntoViewIfNeeded();
 assert.ok(await photo.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow card has no horizontal overflow');
 await photo.getByRole('button',{name:'Change reaction, Surprised',exact:true}).click();
 assert.ok(await photo.locator('.reaction-bubble').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0;}),'Reaction choices fit inside narrow iframe');
 await page.screenshot({path:'/tmp/open-social-feed-mobile.png',fullPage:true});
 await photo.getByRole('button',{name:'Change reaction, Surprised',exact:true}).click();
 await page.setViewportSize({width:1100,height:1000});await page.locator('iframe[title=photo]').scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/open-social-feed-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Embedded browser checks passed: profile photos/replacement/fallback and comment avatars, image auto-load, trusted reactions, up/down votes, poll changes, inline comments, activity preserves UI, audio, '+(video?'real MP4/poster and lock cleanup, ':'')+'no navigation, narrow layout; shipped CSP, fixture network only');
 await context.close();
}finally{await browser.close();}
