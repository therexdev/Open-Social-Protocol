import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedController, FEED_ATTR, findFeedLocation } from "./feedCards";
import { relevantFacebookMutation } from "./facebookAdapter";

const id = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n))).replace(/\+/g, "-").replace(/\//g, "_");
const items = (...ns: number[]) => ns.map((n) => ({ postId: id(n) }));
let running: FeedController | undefined;
afterEach(() => { running?.stop(); running = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });
function layout(count = 9) {
  document.body.innerHTML = `<main style="display:flex"><aside>Left sidebar</aside><div id="column"><div>Composer and stories</div>${Array.from({ length: count }, (_, i) => `<div data-pagelet="FeedUnit_${i}"><div role="article">Facebook post ${i}</div></div>`).join("")}</div><aside><div role="article">Right sidebar</div></aside></main>`;
  return document.getElementById("column")!;
}
// Structural fixture based on the report: nine wrappers above each numbered post;
// only the trailing loading skeletons have role=article. No real user content.
const numberedRow = (n: number) => `<div id="row-${n}">${"<div>".repeat(8)}<div aria-posinset="${n}"><div data-virtualized="false">Native post ${n}</div></div>${"</div>".repeat(8)}</div>`;
function numberedLayout(first = 11, count = 20) {
  document.body.innerHTML = `<main><div id="column">${Array.from({length:count},(_,i)=>numberedRow(first+i)).join("")}<div id="loading"><div><div role="article"><div role="status" data-visualcompletion="loading-state">Loading</div></div><div role="article"><div role="status" data-visualcompletion="loading-state">Loading</div></div></div></div></div></main>`;
  return document.getElementById("column")!;
}
function start(sendMessage: (m: unknown) => Promise<unknown>, now = () => 100000) {
  return running = new FeedController({ document, sendMessage, now });
}
const reply = (...ns: number[]) => async () => ({ok:true,result:{enabled:true,items:items(...ns),nextCursor:null}});
const cards = () => [...document.querySelectorAll<HTMLElement>(`[${FEED_ATTR}]:not([role="status"])`)];

describe("Facebook feed interleaving", () => {
  it("recognizes the reported numbered/virtualized rows instead of the moving loading suffix", async () => {
    const column=numberedLayout();
    const location=findFeedLocation(document)!;
    expect(location.column).toBe(column); expect(location.posts).toHaveLength(20);
    expect(location.keys.get(location.posts[0]!)).toBe("position:11");
    await start(reply(5,4,3,2,1)).scan();
    expect(cards()).toHaveLength(5);
    for (const [i,n] of [12,15,18,21,24].entries()) expect(document.getElementById(`row-${n}`)!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(5-i));
    expect(document.querySelector('#loading [data-osp-feed]')).toBeNull();
  });
  it("does not attach to skeleton articles when actual posts have not appeared yet", async () => {
    numberedLayout(1,0); const send=vi.fn(reply(1)); await start(send).scan();
    expect(findFeedLocation(document)).toBeNull(); expect(send).not.toHaveBeenCalled();
  });
  it("interleaves the first page and later pages one per three native posts, without a leading block", async () => {
    const column=layout(21);
    const send=vi.fn(async (m:unknown)=>({ok:true,result:{enabled:true,items:(m as {payload:{cursor?:string}}).payload.cursor?items(6,5,4,3,2):items(10,9,8,7,6),nextCursor:(m as {payload:{cursor?:string}}).payload.cursor?null:"older"}}));
    const feed=start(send);await feed.scan();await feed.scan();
    expect(send).toHaveBeenCalledTimes(2);expect(column.children[1]!.getAttribute('data-pagelet')).toBe('FeedUnit_0');
    expect(cards()).toHaveLength(7);
    for(let n=0;n<7;n++)expect(column.querySelector(`[data-pagelet="FeedUnit_${n*3+2}"]`)!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(10-n));
    expect(new Set(cards().map(c=>c.getAttribute(FEED_ATTR))).size).toBe(7);
    expect(cards().every(c=>!c.nextElementSibling?.hasAttribute(FEED_ATTR))).toBe(true);
  });
  it("repairs host reordering and removal while preserving each separate native-post anchor and CSS order", async () => {
    const column=layout();column.style.display='flex';column.style.flexDirection='column';
    const feed=start(reply(3,2,1));await feed.scan();const original=cards();
    for(let n=0;n<10;n++){
      original.forEach(card=>column.append(card));
      column.querySelector<HTMLElement>('[data-pagelet="FeedUnit_2"]')!.style.order=String(-20-n);
      await feed.scan();
      for(let i=0;i<3;i++)expect(column.querySelector(`[data-pagelet="FeedUnit_${i*3+2}"]`)!.nextElementSibling).toBe(original[i]);
      expect(original[0]!.style.order).toBe(String(-20-n));
    }
    original[1]!.remove();await feed.scan();expect(cards()).toHaveLength(3);
  });
  it("parks disappeared numbered anchors instead of piling their cards at the tail, and restores matching rows", async () => {
    const column=numberedLayout(1,9), feed=start(reply(3,2,1));await feed.scan();const original=cards();
    document.getElementById('row-3')!.remove();document.getElementById('row-6')!.remove();await feed.scan();
    expect(cards()).toEqual([original[2]]);expect(document.getElementById('row-9')!.nextElementSibling).toBe(original[2]);
    document.getElementById('row-4')!.insertAdjacentHTML('beforebegin',numberedRow(3));
    document.getElementById('row-7')!.insertAdjacentHTML('beforebegin',numberedRow(6));await feed.scan();
    expect(cards()).toEqual(original);expect(column.querySelectorAll('iframe')).toHaveLength(3);
  });
  it("handles a reused DOM row changing its numbered position without retaining the old slot", async () => {
    numberedLayout(1,9);const feed=start(reply(4,3,2,1));await feed.scan();const old=cards()[0]!;
    const row=document.getElementById('row-3')!;row.querySelector('[aria-posinset]')!.setAttribute('aria-posinset','12');await feed.scan();
    expect(old.isConnected).toBe(false);expect(row.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(1));
    expect(cards()).toHaveLength(3);
  });
  it("parks all cards during a skeleton-only refresh and restores their separate positions", async () => {
    const column=numberedLayout(1,9),feed=start(reply(3,2,1));await feed.scan();const original=cards();
    for(const row of [...column.children])if(row.id.startsWith('row-'))row.remove();
    await feed.scan();expect(cards()).toHaveLength(0);
    document.getElementById('loading')!.insertAdjacentHTML('beforebegin',Array.from({length:9},(_,i)=>numberedRow(i+1)).join(''));
    await feed.scan();expect(cards()).toEqual(original);
  });
  it("keeps the same slot when a numbered post becomes a spacer and loads again", async () => {
    numberedLayout(1,9);const feed=start(reply(3,2,1));await feed.scan();const original=cards();
    const post=document.querySelector('[aria-posinset="3"]')!;
    post.innerHTML='<div data-virtualized="true" style="min-height:600px"></div>';await feed.scan();
    post.innerHTML='<div data-virtualized="false">Loaded again</div>';await feed.scan();
    expect(cards()).toEqual(original);expect(document.getElementById('row-3')!.nextElementSibling).toBe(original[0]);
  });
  it("reuses the discovered lane during scroll without repeated selectors, styles or requests", async () => {
    layout(200);const send=vi.fn(reply(3,2,1));const feed=start(send);await feed.scan();
    const styles=vi.spyOn(window,'getComputedStyle');for(let n=0;n<100;n++)await feed.scan(false);
    expect(styles).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);styles.mockRestore();
  });
  it("places newly polled posts ahead of the reader without moving previously placed cards", async () => {
    layout(18);let clock=100000;const feed=start(async()=>({ok:true,result:{enabled:true,items:clock===100000?items(3,2,1):items(5,4,3,2,1),nextCursor:null}}),()=>clock);
    await feed.scan();const original=cards();
    const past=document.querySelector<HTMLElement>('[data-pagelet="FeedUnit_11"]')!;
    vi.spyOn(past,'getBoundingClientRect').mockReturnValue({top:-1000,bottom:-800} as DOMRect);
    clock+=30001;await feed.scan();expect(cards().slice(0,3)).toEqual(original);
    expect(document.querySelector('[data-pagelet="FeedUnit_14"]')!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(5));
    expect(document.querySelector('[data-pagelet="FeedUnit_17"]')!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(4));
    expect(past.nextElementSibling?.hasAttribute(FEED_ATTR)).toBe(false);
  });
  it("prefers the main post lane over a secondary suggestion feed, and ignores ambiguous layouts", async () => {
    const column=layout(9);document.querySelector('main')!.insertAdjacentHTML('beforeend','<section role="feed" id="suggestions"><div role="article">One</div><div role="article">Two</div></section>');
    expect(findFeedLocation(document)?.column).toBe(column);await start(reply(1)).scan();expect(document.querySelector('#suggestions iframe')).toBeNull();
    running!.stop();document.body.innerHTML='<main style="display:flex"><div>Stories</div><aside><div role="article">Sidebar</div></aside></main>';
    expect(findFeedLocation(document)).toBeNull();
  });
  it("restores separate slots after lane replacement and resets them on navigation", async () => {
    layout();const send=vi.fn(reply(3,2,1)),feed=start(send);await feed.scan();layout();await feed.scan();expect(cards()).toHaveLength(3);
    history.pushState({},'','/groups/test');await feed.scan();expect(cards()).toHaveLength(3);expect(send).toHaveBeenCalledTimes(2);history.replaceState({},'','/');
  });
  it("refreshes and recovers errors while visible, and stops work when disabled", async () => {
    vi.useFakeTimers();layout(3);const send=vi.fn().mockRejectedValueOnce(Error('offline')).mockImplementation(reply(1));const feed=start(send,()=>Date.now());await feed.scan();expect(document.body.textContent).toContain('Retrying');
    await vi.advanceTimersByTimeAsync(30001);expect(cards()).toHaveLength(1);feed.stop();await vi.advanceTimersByTimeAsync(90000);expect(send).toHaveBeenCalledTimes(2);expect(cards()).toHaveLength(0);
  });
  it("accepts height messages only from the matching extension iframe", async () => {
    layout(3);await start(reply(1)).scan();const frame=document.querySelector('iframe')!;
    window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',source:frame.contentWindow,data:{type:'osp.card.height',height:900}}));expect(frame.style.height).toBe('180px');
    window.dispatchEvent(new MessageEvent('message',{origin:'chrome-extension://osp-test-extension',source:frame.contentWindow,data:{type:'osp.card.height',height:340}}));expect(frame.style.height).toBe('340px');
  });
  it("observes numbered-row and wrapper-order changes without reacting to owned insertions", async () => {
    const column=numberedLayout(1,9);await start(reply(3,2,1)).scan();
    const records:MutationRecord[]=[];const observer=new MutationObserver(ms=>records.push(...ms));observer.observe(column,{subtree:true,attributes:true,childList:true});
    column.querySelector('[aria-posinset]')!.setAttribute('aria-posinset','10');document.getElementById('row-3')!.className='new-order';
    const own=document.createElement('section');own.setAttribute(FEED_ATTR,'test');column.append(own);await Promise.resolve();observer.disconnect();
    expect(records.filter(relevantFacebookMutation)).toHaveLength(2);
  });
});
