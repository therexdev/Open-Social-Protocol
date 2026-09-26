import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_ATTR, LABEL_TEXT, TOAST_ATTR, createBoundedObserver, scanAndInject } from "./adapter";
import { ADAPTER_ATTR, STATUS_ATTR, TOAST_SENT, facebookAdapter, startFacebookAdapter } from "./facebookAdapter";
import { FEED_ATTR, maybeInsertFeedCards, resetFeedCards } from "./feedCards";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

beforeEach(() => {
  document.documentElement.removeAttribute(ADAPTER_ATTR);
  document.body.innerHTML = "";
  resetFeedCards(document);
});

describe("facebook composer adapter", () => {
  it("detects non-div dialogs and text-labeled disabled Post controls without mistaking other actions for Post", () => {
    document.body.innerHTML = '<section role="dialog"><div contenteditable="true" data-lexical-editor="true">Draft</div><footer><div role="button" aria-disabled="true"><span>Post</span></div><button>Photo/video</button></footer></section>';
    const submit = vi.fn();
    expect(scanAndInject(document, facebookAdapter, document, submit)).toBe(1);
    (document.querySelector(`[${CONTROL_ATTR}] input`) as HTMLInputElement).checked = true;
    const post = document.querySelector('[role="button"]')!;
    post.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(submit).not.toHaveBeenCalled();
    post.removeAttribute("aria-disabled");
    post.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(submit).toHaveBeenCalledWith("Draft");
    document.querySelector("button")!.click();
    expect(submit).toHaveBeenCalledTimes(1);
    post.remove();
    expect(facebookAdapter.findSubmitButton(document.querySelector('[role="dialog"]')!)).toBeNull();
  });

  it("wakes after idle when the user opens a composer without refocusing Facebook", async () => {
    vi.useFakeTimers();
    const running = startFacebookAdapter({ document, location: () => "https://www.facebook.com/", sendMessage: async () => ({ ok: true, result: { enabled: false } }), randomAttemptId: () => "ab".repeat(16) })!;
    try {
      expect(document.querySelector(`[${STATUS_ATTR}]`)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(60_100);
      expect(running.observer.active).toBe(false);
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.body.insertAdjacentHTML("beforeend", fixture("composer.html"));
      await vi.advanceTimersByTimeAsync(40);
      expect(document.querySelectorAll(`[${CONTROL_ATTR}]`)).toHaveLength(1);
    } finally { running.stop(); vi.useRealTimers(); }
  });

  it("applies feed changes immediately, cleans up on stop, and allows a fresh enable with one submit listener", async () => {
    document.body.innerHTML = fixture("composer.html");
    let enabled = false;
    const sendMessage = vi.fn(async () => ({ ok: true, result: { enabled, items: [] } }));
    const runtime = { document, location: () => "https://www.facebook.com/", sendMessage, randomAttemptId: () => "ab".repeat(16) };
    const first = startFacebookAdapter(runtime)!;
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(document.querySelector(`[${FEED_ATTR}]`)).toBeNull();
    enabled = true;
    first.refresh();
    await vi.waitFor(() => expect(document.querySelector(`[${FEED_ATTR}]`)).not.toBeNull());
    enabled = false;
    first.refresh();
    expect(document.querySelector(`[${FEED_ATTR}]`)).toBeNull();
    first.stop();
    expect(document.querySelector(`[${CONTROL_ATTR}], [${STATUS_ATTR}]`)).toBeNull();
    expect(document.querySelector('[data-osp-hooked]')).toBeNull();
    const second = startFacebookAdapter(runtime)!;
    (document.querySelector(`[${CONTROL_ATTR}] input`) as HTMLInputElement).checked = true;
    document.querySelector<HTMLElement>('[aria-label="Post"]')!.click();
    expect(sendMessage.mock.calls.filter((call) => (call as unknown as [{ type: string }])[0].type === "crosspost.propose")).toHaveLength(1);
    second.stop();
  });

  it("injects the labeled control exactly once and hooks the submit control", () => {
    document.body.innerHTML = fixture("composer.html");
    const onSubmit = vi.fn();
    expect(scanAndInject(document, facebookAdapter, document, onSubmit)).toBe(1);
    expect(scanAndInject(document, facebookAdapter, document, onSubmit)).toBe(0);
    const controls = document.querySelectorAll(`[${CONTROL_ATTR}]`);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.textContent).toContain(LABEL_TEXT);
    const dialog = document.querySelector('div[role="dialog"]')!;
    expect(controls[0]!.nextElementSibling).toBe(dialog.querySelector(".footer"));

    const post = document.querySelector('[aria-label="Post"] span') as HTMLElement;
    post.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSubmit).not.toHaveBeenCalled(); // checkbox off: nothing is sent

    (controls[0]!.querySelector("input") as HTMLInputElement).checked = true;
    post.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Hello from the fixture composer");
    // other buttons do not trigger it, and page content outside the textbox is never read
    document.querySelector('[aria-label="Photo/video"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).not.toContain("existing host post");
  });

  it("injects nothing on a page without a composer", () => {
    document.body.innerHTML = fixture("no-composer.html");
    const onSubmit = vi.fn();
    expect(scanAndInject(document, facebookAdapter, document, onSubmit)).toBe(0);
    expect(document.querySelector(`[${CONTROL_ATTR}]`)).toBeNull();
    document.querySelector('[aria-label="Close"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends only the composer text to the service worker and shows the toast", async () => {
    document.body.innerHTML = fixture("composer.html");
    const sendMessage = vi.fn(async (_message: unknown) => ({ ok: true, result: { queued: true } }));
    let href = "https://www.facebook.com/";
    const running = startFacebookAdapter({
      document,
      location: () => href,
      sendMessage,
      randomAttemptId: () => "ab".repeat(16),
      userGesture: () => true,
    });
    expect(running).not.toBeNull();
    expect(document.documentElement.getAttribute(ADAPTER_ATTR)).toBe("1");
    expect(startFacebookAdapter({ document, location: () => "x", sendMessage, randomAttemptId: () => "" })).toBeNull(); // no double start
    href = "https://www.facebook.com/groups/42"; // Facebook navigated client-side since the script started
    (document.querySelector(`[${CONTROL_ATTR}] input`) as HTMLInputElement).checked = true;
    document.querySelector('[aria-label="Post"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const sent = sendMessage.mock.calls.map((call) => call[0] as { type: string });
    // besides the proposal, the adapter only ever asks whether labeled feed cards are enabled
    expect(sent.filter((m) => m.type !== "crosspost.propose").every((m) => m.type === "feed.request")).toBe(true);
    const proposals = sent.filter((m) => m.type === "crosspost.propose");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual({
      type: "crosspost.propose",
      payload: { hostSite: "facebook", text: "Hello from the fixture composer", attemptId: "ab".repeat(16), url: "https://www.facebook.com/groups/42", submitted: true, userGesture: true },
    });
    // a second activation of the same text within the debounce window does not propose twice
    document.querySelector('[aria-label="Post"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage.mock.calls.map((call) => call[0] as { type: string }).filter((m) => m.type === "crosspost.propose")).toHaveLength(1);
    await vi.waitFor(() => expect(document.querySelector(`[${TOAST_ATTR}]`)?.textContent).toContain(TOAST_SENT));
    running!.stop();
  });

  it("re-injects when the host re-renders the dialog and survives selector failures", () => {
    document.body.innerHTML = fixture("composer.html");
    const onSubmit = vi.fn();
    scanAndInject(document, facebookAdapter, document, onSubmit);
    document.querySelector(`[${CONTROL_ATTR}]`)!.remove();
    expect(scanAndInject(document, facebookAdapter, document, onSubmit)).toBe(1);
    // a dialog whose footer cannot be found injects nothing and breaks nothing
    document.body.innerHTML = '<div role="dialog"><div contenteditable="true" role="textbox">x</div></div>';
    expect(scanAndInject(document, facebookAdapter, document, onSubmit)).toBe(0);
  });
});

describe("bounded observer", () => {
  it("batches mutations and disconnects when idle", async () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const onBatch = vi.fn();
      const observer = createBoundedObserver({ target: document.body, onBatch, idleMs: 1000, schedule: (cb) => setTimeout(cb, 0), now: () => t });
      observer.start();
      expect(observer.active).toBe(true);
      document.body.appendChild(document.createElement("div"));
      document.body.appendChild(document.createElement("div"));
      await vi.advanceTimersByTimeAsync(5);
      expect(onBatch).toHaveBeenCalledTimes(1);
      t = 5000;
      await vi.advanceTimersByTimeAsync(1100);
      expect(observer.active).toBe(false);
      observer.start();
      expect(observer.active).toBe(true);
      observer.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("labeled feed cards", () => {
  it("supports ARIA main roots and ignores an in-flight feed response after disable", async () => {
    document.body.innerHTML = '<div role="main"></div>';
    let resolve!: (value: unknown) => void;
    const pending = maybeInsertFeedCards({ document, sendMessage: () => new Promise((done) => { resolve = done; }) });
    resetFeedCards(document);
    resolve({ ok: true, result: { enabled: true, items: [] } });
    expect(await pending).toBeNull();
    expect(document.querySelector(`[${FEED_ATTR}]`)).toBeNull();
    expect(await maybeInsertFeedCards({ document, sendMessage: async () => ({ ok: true, result: { enabled: true, items: [] } }) })).not.toBeNull();
    expect(document.querySelector('[role="main"]')!.firstElementChild!.hasAttribute(FEED_ATTR)).toBe(true);
  });

  it("inserts one labeled container at the top of the feed only when enabled", async () => {
    document.body.innerHTML = fixture("no-composer.html");
    const disabled = vi.fn(async () => ({ ok: true, result: { enabled: false, items: [] } }));
    expect(await maybeInsertFeedCards({ document, sendMessage: disabled })).toBeNull();
    expect(document.querySelector(`[${FEED_ATTR}]`)).toBeNull();
    resetFeedCards(document);
    const enabled = vi.fn(async () => ({ ok: true, result: { enabled: true, items: [{ postId: "p1", author: "1Abcdefghijklmnop", text: "<b>hello</b>", createdAt: "1" }] } }));
    const container = await maybeInsertFeedCards({ document, sendMessage: enabled });
    expect(container).not.toBeNull();
    expect(document.querySelector('[role="feed"]')!.firstElementChild).toBe(container);
    expect(container!.getAttribute("aria-label")).toBe("Open Social Protocol posts");
    expect(container!.querySelector("b")).toBeNull(); // text only, never HTML
    expect(container!.textContent).toContain("<b>hello</b>");
    expect(await maybeInsertFeedCards({ document, sendMessage: enabled })).toBe(container);
    expect(enabled).toHaveBeenCalledTimes(1);
    expect(container!.querySelectorAll("script, [onclick]")).toHaveLength(0);
  });
});
