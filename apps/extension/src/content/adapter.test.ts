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
  it("does not rescan the whole page for typing, unrelated counters, or extension-owned insertions", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = fixture("composer.html");
    const running = startFacebookAdapter({ document, location: () => "https://www.facebook.com/", sendMessage: async () => ({ ok: true, result: { enabled: false } }), randomAttemptId: () => "ab".repeat(16) })!;
    try {
      await vi.advanceTimersByTimeAsync(200);
      const queries = vi.spyOn(document, "querySelectorAll");
      const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
      for (let n = 0; n < 100; n++) {
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        editor.append(document.createTextNode("a"));
        const counter = document.createElement("span"); counter.textContent = String(n); document.body.append(counter);
      }
      await vi.advanceTimersByTimeAsync(500);
      expect(queries).not.toHaveBeenCalled();
      queries.mockRestore();
    } finally { running.stop(); vi.useRealTimers(); }
  });
  it("ignores page-generated Post clicks even with opt-in and active userGesture", async () => {
    document.body.innerHTML = fixture("composer.html");
    const sendMessage = vi.fn(async () => ({ ok: true, result: { enabled: false } }));
    const running = startFacebookAdapter({ document, location: () => "https://www.facebook.com/", sendMessage, randomAttemptId: () => "ab".repeat(16), userGesture: () => true })!;
    (document.querySelector(`[${CONTROL_ATTR}] input`) as HTMLInputElement).checked = true;
    document.querySelector<HTMLElement>('[aria-label="Post"]')!.click();
    expect(sendMessage.mock.calls.some(call => (call as unknown as [{ type: string }])[0].type === "crosspost.publish")).toBe(false);
    running.stop();
  });
  it("publishes the Friends selection immediately from a trusted Post action without changing Facebook's submit", async () => {
    document.body.innerHTML = fixture("composer.html");
    const sendMessage = vi.fn(async () => ({ ok: true, result: { status: "published", message: "Published to Open Social · Friends" } }));
    const running = startFacebookAdapter({ document, location: () => "https://www.facebook.com/", sendMessage, randomAttemptId: () => "bc".repeat(16), trustedEvent: () => true })!;
    const checkbox = document.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)!;
    const audience = document.querySelector<HTMLSelectElement>(`[${CONTROL_ATTR}] select`)!;
    expect(audience.disabled).toBe(true);
    checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
    expect(audience.disabled).toBe(false); audience.value = "1";
    const hostPost = vi.fn(); document.querySelector('[aria-label="Post"]')!.addEventListener("click", hostPost);
    document.querySelector<HTMLElement>('[aria-label="Post"]')!.click();
    expect(hostPost).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "crosspost.publish", payload: expect.objectContaining({ audience: 1, text: "Hello from the fixture composer" }) }));
    await vi.waitFor(() => expect(document.querySelector(`[${TOAST_ATTR}]`)?.textContent).toContain("Published to Open Social · Friends"));
    running.stop();
  });
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
    expect(submit).toHaveBeenCalledWith("Draft", 0, expect.any(Event));
    document.querySelector("button")!.click();
    expect(submit).toHaveBeenCalledTimes(1);
    post.remove();
    expect(facebookAdapter.findSubmitButton(document.querySelector('[role="dialog"]')!)).toBeNull();
  });

  it("wakes after idle when the user opens a composer without refocusing Facebook", async () => {
    vi.useFakeTimers();
    const running = startFacebookAdapter({ document, location: () => "https://www.facebook.com/", sendMessage: async () => ({ ok: true, result: { enabled: false } }), trustedEvent: () => true, randomAttemptId: () => "ab".repeat(16) })!;
    try {
      expect(document.querySelector(`[${STATUS_ATTR}]`)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(60_100);
      expect(running.observer.active).toBe(false);
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.body.insertAdjacentHTML("beforeend", fixture("composer.html"));
      await vi.advanceTimersByTimeAsync(150);
      expect(document.querySelectorAll(`[${CONTROL_ATTR}]`)).toHaveLength(1);
    } finally { running.stop(); vi.useRealTimers(); }
  });

  it("applies feed changes immediately, cleans up on stop, and allows a fresh enable with one submit listener", async () => {
    document.body.innerHTML = fixture("composer.html");
    let enabled = false;
    const sendMessage = vi.fn(async () => ({ ok: true, result: { enabled, items: [] } }));
    const runtime = { document, location: () => "https://www.facebook.com/", sendMessage, trustedEvent: () => true, randomAttemptId: () => "ab".repeat(16) };
    const first = startFacebookAdapter(runtime)!;
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(call => (call as unknown as [{ type: string }])[0].type === "feed.request")).toHaveLength(1));
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
    expect(sendMessage.mock.calls.filter((call) => (call as unknown as [{ type: string }])[0].type === "crosspost.publish")).toHaveLength(1);
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
    expect(onSubmit).toHaveBeenCalledWith("Hello from the fixture composer", 0, expect.any(Event));
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
    const sendMessage = vi.fn(async (_message: unknown) => ({ ok: true, result: { status: "published", message: TOAST_SENT } }));
    let href = "https://www.facebook.com/";
    const running = startFacebookAdapter({
      document,
      location: () => href,
      sendMessage,
      trustedEvent: () => true, randomAttemptId: () => "ab".repeat(16),
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
    expect(sent.filter((m) => m.type !== "crosspost.publish").every((m) => ["feed.request", "adapter.preferences"].includes(m.type))).toBe(true);
    const proposals = sent.filter((m) => m.type === "crosspost.publish");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual({
      type: "crosspost.publish",
      payload: { hostSite: "facebook", text: "Hello from the fixture composer", audience: 0, attemptId: "ab".repeat(16), url: "https://www.facebook.com/groups/42", submitted: true, userGesture: true },
    });
    // a second activation of the same text within the debounce window does not propose twice
    document.querySelector('[aria-label="Post"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage.mock.calls.map((call) => call[0] as { type: string }).filter((m) => m.type === "crosspost.publish")).toHaveLength(1);
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
  it("ignores an in-flight feed response after disable", async () => {
    document.body.innerHTML = '<div role="main"><div role="feed"><div role="article">Facebook post</div></div></div>';
    let resolve!: (value: unknown) => void;
    const pending = maybeInsertFeedCards({ document, sendMessage: () => new Promise((done) => { resolve = done; }) });
    resetFeedCards(document);
    resolve({ ok: true, result: { enabled: true, items: [{ postId: "q".repeat(43) + "=" }], nextCursor: null } });
    expect(await pending).toBeNull();
    expect(document.querySelector(`[${FEED_ATTR}]`)).toBeNull();
  });

  it("inserts a protected full-width card only when enabled and never writes its plaintext into Facebook", async () => {
    document.body.innerHTML = fixture("no-composer.html");
    const disabled = vi.fn(async () => ({ ok: true, result: { enabled: false, items: [], nextCursor: null } }));
    expect(await maybeInsertFeedCards({ document, sendMessage: disabled })).toBeNull();
    resetFeedCards(document);
    const enabled = vi.fn(async () => ({ ok: true, result: { enabled: true, items: [{ postId: "q".repeat(43) + "=", text: "SECRET must not appear in the host DOM" }], nextCursor: null } }));
    const container = await maybeInsertFeedCards({ document, sendMessage: enabled });
    expect(document.querySelector('[role="feed"]')!.firstElementChild).toBe(container);
    expect(container!.getAttribute("aria-label")).toBe("Open Social post");
    expect(new URLSearchParams(new URL(container!.querySelector("iframe")!.src).hash.slice(1)).get("post")).toBe("q".repeat(43) + "=");
    expect(document.body.textContent).not.toContain("SECRET");
    await maybeInsertFeedCards({ document, sendMessage: enabled });
    expect(enabled).toHaveBeenCalledTimes(1);
    resetFeedCards(document);
  });
});
