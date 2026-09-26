// Local visual fixture only. Serves the shipped cards and content script across separate origins.
// No keys, RPC nodes, Facebook session, or real transactions are used.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const cardsOrigin = 'http://127.0.0.1:4189';
const hostOrigin = 'http://127.0.0.1:4188';
const host = `<!doctype html><meta charset="utf-8"><title>Open Social scrolling feed preview</title><style>
body{margin:0;background:#f6f7fb;font:16px/1.5 system-ui;color:#16181d}nav{height:58px;position:sticky;top:0;background:white;box-shadow:0 1px 3px #ccc;z-index:9;display:flex;align-items:center;justify-content:space-between;padding:0 24px}main{display:flex;justify-content:center;gap:24px;padding:20px}aside{width:210px;flex-shrink:0;color:#5f6672}#lane{width:680px;max-width:100%;min-width:0}.host-post,.composer{background:white;border:1px solid #d9dee8;border-radius:12px;margin-bottom:12px;padding:20px}.host-post{height:210px}.art{height:120px;background:linear-gradient(125deg,#dbedfa,#e9e2fa);border-radius:8px;margin-top:12px}button{font:inherit;border:1px solid #d9dee8;border-radius:8px;background:#fff;padding:6px 12px;cursor:pointer}@media(max-width:900px){aside{display:none}main{padding:10px}}</style>
<nav><strong>Facebook layout fixture · Open Social feed preview</strong><button id="new">Simulate a new Open Social post</button></nav>
<main role="main"><aside><b>Home</b><p>Friends</p><p>Groups</p><p>Left navigation</p></aside><div id="lane"><div class="composer">What’s on your mind?<p style="color:#5f6672">Composer and stories stay above the posts.</p></div>${Array.from({length:30},(_,i)=>`<div data-pagelet="FeedUnit_${i}" class="host-post"><article role="article"><b>Facebook sample post ${i+1}</b><p>This is a host post in the scrolling feed.</p><div class="art"></div></article></div>`).join('')}</div><aside><b>Contacts</b><p>Right sidebar stays separate.</p></aside></main>
<script src="/host-mock.js"></script><script src="/content/facebook.js"></script>`;
const hostMock = `let latest=20; const id=n=>btoa(String.fromCharCode(...Array(31).fill(0),n)).replaceAll('+','-').replaceAll('/','_');window.chrome={runtime:{id:'preview',getURL:p=>'${cardsOrigin}/'+p,onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{if(m.type!=='feed.request')throw Error('Preview only supports feed reads');const start=m.payload.cursor?Number(m.payload.cursor):latest;return{ok:true,result:{enabled:true,items:Array.from({length:Math.min(m.payload.limit,start)},(_,i)=>({postId:id(start-i)})),nextCursor:start-m.payload.limit>0?String(start-m.payload.limit):null}}}}};document.getElementById('new').onclick=()=>{latest++;document.getElementById('new').textContent='New post queued · appears within 30 seconds while you scroll';};`;
const cardMock = `window.chrome={runtime:{sendMessage:async m=>{if(m.type!=='embed.post')throw Error('Preview only supports card reads');const n=atob(m.payload.postId.replaceAll('-','+').replaceAll('_','/')).charCodeAt(31);return{ok:true,result:{enabled:true,item:{postId:m.payload.postId,author:n%2?'sample-jim':'sample-rex',authorName:n%2?'Jim Profits':'Rex',viewer:'sample-rex',audience:n%3?1:0,epoch:1,createdAt:String(Date.now()-n*60000),versionNumber:1,status:n%3?'decrypted':'plain',text:n>20?'A new post arrived while you were scrolling.':n===20?'Friends 1':n===19?'Here is a longer Open Social post, using the same card styling as the website.\\n\\nIt stays in the center feed and expands to fit its content.':'Open Social post '+n,reactions:n%3,replyCount:n%2,labels:[]}}}}},storage:{onChanged:{addListener(){},removeListener(){}}}};addEventListener('DOMContentLoaded',()=>{new ResizeObserver(()=>parent.postMessage({type:'osp.card.height',height:document.getElementById('root').getBoundingClientRect().height},'${hostOrigin}')).observe(document.getElementById('root'));});`;
for (const [port, isHost] of [[4188,true],[4189,false]]) createServer((req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  let body,type='text/html';
  if(isHost&&url.pathname==='/')body=host;
  else if(url.pathname==='/host-mock.js'){body=hostMock;type='text/javascript';}
  else if(url.pathname==='/card-mock.js'){body=cardMock;type='text/javascript';}
  else {const relative=path.normalize(url.pathname).replace(/^\/+/, '');if(relative.includes('..'))throw Error('path');const file=path.join(dist,relative);body=readFileSync(file);type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html';if(url.pathname==='/src/embed/index.html')body=String(body).replace('<head>','<head><script src="/card-mock.js"></script>');}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
 }catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'0.0.0.0',()=>console.log('Feed preview listening on '+port));
