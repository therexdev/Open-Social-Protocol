import { afterEach, expect, it, vi } from "vitest";
import { facebookTheme, watchFacebookTheme } from "./facebookTheme";
import { watchPublishedPost } from "./publishedPost";
import { facebookPostUrl } from "../shared/facebookUrl";
import { startFacebookAdapter, type RunningAdapter } from "./facebookAdapter";
let running: RunningAdapter | null;
afterEach(() => { running?.stop(); running = null; document.body.innerHTML = ""; document.documentElement.className = ""; document.documentElement.removeAttribute("style"); vi.useRealTimers(); });

it("tracks Facebook's actual mode and computed palette, independently of the operating-system preference", async () => {
  vi.useFakeTimers(); document.documentElement.className = "__fb-dark-mode";
  expect(facebookTheme(document)).toBe("dark");
  const changed = vi.fn(), stop = watchFacebookTheme(document, changed);
  document.documentElement.className = "__fb-light-mode"; await vi.advanceTimersByTimeAsync(1);
  expect(changed.mock.calls.map(x => x[0])).toEqual(["dark", "light"]);
  document.documentElement.className = ""; document.documentElement.style.setProperty("--card-background", "#242526");
  await vi.advanceTimersByTimeAsync(1); expect(changed).toHaveBeenLastCalledWith("dark"); stop();
});

it("captures only a new matching published post, strips trackers and ignores existing links or unrelated posts", async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<article role="article">My new message<a href="https://www.facebook.com/user/posts/111">Yesterday</a></article>';
  const found = vi.fn(), expired = vi.fn(), stop = watchPublishedPost(document, "My new message", found, expired, 1000);
  document.body.insertAdjacentHTML("beforeend", '<article role="article">Unrelated message<a href="https://www.facebook.com/other/posts/222">Now</a></article>');
  await vi.advanceTimersByTimeAsync(200); expect(found).not.toHaveBeenCalled();
  document.body.insertAdjacentHTML("beforeend", '<article role="article">My new message<a href="https://www.facebook.com/user/posts/333?__cft__=junk">Now</a></article>');
  await vi.advanceTimersByTimeAsync(200); expect(found).toHaveBeenCalledExactlyOnceWith("https://www.facebook.com/user/posts/333");
  await vi.advanceTimersByTimeAsync(1000); expect(expired).not.toHaveBeenCalled(); stop();
});

it("times out ambiguous or absent URLs instead of choosing the wrong post", async () => {
  vi.useFakeTimers(); const found = vi.fn(), expired = vi.fn();
  const stop = watchPublishedPost(document, "Repeated", found, expired, 500);
  document.body.innerHTML = [1, 2].map(n => `<article role="article">Repeated<a href="https://www.facebook.com/user/posts/${n}">Now</a></article>`).join("");
  await vi.advanceTimersByTimeAsync(501); expect(found).not.toHaveBeenCalled(); expect(expired).toHaveBeenCalledOnce(); stop();
  for (const url of ["https://www.facebook.com/", "https://www.facebook.com/profile.php?id=1", "https://evil.test/user/posts/1", "https://www.facebook.com/user/posts/1?comment_id=2"]) expect(facebookPostUrl(url)).toBeUndefined();
  expect(facebookPostUrl("https://web.facebook.com/permalink.php?story_fbid=123&id=456&ref=share")).toBe("https://www.facebook.com/permalink.php?story_fbid=123&id=456");
});

it("defaults auto-check on, honors opt-out and preserves a per-post manual choice during refresh", async () => {
  document.body.innerHTML = '<div role="dialog"><div role="textbox" contenteditable="true">Draft</div><footer><button>Post</button></footer></div>';
  let auto = true;
  running = startFacebookAdapter({ document, location: () => "https://www.facebook.com/", randomAttemptId: () => "11".repeat(16), trustedEvent: () => true,
    sendMessage: async m => (m as { type: string }).type === "adapter.preferences" ? { ok: true, result: { facebookAttribution: true, facebookAutoCheck: auto } } : { ok: true, result: { enabled: false, items: [] } } });
  const box = document.querySelector<HTMLInputElement>('[data-osp-control] input')!;
  await vi.waitFor(() => expect(box.checked).toBe(true));
  expect(document.querySelector('[role="textbox"]')?.textContent).toBe("Draft");
  auto = false; running!.refresh(); await vi.waitFor(() => expect(box.checked).toBe(false));
  box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true }));
  running!.refresh(); await Promise.resolve(); expect(box.checked).toBe(true);
});

