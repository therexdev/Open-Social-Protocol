// Shipped X adapter against a measured, absolutely positioned virtual timeline.
// All network is intercepted. Optional X_SNAPSHOT contributes only anonymized row structure.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {JSDOM} from 'jsdom';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
const script=readFileSync(new URL('../dist/content/x.js',import.meta.url),'utf8');
const article=n=>`<article role="article" data-testid="tweet"><a href="/fixture/status/${1000+n}"><time>now</time></a><p>Native timeline post ${n}</p></article>`;
const row=n=>`<div data-testid="cellInnerDiv"><div><div>${article(n)}</div></div></div>`;
const cases=[['virtual rows',Array.from({length:24},(_,i)=>row(i+1)).join('')]];
if(process.env.X_SNAPSHOT){
 const dom=new JSDOM(readFileSync(process.env.X_SNAPSHOT,'utf8')),doc=dom.window.document;
 const rows=[...doc.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')].filter(r=>r.querySelector('article[data-testid="tweet"]'));
 assert.ok(rows.length>=3,'Supplied capture has timeline tweet rows');
 const safe=rows.map((r,i)=>{const clone=r.cloneNode(true);clone.querySelector('article[data-testid="tweet"]').innerHTML=article(i+1).replace(/^<article[^>]*>|<\/article>$/g,'');
   clone.querySelectorAll('script,style,link,img,video,iframe,svg,object,embed').forEach(n=>n.remove());
   for(const el of [clone,...clone.querySelectorAll('*')])for(const a of [...el.attributes])if(!['data-testid','role','href'].includes(a.name)||a.name==='href'&&!a.value.startsWith('/fixture/status/'))el.removeAttribute(a.name);
   return clone.outerHTML;
 }).join('');
 cases.push(['anonymized supplied X row structure',safe]);dom.window.close();
}
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH&&{executablePath:process.env.CHROMIUM_PATH}),args:['--no-sandbox']});
try{
 for(const [label,rows] of cases){
  const context=await browser.newContext({viewport:{width:1100,height:900}}),errors=[];
  const html=`<!doctype html><html><head><style>body{margin:0;background:#fff;color:#121212;font:15px Arial}main{max-width:600px;margin:auto;border:1px solid #ddd}[role=tablist]{display:flex;padding:16px;gap:24px}#lane{position:relative}#lane>[data-testid=cellInnerDiv]{position:absolute;width:100%;display:block}article{box-sizing:border-box;min-height:220px;border-bottom:1px solid #ddd;padding:20px}aside{display:none}</style></head><body><main><div data-testid="primaryColumn"><div role="tablist"><button role="tab" aria-selected="true">For you</button><button role="tab" aria-selected="false">Following</button></div><div aria-label="Timeline: Your Home Timeline"><div id="lane">${rows}</div></div></div></main><aside>${row(999)}</aside></body></html>`;
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin==='https://x.com')return route.fulfill({contentType:'text/html',body:html});
   assert.equal(url.origin,'https://extension.test');
   return route.fulfill({contentType:'text/html',body:`<!doctype html><body style="margin:0;background:#e4f9f4;font:16px Arial"><div style="height:275px;padding:20px;box-sizing:border-box">Open Social fixture post</div><script>addEventListener('message',e=>{if(e.source===parent&&e.origin==='https://x.com'&&e.data.type==='osp.card.theme'){document.documentElement.dataset.theme=e.data.theme;}});parent.postMessage({type:'osp.card.height',height:275},'https://x.com');</script>`});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://x.com/home');
  await page.evaluate(()=>{
   window.__reads=0;window.__listeners=new Set();window.__styles=0;
   const css=getComputedStyle;window.getComputedStyle=(...a)=>{window.__styles++;return css(...a);};
   const lane=document.getElementById('lane');let pending=false;
   window.__layout=()=>{let top=0;for(const cell of lane.children){if(!cell.matches('[data-testid="cellInnerDiv"]'))continue;
    const value=`translateY(${top}px)`;if(cell.style.transform!==value)cell.style.transform=value;top+=cell.getBoundingClientRect().height;
   }const height=`${top}px`;if(lane.style.minHeight!==height)lane.style.minHeight=height;};
   const resize=new ResizeObserver(()=>{if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;window.__layout();});}});
   window.__watch=()=>{for(const cell of lane.children)resize.observe(cell);window.__layout();};window.__watch();
   window.chrome={runtime:{id:'fixture',getURL:p=>'https://extension.test/'+p,onMessage:{addListener:f=>window.__listeners.add(f),removeListener:f=>window.__listeners.delete(f)},sendMessage:async m=>{
    if(m.type==='adapter.preferences')return{ok:true,result:{xEnabled:false}};
    if(m.type!=='feed.request')throw Error('X script must only request post identifiers');window.__reads++;
    const start=Number(m.payload.cursor??0),limit=m.payload.limit??5;
    return{ok:true,result:{enabled:true,items:Array.from({length:limit},(_,i)=>({postId:btoa(String.fromCharCode(...new Uint8Array(32).fill(start+i+1))).replace(/\+/g,'-').replace(/\//g,'_')})),nextCursor:String(start+limit)}};
   }}};
  });
  await page.addScriptTag({content:script});
  await page.waitForFunction(()=>document.querySelector('[data-osp-feed] iframe'));
  const check=async()=>{
   await page.waitForTimeout(250);
   const result=await page.evaluate(()=>{const rows=[...document.querySelector('#lane').children],cards=[...document.querySelectorAll('[data-osp-feed]:not([role=status])')];
    return {cards:cards.length,outside:cards.some(c=>!c.closest('[data-testid="cellInnerDiv"]')||c.closest('aside')),overlap:rows.some((r,i)=>i&&rows[i-1].getBoundingClientRect().bottom>r.getBoundingClientRect().top+1),counts:rows.map(r=>r.querySelectorAll('[data-osp-feed]').length)};});
   assert.ok(result.cards>0,label);assert.equal(result.outside,false,label);assert.equal(result.overlap,false,'Native virtualizer includes injected card height');assert.ok(result.counts.every(n=>n<=1),'No stacked cards');
  };
  await check();
  await page.evaluate(()=>{window.__card=document.querySelector('[data-osp-feed]');window.__anchor=window.__card.closest('[data-testid="cellInnerDiv"]');window.__saved=window.__anchor.innerHTML;});
  await page.addScriptTag({content:script});await check();assert.equal(await page.evaluate(()=>window.__listeners.size),1,'Duplicate injection retains one lifecycle listener');
  await page.evaluate(()=>{window.__card=document.querySelector('[data-osp-feed]');window.__anchor=window.__card.closest('[data-testid="cellInnerDiv"]');window.__saved=window.__anchor.innerHTML;window.__card.remove();});
  await page.waitForFunction(()=>window.__card.closest('[data-testid="cellInnerDiv"]')===window.__anchor);await check();
  await page.evaluate(html=>{window.__anchor.innerHTML=html;},article(500));
  await page.waitForFunction(()=>!window.__card.isConnected);
  await page.evaluate(()=>{window.__anchor.innerHTML=window.__saved;window.__anchor.querySelectorAll('[data-osp-feed]').forEach(c=>c.remove());});
  await page.waitForFunction(()=>window.__card.closest('[data-testid="cellInnerDiv"]')===window.__anchor);await check();
  for(let i=0;i<4;i++) {await page.evaluate(i=>{const cells=document.querySelectorAll('#lane>[data-testid="cellInnerDiv"]');cells[i%2?0:cells.length-1].scrollIntoView();},i);await page.waitForTimeout(170);}
  await check();
  await page.evaluate(()=>{for(const b of document.querySelectorAll('[role=tab]'))b.setAttribute('aria-selected',String(b.textContent==='Following'));});await check();
  await page.evaluate(()=>{document.body.style.backgroundColor='#000';});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-osp-feed] iframe')].every(f=>f.style.colorScheme==='dark'));
  await page.setViewportSize({width:390,height:900});await check();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>document.querySelector('[data-osp-feed]').scrollIntoView());
  await page.screenshot({path:'/tmp/open-social-x-fixture.png'});
  await page.waitForTimeout(350);const styles=await page.evaluate(()=>window.__styles);await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>window.__styles)-styles<40,'Observer settles without a resize/repair loop');
  await page.evaluate(()=>{history.pushState({},'','/messages');dispatchEvent(new PopStateEvent('popstate'));});
  await page.waitForFunction(()=>!document.querySelector('[data-osp-feed]'));
  const reads=await page.evaluate(()=>window.__reads);await page.waitForTimeout(1600);assert.equal(await page.evaluate(()=>window.__reads),reads,'No feed work in messages');
  await page.evaluate(()=>{history.pushState({},'','/home');dispatchEvent(new PopStateEvent('popstate'));});await page.waitForFunction(()=>document.querySelector('[data-osp-feed]'));await check();
  await page.evaluate(()=>{for(const f of window.__listeners)f({type:'osp.x.stop',origins:['https://x.com/*']},{id:'fixture'});});
  assert.equal(await page.locator('[data-osp-feed]').count(),0);assert.equal(await page.evaluate(()=>window.__listeners.size),0);assert.equal(await page.evaluate(()=>window.__ospX),undefined);
  assert.deepEqual(errors,[]);await context.close();console.log('X feed browser check passed: '+label+'; measured row heights, scroll, recycling, repair, duplicate injection, tabs, navigation, theme, narrow layout, disable; no live requests');
 }
}finally{await browser.close();}
