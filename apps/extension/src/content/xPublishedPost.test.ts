import { afterEach, expect, it, vi } from "vitest";
import { watchXPublishedPost } from "./xPublishedPost";
import { xPostUrl } from "../shared/xUrl";
import { xComposerAdapter, XComposerController } from "./xComposer";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });
it("canonicalizes only HTTPS X or legacy Twitter post permalinks", () => {
  expect(xPostUrl('https://www.twitter.com/Tester/status/123?s=20#x')).toBe('https://x.com/tester/status/123');
  expect(xPostUrl('https://x.com/i/web/status/123')).toBe('https://x.com/i/web/status/123');
  for (const url of ['https://x.com/home','https://x.com/tester','https://x.com.evil.test/a/status/123','http://x.com/a/status/123','https://evil@x.com/a/status/123','https://x.com:999/a/status/123','https://x.com/a/status/0','https://x.com/a/status/123/photo/1']) expect(xPostUrl(url)).toBeUndefined();
});
const row=(author:string,id:number,text='My new post')=>`<article data-testid="tweet"><a href="https://x.com/${author}/status/${id}"><time>Now</time></a><div data-testid="tweetText">${text}</div></article>`;
it("ignores old permalinks, other users, quote timestamps and ambiguous matches, then accepts a new own post",async()=>{
  vi.useFakeTimers();document.body.innerHTML='<a data-testid="AppTabBar_Profile_Link" href="/tester">Profile</a>'+row('tester',123);
  const found=vi.fn(),timeout=vi.fn(),stop=watchXPublishedPost(document,'My new post',found,timeout);
  document.body.insertAdjacentHTML('beforeend',`<a href="https://x.com/i/web/status/123">Old alias</a>`+row('another',555)+row('tester',777,'Different text'));
  document.body.insertAdjacentHTML('beforeend',`<article data-testid="tweet"><a href="https://x.com/other/status/800"><time>Now</time></a><div data-testid="tweetText">My new post</div><div><a href="https://x.com/tester/status/801"><time>Quote</time></a></div></article>`);
  await vi.advanceTimersByTimeAsync(200);expect(found).not.toHaveBeenCalled();
  document.body.insertAdjacentHTML('beforeend',row('tester',888)+row('tester',889));
  await vi.advanceTimersByTimeAsync(200);expect(found).not.toHaveBeenCalled();
  document.querySelector('a[href$="/889"]')!.closest('article')!.remove();
  await vi.advanceTimersByTimeAsync(200);expect(found).toHaveBeenCalledExactlyOnceWith('https://x.com/tester/status/888');
  document.body.insertAdjacentHTML('beforeend',row('tester',890));await vi.advanceTimersByTimeAsync(200);expect(found).toHaveBeenCalledTimes(1);expect(timeout).not.toHaveBeenCalled();stop();
});
it("accepts a new success toast without a profile nav and times out conservatively otherwise",async()=>{
  vi.useFakeTimers();const found=vi.fn(),timeout=vi.fn();
  document.body.innerHTML='<div data-testid="toast"><a href="https://x.com/i/web/status/100">View</a></div>';
  const stop=watchXPublishedPost(document,'text',found,timeout,500);
  document.body.insertAdjacentHTML('beforeend','<div data-testid="toast"><a href="https://x.com/i/web/status/101">View</a></div>');
  await vi.advanceTimersByTimeAsync(200);expect(found).toHaveBeenCalledExactlyOnceWith('https://x.com/i/web/status/101');stop();
  const stop2=watchXPublishedPost(document,'text',vi.fn(),timeout,500);
  await vi.advanceTimersByTimeAsync(501);expect(timeout).toHaveBeenCalledTimes(1);stop2();
});
it("isolates inline/modal composers from DMs and ignores untrusted Post clicks",async()=>{
  const editor='<div role="textbox" contenteditable="true" data-testid="tweetTextarea_0">Hello</div>';
  const composer=`<section>${editor}<div data-testid="toolBar"><button data-testid="tweetButtonInline">Post</button></div></section>`;
  document.body.innerHTML=composer+`<div role="dialog">${composer.replace('tweetButtonInline','tweetButton')}</div><div data-testid="DMDrawer">${composer}</div>`;
  expect(xComposerAdapter.findComposers(document)).toHaveLength(2);
  const sendMessage=vi.fn(async()=>({ok:true,result:{xEnabled:true,xAutoCheck:true,xAttribution:false}}));
  const controller=new XComposerController({document,sendMessage,location:()=>"https://x.com/home",randomAttemptId:()=>"aa".repeat(16)});
  await Promise.resolve();await Promise.resolve();
  expect(document.querySelectorAll('[data-osp-control]')).toHaveLength(2);
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect(sendMessage).toHaveBeenCalledTimes(1);controller.stop();expect(document.querySelectorAll('[data-osp-control]')).toHaveLength(0);
});