it("hydrates a new post's SVG timestamp through hover and matches separate Facebook paragraph blocks", async () => {
  vi.useFakeTimers(); const found = vi.fn(), expired = vi.fn();
  document.body.innerHTML = '<div aria-posinset="1"><a href="?__cft__[0]=old"><svg><use></use></svg></a><div data-ad-preview="message">First line<div>Second line</div></div></div>';
  const oldHover = vi.fn(); document.querySelector('a')!.addEventListener('mouseover', oldHover);
  const stop = watchPublishedPost(document, "First line\nSecond line", found, expired, 1000);
  const row = document.createElement('div'); row.setAttribute('aria-posinset', '2');
  row.innerHTML = '<div role="article"><a href="?__cft__[0]=new"><span aria-labelledby="timestamp"><svg><use></use></svg></span></a><div data-ad-preview="message"><div>First line</div><div>Second line</div></div></div>';
  const link = row.querySelector('a')!, clicked = vi.fn(), hovered = vi.fn(() => { link.href = 'https://www.facebook.com/fixture/posts/pfbid123?__cft__[0]=tracking'; });
  link.addEventListener('mouseover', hovered); link.addEventListener('click', clicked); document.body.append(row);
  await vi.advanceTimersByTimeAsync(400);
  expect(found).toHaveBeenCalledExactlyOnceWith('https://www.facebook.com/fixture/posts/pfbid123');
  expect(hovered).toHaveBeenCalledOnce(); expect(clicked).not.toHaveBeenCalled(); expect(oldHover).not.toHaveBeenCalled(); expect(expired).not.toHaveBeenCalled(); stop();
});

it("ignores old matching rows when their timestamp URL appears late, body links and nested quotes", async () => {
  vi.useFakeTimers(); const found = vi.fn(), expired = vi.fn();
  document.body.innerHTML = '<article role="article"><a href="?__cft__[0]=old">Now</a><div data-ad-preview="message">Same text</div></article>';
  const stop = watchPublishedPost(document, "Same text", found, expired, 1000);
  document.querySelector('a')!.href = 'https://www.facebook.com/fixture/posts/old';
  document.body.insertAdjacentHTML('beforeend', '<div aria-posinset="2"><div data-ad-preview="message">Same text <a href="https://www.facebook.com/someone/posts/body">a reference</a></div><article role="article"><a href="https://www.facebook.com/someone/posts/quote">Now</a>Quoted post</article></div>');
  await vi.advanceTimersByTimeAsync(1001); expect(found).not.toHaveBeenCalled(); expect(expired).toHaveBeenCalledOnce(); stop();
});

it("accepts View in a new success notice but never an old notice or profile link", async () => {
  vi.useFakeTimers(); const found = vi.fn();
  document.body.innerHTML = '<div role="status"><a href="?old">View post</a></div>';
  const stop = watchPublishedPost(document, "Text", found, vi.fn(), 1000);
  document.querySelector('a')!.href = 'https://www.facebook.com/fixture/posts/old';
  document.body.insertAdjacentHTML('beforeend', '<div role="status"><a href="https://www.facebook.com/profile.php?id=1">View</a></div>');
  await vi.advanceTimersByTimeAsync(200); expect(found).not.toHaveBeenCalled();
  document.body.insertAdjacentHTML('beforeend', '<div role="alert">Your post was published. <a href="https://www.facebook.com/fixture/posts/new">View</a></div>');
  await vi.advanceTimersByTimeAsync(200); expect(found).toHaveBeenCalledExactlyOnceWith('https://www.facebook.com/fixture/posts/new'); stop();
});

it("does not choose a resolved link while a second matching row still has an unresolved timestamp", async () => {
  vi.useFakeTimers(); const found = vi.fn(), expired = vi.fn();
  const stop = watchPublishedPost(document, 'Same text', found, expired, 600);
  document.body.innerHTML = '<article role="article"><a href="https://www.facebook.com/fixture/posts/1">Now</a><div data-ad-preview="message">Same text</div></article><article role="article"><a href="?pending">Now</a><div data-ad-preview="message">Same text</div></article>';
  await vi.advanceTimersByTimeAsync(601); expect(found).not.toHaveBeenCalled(); expect(expired).toHaveBeenCalledOnce(); stop();
});
