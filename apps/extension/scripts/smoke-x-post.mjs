// Shipped X composer controller, trusted clicks and native controlled-editor input.
// All host publication and worker/network responses are fixtures. No live posts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
const { chromium } = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
const script = readFileSync(new URL('../dist/content/x.js', import.meta.url), 'utf8');
const profileUrl = 'https://opensocial.online/u/1JgvtKNBKCxT3D1xb8mmUJLCBpZnHqC3Rr';
let captured;
if(process.env.X_SNAPSHOT) {
  const dom=new JSDOM(readFileSync(process.env.X_SNAPSHOT,'utf8')),doc=dom.window.document;
  let root=doc.querySelector('[contenteditable="true"][data-testid="tweetTextarea_0"]');
  while(root&&!root.querySelector('[data-testid="tweetButtonInline"]'))root=root.parentElement;
  assert.ok(root && !root.matches('body,main'), 'Capture contains an inline composer');
  root=root.cloneNode(true);
  root.querySelectorAll('script,style,link,img,video,iframe,svg,object,embed').forEach(n=>n.remove());
  for(const node of [root,...root.querySelectorAll('*')]) {
    for(const attr of [...node.attributes])if(!['data-testid','contenteditable','role','type'].includes(attr.name))node.removeAttribute(attr.name);
    for(const child of [...node.childNodes])if(child.nodeType===3)child.remove();
  }
  root.querySelector('[contenteditable]').innerHTML='';
  root.querySelector('[data-testid="tweetButtonInline"]').textContent='Post';
  captured=root.outerHTML;dom.window.close();
}
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><style>[contenteditable]{min-height:80px;min-width:400px;padding:10px;border:1px solid gray}body{font:15px Arial}</style><body><a data-testid="AppTabBar_Profile_Link" href="/tester">Profile</a><main><div data-testid="primaryColumn"><div id="composer"></div><div id="timeline"></div></div></main></body></html>' }));
  await page.goto('https://x.com/home');
  await page.evaluate(({profileUrl,captured}) => {
    window.__calls=[];window.__nativePosts=[];window.__auto=true;window.__attribution=true;window.__enabled=true;window.__prepareError=false;window.__limit=10000;
    window.chrome={runtime:{id:'fixture',getURL:p=>'https://extension.test/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{
      window.__calls.push(m);
      if(m.type==='adapter.preferences')return{ok:true,result:{xEnabled:window.__enabled,xAutoCheck:window.__auto,xAttribution:window.__attribution}};
      if(m.type==='feed.request')return{ok:true,result:{enabled:false,items:[]}};
      if(m.type==='crosspost.xPrepare')return window.__prepareError?{ok:false,error:{message:'Unlock Open Social before cross-posting.'}}:{ok:true,result:{awaitingX:true,profileUrl,status:'pending'}};
      if(m.type==='crosspost.xComplete')return{ok:true,result:{status:'published',message:'Published to Open Social with the X post link.'}};
      throw Error('Unexpected request '+m.type);
    }}};
    window.__composer=(modal=false)=>{
      document.querySelector('#composer').innerHTML='';document.querySelector('[role="dialog"]')?.remove();
      const parent=document.createElement('div');if(modal){parent.setAttribute('role','dialog');document.body.append(parent);}else document.querySelector('#composer').append(parent);
      parent.innerHTML=!modal&&captured?captured:`<section><div><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0"></div></div><div data-testid="toolBar"><button data-testid="${modal?'tweetButton':'tweetButtonInline'}">Post</button></div></section>`;
      let committed='';const editor=parent.querySelector('[contenteditable]'),button=parent.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
      editor.setAttribute('role','textbox');
      const read=()=>{const blocks=[...editor.querySelectorAll('[data-block="true"]')];return blocks.length?blocks.map(b=>b.textContent).join('\n'):editor.innerText;};
      editor.addEventListener('input',()=>{const value=read();setTimeout(()=>{committed=value;button.disabled=value.length>window.__limit;button.setAttribute('aria-disabled',String(button.disabled));},20);});
      editor.addEventListener('paste',e=>{
        e.preventDefault();const value=read()+e.clipboardData.getData('text/plain');
        // This fixture supplies only the controlled-editor event contract. Actual
        // selection, decorations and render behavior are tested in smoke-x-draft.
        editor.replaceChildren(...value.split('\n').map(line=>{const b=document.createElement('div');b.dataset.block='true';b.textContent=line;return b;}));
        editor.dispatchEvent(new InputEvent('input',{bubbles:true}));
      });
      editor.addEventListener('cut',e=>{e.preventDefault();document.getSelection().getRangeAt(0).deleteContents();
        while(editor.lastElementChild?.dataset.block==='true'&&!editor.lastElementChild.textContent)editor.lastElementChild.remove();
        editor.dispatchEvent(new InputEvent('input',{bubbles:true}));});
      button.addEventListener('click',()=>{
        window.__nativePosts.push(committed);parent.remove();
        window.__publishX=(id='1001',toast=false)=>{
          const item=document.createElement(toast?'div':'article');
          if(toast){item.dataset.testid='toast';item.innerHTML='<a href="https://x.com/tester/status/'+id+'?s=20">View</a>';}
          else{item.dataset.testid='tweet';item.innerHTML='<a href="https://x.com/tester/status/'+id+'?s=20"><time>Now</time></a><div data-testid="tweetText"></div>';item.querySelector('[data-testid="tweetText"]').textContent=committed;}
          document.querySelector('#timeline').append(item);
        };
      });
    };window.__composer();
  },{profileUrl,captured});
  await page.addScriptTag({content:script});
  const box=()=>page.getByRole('checkbox',{name:'Also publish to Open Social Protocol'}),editor=()=>page.locator('[contenteditable="true"][data-testid="tweetTextarea_0"]');
  const count=type=>page.evaluate(type=>window.__calls.filter(m=>m.type===type).length,type);
  const setup=async({auto=true,attribution=true,error=false,limit=10000,modal=false}={})=>{
    await page.evaluate(o=>{window.__auto=o.auto;window.__attribution=o.attribution;window.__prepareError=o.error;window.__limit=o.limit;window.__composer(o.modal);}, {auto,attribution,error,limit,modal});
    await page.addScriptTag({content:script});await box().waitFor();await page.waitForTimeout(50);
  };
  const post=()=>page.getByRole('button',{name:'Post',exact:true}).click();
  await box().waitFor();assert.equal(await box().isChecked(),true);
  const original='Hello from X.\nA second paragraph.';
  await editor().fill(original);await page.waitForTimeout(40);assert.equal(await editor().innerText(),original);
  await page.getByRole('combobox',{name:'Open Social audience'}).selectOption('1');await post();
  await page.waitForFunction(()=>window.__nativePosts.length===1);
  const sent=await page.evaluate(()=>window.__calls.find(m=>m.type==='crosspost.xPrepare').payload);
  assert.equal(sent.text,original);assert.equal(sent.audience,1);assert.equal(sent.submitted,true);assert.equal(sent.userGesture,true);
  const native=await page.evaluate(()=>window.__nativePosts[0]),footer='Join Me On Open Social: '+profileUrl;
  assert.ok(native.endsWith(footer));assert.equal(native.slice(0,-footer.length).trimEnd(),original);assert.equal(await count('crosspost.xComplete'),0);
  await page.evaluate(()=>{history.pushState({},'','/someone/status/999');document.querySelector('#timeline').innerHTML='<article data-testid="tweet"><a href="https://x.com/someone/status/999"><time>Now</time></a><div data-testid="tweetText">Hello from X. A second paragraph.</div></article>';});
  await page.waitForTimeout(220);assert.equal(await count('crosspost.xComplete'),0);
  await page.evaluate(()=>window.__publishX());await page.waitForFunction(()=>window.__calls.some(m=>m.type==='crosspost.xComplete'));
  assert.deepEqual(await page.evaluate(()=>window.__calls.find(m=>m.type==='crosspost.xComplete').payload),{attemptId:sent.attemptId,url:'https://x.com/tester/status/1001'});
  await page.evaluate(()=>window.__publishX());await page.waitForTimeout(220);assert.equal(await count('crosspost.xComplete'),1);

  await setup({auto:false});assert.equal(await box().isChecked(),false);await box().check();await page.addScriptTag({content:script});await page.waitForTimeout(40);assert.equal(await box().isChecked(),true);
  await box().uncheck();await editor().fill('X only');await page.waitForTimeout(40);await post();assert.equal(await count('crosspost.xPrepare'),1);assert.equal(await page.evaluate(()=>window.__nativePosts[1]),'X only');

  await setup({error:true,modal:true});await editor().fill('Keep my draft');await post();await page.getByText('Post paused: Unlock Open Social before cross-posting.',{exact:true}).waitFor();assert.equal(await editor().innerText(),'Keep my draft');assert.equal(await page.evaluate(()=>window.__nativePosts.length),2);
  await box().uncheck();await post();assert.equal(await page.evaluate(()=>window.__nativePosts.length),3);

  await setup({limit:50,modal:true});await editor().fill('A short draft');await post();await page.getByText(/Post paused: X cannot submit/).waitFor();assert.equal((await editor().innerText()).trim(),'A short draft');assert.equal(await page.evaluate(()=>window.__nativePosts.length),3,'Native X limit blocks footer overflow before submitting');
  await page.evaluate(()=>{window.__attribution=false;});await page.addScriptTag({content:script});await page.waitForTimeout(60);await editor().press('Control+Enter');await page.waitForFunction(()=>window.__nativePosts.length===4);
  assert.equal((await page.evaluate(()=>window.__nativePosts[3])).trim(),'A short draft');
  await page.evaluate(()=>window.__publishX('1002',true));await page.waitForFunction(()=>window.__calls.filter(m=>m.type==='crosspost.xComplete').length===2);

  await setup({attribution:false});await editor().fill('Wait for my link');await post();await page.waitForFunction(()=>window.__nativePosts.length===5);
  await setup({attribution:false,modal:true});await editor().fill('Second pending draft');await post();await page.getByText(/Waiting for your previous X post/).waitFor();assert.equal(await page.evaluate(()=>window.__nativePosts.length),5);
  await page.evaluate(()=>window.__publishX('1003',true));await page.waitForFunction(()=>window.__calls.filter(m=>m.type==='crosspost.xComplete').length===3);
  // A settings refresh cannot discard a per-post choice; disabling the site removes controls.
  await page.evaluate(()=>window.__enabled=false);await page.addScriptTag({content:script});await page.waitForFunction(()=>!document.querySelector('[data-osp-control]'));
  assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.__ospX.stop());await context.close();
  console.log('X publishing browser checks passed: '+(captured?'anonymized captured inline structure + ':'')+'inline/modal, default/manual choices, controlled editor footer on trusted Post, delayed own-post/toast permalink, unrelated links, duplicates, failure recovery, native length validation, keyboard posting, pending isolation and disable; fixture network only');
} finally {await browser.close();}
