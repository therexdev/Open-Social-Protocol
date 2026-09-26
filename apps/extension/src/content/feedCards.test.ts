import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedController, FEED_ATTR, findFeedLocation } from "./feedCards";

const id = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n))).replace(/\+/g, "-").replace(/\//g, "_");
const items = (...ns: number[]) => ns.map((n) => ({ postId: id(n) }));
let running: FeedController | undefined;
afterEach(() => { running?.stop(); running = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });
function layout(count = 9) {
  document.body.innerHTML = `<main style="display:flex"><aside>Left sidebar</aside><div id="column"><div>Composer and stories</div>${Array.from({ length: count }, (_, i) => `<div data-pagelet="FeedUnit_${i}"><div role="article">Facebook post ${i}</div></div>`).join("")}</div><aside><div role="article">Right sidebar</div></aside></main>`;
  return document.getElementById("column")!;
}
function start(sendMessage: (m: unknown) => Promise<unknown>, now = () => 100000) {
  return running = new FeedController({ document, sendMessage, now });
}
describe("continuous Facebook feed placement", () => {
  it("reuses its discovered lane on scrolling without repeated style reads or feed requests", async () => {
    layout(200);
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: items(3, 2, 1), nextCursor: null } }));
    const feed = start(send); await feed.scan();
    const styles = vi.spyOn(window, "getComputedStyle");
    for (let n = 0; n < 100; n++) await feed.scan(false);
    expect(styles).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    styles.mockRestore();
  });
  it("includes loaded articles before FeedUnit placeholders and stays at the top as placeholders fill", async () => {
    document.body.innerHTML = '<main><div id="lane"><div>Composer</div><section><article role="article">Loaded first post</article></section><section><article role="article">Loaded second post</article></section><div data-pagelet="FeedUnit_loading"><div role="progressbar">Loading</div></div></div></main>';
    const lane = document.getElementById("lane")!;
    const first = lane.children[1]!;
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: items(3, 2, 1), nextCursor: null } }));
    const feed = start(send); await feed.scan();
    expect(lane.children[1]?.getAttribute(FEED_ATTR)).toBe(id(3));
    expect(first.previousElementSibling?.getAttribute(FEED_ATTR)).toBe(id(1));
    for (let n = 0; n < 20; n++) {
      lane.querySelector('[data-pagelet]')!.outerHTML = `<section><div role="article">New Facebook post ${n}</div></section><div data-pagelet="FeedUnit_loading">Loading</div>`;
      await feed.scan();
      expect(lane.children[1]?.getAttribute(FEED_ATTR)).toBe(id(3));
      expect(lane.querySelectorAll("iframe")).toHaveLength(3);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("restores all removed cards without re-fetching the same feed or resetting pagination", async () => {
    const lane = layout(2);
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: items(3, 2, 1), nextCursor: null } }));
    const feed = start(send); await feed.scan();
    const cards = [...lane.querySelectorAll<HTMLElement>(`[${FEED_ATTR}]`)];
    cards.forEach(card => card.remove());
    await feed.scan();
    expect([...lane.querySelectorAll(`[${FEED_ATTR}]`)]).toEqual(cards);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("prefers the home post lane over a secondary role=feed at the bottom", async () => {
    const column = layout(3);
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<section role="feed" id="suggested"><div role="article">Suggested bottom post</div><div role="article">More suggestions</div></section>');
    expect(findFeedLocation(document)?.column).toBe(column);
    await start(async () => ({ ok: true, result: { enabled: true, items: items(3, 2, 1), nextCursor: null } })).scan();
    expect(column.children[1]!.getAttribute(FEED_ATTR)).toBe(id(3));
    expect(document.querySelector("#suggested iframe")).toBeNull();
  });
  it("keeps cards before the first native post through repeated host insertions, reorder and partial removal", async () => {
    const column = layout(3);
    column.style.display = "flex"; column.style.flexDirection = "column";
    const first = column.querySelector<HTMLElement>('[data-pagelet="FeedUnit_0"]')!;
    first.style.order = "-10";
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: items(3, 2, 1), nextCursor: null } }));
    const feed = start(send); await feed.scan();
    const cards = [...column.querySelectorAll<HTMLElement>(`[${FEED_ATTR}]`)];
    for (let n = 0; n < 20; n++) {
      // React treats inserted cards as unmanaged DOM and can append/reorder native siblings.
      for (const card of cards) column.append(card);
      first.style.order = String(-20 - n);
      await feed.scan();
      expect(first.previousElementSibling).toBe(cards[2]);
      expect(cards[0]!.nextElementSibling).toBe(cards[1]);
      expect(cards.every(card => card.style.order === first.style.order)).toBe(true);
    }
    cards[1]!.remove(); await feed.scan();
    expect(cards[1]!.nextElementSibling).toBe(cards[2]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(column.querySelectorAll("iframe")).toHaveLength(3);
  });
  it("targets the center post column, keeps stories above it, and starts with the newest five", async () => {
    const column = layout(2);
    expect(findFeedLocation(document)?.column).toBe(column);
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: items(10, 9, 8, 7, 6), nextCursor: "older" } }));
    await start(send).scan();
    expect(document.querySelector("main")!.querySelector(`:scope > [${FEED_ATTR}]`)).toBeNull();
    expect(column.firstElementChild!.textContent).toContain("Composer");
    expect([...column.querySelectorAll(`[${FEED_ATTR}]`)].map((el) => el.getAttribute(FEED_ATTR))).toEqual(items(10, 9, 8, 7, 6).map((p) => p.postId));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not insert into an ambiguous main layout with no post lane", async () => {
    document.body.innerHTML = '<main style="display:flex"><div>Stories</div><aside role="complementary"><div role="article">Sidebar</div></aside></main>';
    const send = vi.fn(async () => ({}));
    await start(send).scan();
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector(`[${FEED_ATTR}]`)).toBeNull();
  });
  it("paginates and interleaves one card after three Facebook posts, without duplicates", async () => {
    const column = layout();
    const send = vi.fn(async (m: unknown) => ({ ok: true, result: { enabled: true,
      items: (m as { payload: { cursor?: string } }).payload.cursor ? items(6, 5, 4, 3, 2) : items(10, 9, 8, 7, 6), nextCursor: (m as { payload: { cursor?: string } }).payload.cursor ? null : "older" } }));
    const feed = start(send);
    await feed.scan();
    for (const [i, n] of [[2, 5], [5, 4], [8, 3]]) expect(column.querySelector(`[data-pagelet="FeedUnit_${i}"]`)!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(n!));
    await feed.scan();
    expect(send).toHaveBeenCalledTimes(2);
    const ids = [...column.querySelectorAll(`[${FEED_ATTR}]`)].map((el) => el.getAttribute(FEED_ATTR));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("polls for new posts and inserts ahead of scrolling without prepending above the reader", async () => {
    const column = layout();
    let clock = 100000;
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: clock === 100000 ? items(5, 4, 3, 2, 1) : items(7, 6, 5, 4, 3), nextCursor: null } }));
    const feed = start(send, () => clock);
    await feed.scan();
    const first = column.querySelector(`[${FEED_ATTR}]`);
    const past = column.querySelector<HTMLElement>('[data-pagelet="FeedUnit_2"]')!;
    vi.spyOn(past, "getBoundingClientRect").mockReturnValue({ top: -1000, bottom: -800 } as DOMRect);
    clock += 30001;
    await feed.scan();
    expect(column.querySelector(`[${FEED_ATTR}]`)).toBe(first);
    expect(column.querySelector('[data-pagelet="FeedUnit_5"]')!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(7));
    expect(column.querySelector('[data-pagelet="FeedUnit_8"]')!.nextElementSibling?.getAttribute(FEED_ATTR)).toBe(id(6));
    expect(past.nextElementSibling?.hasAttribute(FEED_ATTR)).toBe(false);
  });
  it("refreshes every 30 seconds while visible, recovers network errors, and stops all work when disabled", async () => {
    vi.useFakeTimers(); layout(2);
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true, result: { enabled: true, items: items(1), nextCursor: null } });
    const feed = start(send, () => Date.now());
    await feed.scan();
    expect(document.body.textContent).toContain("Retrying");
    await vi.advanceTimersByTimeAsync(30001);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    feed.stop();
    await vi.advanceTimersByTimeAsync(90000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
  it("sizes only the matching extension frame and ignores forged host messages", async () => {
    layout(2); await start(async () => ({ ok: true, result: { enabled: true, items: items(1), nextCursor: null } })).scan();
    const frame = document.querySelector("iframe")!;
    window.dispatchEvent(new MessageEvent("message", { origin: "https://www.facebook.com", source: frame.contentWindow, data: { type: "osp.card.height", height: 900 } }));
    expect(frame.style.height).toBe("180px");
    window.dispatchEvent(new MessageEvent("message", { origin: "chrome-extension://osp-test-extension", source: frame.contentWindow, data: { type: "osp.card.height", height: 340 } }));
    expect(frame.style.height).toBe("340px");
  });
  it("recovers after Facebook replaces its post lane and resets pagination on a new route", async () => {
    layout(2);
    const send = vi.fn(async () => ({ ok: true, result: { enabled: true, items: items(2, 1), nextCursor: null } }));
    const feed = start(send);
    await feed.scan();
    expect(document.querySelectorAll("iframe")).toHaveLength(2);
    layout(2);
    await feed.scan();
    expect(document.querySelectorAll("iframe")).toHaveLength(2);
    history.pushState({}, "", "/groups/test");
    await feed.scan();
    expect(document.querySelectorAll("iframe")).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    history.replaceState({}, "", "/");
  });
});
