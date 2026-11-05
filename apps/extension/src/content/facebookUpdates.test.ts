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
