import { afterEach, expect, it, vi } from "vitest";
import { FeedController, FEED_ATTR } from "./feedCards";
import { xTimelineLocator, xRowContainer } from "./xTimeline";

let feed: FeedController | undefined;
const row = (n: number) => `<div data-testid="cellInnerDiv" style="position:absolute;transform:translateY(${n*180}px);width:100%"><div><div><article data-testid="tweet"><a href="/fixture/status/${1000+n}"><time>now</time></a>Post ${n}<div><a href="/quoted/status/999">Quoted post</a></div></article></div></div></div>`;
const cards = () => [...document.querySelectorAll<HTMLElement>(`[${FEED_ATTR}]`)];
afterEach(() => { feed?.stop(); document.body.innerHTML=""; history.replaceState({},"","/"); });
it("inserts inside measured virtual rows and restores by tweet id after replacement/recycling", async () => {
  history.replaceState({},"","/home");
  document.body.innerHTML=`<main><div data-testid="primaryColumn"><div aria-label="Timeline"><div id="lane" style="position:relative;min-height:3000px">${Array.from({length:9},(_,i)=>row(i+1)).join("")}</div></div></div><aside>${row(55)}</aside></main>`;
  const locate=xTimelineLocator(),lane=document.getElementById("lane")!, location=locate(document)!;
  expect(location.posts).toHaveLength(9); expect(location.column).toBe(lane);
  const send=vi.fn(async()=>({ok:true,result:{enabled:true,items:[1,2,3].map(n=>({postId:btoa(String.fromCharCode(...new Uint8Array(32).fill(n)))})),nextCursor:null}}));
  feed=new FeedController({document,sendMessage:send,findLocation:locate,insideRow:true,rowContainer:xRowContainer});await feed.scan();
  expect(cards()).toHaveLength(3);expect(lane.querySelectorAll(':scope > section')).toHaveLength(0);
  for(const [i,card] of cards().entries())expect(card.closest('[data-testid="cellInnerDiv"]')).toBe(location.posts[i*3+2]);
  const saved=cards()[0]!,original=location.posts[2]!;
  saved.remove();await feed.scan();expect(saved.closest('[data-testid="cellInnerDiv"]')).toBe(original);
  original.outerHTML=row(42);await feed.scan();expect(saved.isConnected).toBe(false);
  lane.insertAdjacentHTML('beforeend',row(3));await feed.scan();expect(saved.parentElement?.querySelector('time')?.parentElement?.getAttribute('href')).toBe('/fixture/status/1003');
  history.replaceState({},"","/messages");await feed.scan();expect(cards()).toHaveLength(0);
});
it("skips skeletons, quoted-link-only rows and non-home pages", () => {
  const locate=xTimelineLocator();
  document.body.innerHTML='<div data-testid="primaryColumn"><div><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/quoted/status/123">Quote only</a></article></div></div></div>';
  expect(locate(document)).toBeNull();
  document.body.innerHTML=`<div data-testid="primaryColumn"><div>${row(1)}</div></div>`;
  history.replaceState({},"","/person/status/123");expect(locate(document)).toBeNull();
  history.replaceState({},"","/home");expect(locate(document)?.posts).toHaveLength(1);
});
