// Real browser regression of the shipped content script; all network is intercepted.
// Optional FACEBOOK_SNAPSHOT is a local captured page, never a committed fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const row = n => `<div data-fixture-row="${n}">${'<div>'.repeat(8)}<div aria-posinset="${n}"><div data-virtualized="false" style="min-height:300px">Native post ${n}</div></div>${'</div>'.repeat(8)}</div>`;
const loading = '<div id="loading"><div><div role="article"><div role="status" data-visualcompletion="loading-state">Loading</div></div><div role="article"><div role="status" data-visualcompletion="loading-state">Loading</div></div></div></div>';
const synthetic = `<html><head><style>body{margin:0;background:#eee}main{width:680px;margin:auto}[data-fixture-row]{background:white;margin:12px 0}</style></head><body><main><div>${Array.from({length:20},(_,i)=>row(i+11)).join('')}${loading}</div></main></body></html>`;
function sanitize(html) {
  const dom = new JSDOM(html), doc=dom.window.document;
  doc.querySelectorAll('script,link,iframe,object,embed,base,meta[http-equiv],[data-osp-feed],[data-osp-facebook-status],[data-osp-control],[data-osp-toast]').forEach(el=>el.remove());
  for(const el of doc.querySelectorAll('*')) for(const a of [...el.attributes]) {
    if (/^(on|data-osp-)/i.test(a.name) || /^(src|srcset|poster|href|action)$/i.test(a.name)) el.removeAttribute(a.name);
  }
  const result=dom.serialize(); dom.window.close(); return result;
}
const script=readFileSync(new URL('../dist/content/facebook.js',import.meta.url),'utf8');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH && {executablePath:process.env.CHROMIUM_PATH}),args:['--no-sandbox']});
try {
  const cases=[['numbered fixture',synthetic]];
  if(process.env.FACEBOOK_SNAPSHOT) cases.push(['captured page (scripts/resources disabled)',sanitize(readFileSync(process.env.FACEBOOK_SNAPSHOT,'utf8'))]);
  for(const [label,html] of cases) {
    const context=await browser.newContext({viewport:{width:1500,height:950}});
    await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:route.request().url()==='https://www.facebook.com/'?html:'<!doctype html><body style="background:#123;color:white">Open Social fixture card</body>'}));
    const page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://www.facebook.com/');
    await page.evaluate(()=>{
      const first=document.querySelector('[aria-posinset="11"]'), second=document.querySelector('[aria-posinset="12"]');
      let lane=first.parentElement;while(!lane.contains(second))lane=lane.parentElement;
      window.__lane=lane;
      window.__row=n=>{let el=document.querySelector(`[aria-posinset="${n}"]`);if(!el)return null;while(el.parentElement!==lane)el=el.parentElement;return el;};
      window.__reads=0;window.__styles=0;
      const css=window.getComputedStyle;window.getComputedStyle=(...args)=>{window.__styles++;return css(...args);};
      window.chrome={runtime:{id:'fixture',getURL:p=>'https://extension.test/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{
        if(m.type==='adapter.preferences')return{ok:true,result:{facebookAttribution:false}};
        if(m.type!=='feed.request')throw Error('Unexpected '+m.type);
        window.__reads++;const start=Number(m.payload.cursor??0), limit=m.payload.limit??5;
        return {ok:true,result:{enabled:true,items:Array.from({length:limit},(_,i)=>({postId:btoa(String.fromCharCode(...new Uint8Array(32).fill(start+i+1))).replace(/\+/g,'-').replace(/\//g,'_')})),nextCursor:String(start+limit)}};
      }}};
      window.__row(18).scrollIntoView();
    });
    if(process.env.FACEBOOK_OLD_SCRIPT && label.startsWith('captured')) {
      await page.addScriptTag({content:readFileSync(process.env.FACEBOOK_OLD_SCRIPT,'utf8')});
      await page.waitForFunction(()=>document.querySelector('[data-osp-feed]'));
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[data-osp-feed]')].some(c=>c.parentElement!==window.__lane)),true,'Old build reproduces wrong loading-suffix placement');
      await page.evaluate(()=>{window.__ospFacebook.stop();delete window.__ospFacebook;});
    }
    await page.addScriptTag({content:script});
    await page.waitForFunction(()=>document.querySelector('[data-osp-feed] iframe'));
    const check=async()=>{
      const result=await page.evaluate(()=>[...document.querySelectorAll('[data-osp-feed]:not([role="status"])')].map(c=>{
        const prev=c.previousElementSibling,next=c.nextElementSibling,n=Number(prev?.querySelector('[aria-posinset]')?.getAttribute('aria-posinset'));
        const a=prev?.getBoundingClientRect(), b=c.getBoundingClientRect(),d=next?.getBoundingClientRect();
        return {lane:c.parentElement===window.__lane,n,adjacent:next?.hasAttribute('data-osp-feed')??false,ordered:!!a&&a.bottom<=b.top+1&&(!d||b.bottom<=d.top+1)};
      }));
      assert.ok(result.length>0,`${label}: cards visible in document`);
      for(const r of result){assert.equal(r.lane,true,`${label}: real native row lane`);assert.ok(r.n>0&&r.n%3===0,`${label}: numbered native slot`);assert.equal(r.adjacent,false,`${label}: no card pile`);assert.equal(r.ordered,true,`${label}: rendered between native rows`);}
    };
    await page.waitForTimeout(350);await check();
    // Scroll rapidly both ways, as the host app adds/recycles rows before its loading tail.
    for(let i=0;i<6;i++) {
      await page.evaluate(({row,i})=>{
        const el=document.createElement('div');el.innerHTML=row;
        window.__row(30).after(el.firstElementChild);
        window.__row(i%2?12:30).scrollIntoView();
      },{row:row(31+i),i});
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(350);await check();
    // Facebook moving or removing an unmanaged child must restore that same card.
    const reads=await page.evaluate(()=>window.__reads);
    await page.evaluate(()=>{window.__card=document.querySelector('[data-osp-feed]');window.__anchor=window.__card.previousElementSibling;window.__lane.append(window.__card);});
    await page.waitForFunction(()=>window.__anchor.nextElementSibling===window.__card);
    await page.evaluate(()=>window.__card.remove());
    await page.waitForFunction(()=>window.__anchor.nextElementSibling===window.__card);
    await check();
    assert.equal(await page.evaluate(()=>window.__reads),reads,'Repair does not refetch');
    // Disappearing native anchors park their cards instead of clamping them to the tail.
    await page.evaluate(()=>{window.__before=window.__anchor.nextElementSibling;window.__replacement=window.__anchor.cloneNode(true);window.__anchor.remove();});
    await page.waitForFunction(()=>!window.__card.isConnected);
    await page.evaluate(()=>{window.__lane.insertBefore(window.__replacement,window.__row(30));});
    await page.waitForFunction(()=>window.__replacement.nextElementSibling===window.__card);
    await check();
    await page.waitForTimeout(500);const styles=await page.evaluate(()=>window.__styles);
    await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__styles),styles,'Mutation observer settles without a self-repair loop');
    assert.deepEqual(errors,[],`${label}: no browser errors`);
    await page.evaluate(()=>window.__ospFacebook.stop());await context.close();
    console.log(`Facebook scroll browser regression passed: ${label}; fast scrolling, loading, interleaving, external reorder/removal, anchor recycling, idle observer`);
  }
} finally {await browser.close();}
