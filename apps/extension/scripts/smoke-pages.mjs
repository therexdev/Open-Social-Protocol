// Render the shipped extension pages in independent realms with MV3 code generation disabled.
// Unlike the unit-test setup, this does NOT install the protobuf workaround for the app.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
const status = { status: "unlocked", account: "1SmokeAccount", deviceAuthorized: true, ownerAvailable: true,
  network: { name: "harbinger", deployed: true, indexerUrl: "" }, pending: 0, autoLockMinutes: 15 };

async function smoke(page, exercise) {
  const dom = new JSDOM(readFileSync(path.join(dist, page), "utf8"), { url: `https://extension.test/${page}#post=${"q".repeat(43)}%3D&host=https%3A%2F%2Fwww.facebook.com`, referrer: "https://www.facebook.com/", pretendToBeVisual: true });
  const calls = [];
  const errors = [];
  const timers = new Set();
  const storageListeners = new Set();
  const resizeMessages = [];
  let item = { postId: "q".repeat(43) + "=", author: "1Author", authorName: "Jim Profits", viewer: "1Viewer", audience: 1,
    epoch: 1, createdAt: String(Date.now() - 60000), versionNumber: 1, status: "decrypted", text: "Private friend text", reactions: 2, replyCount: 1, labels: [], media: [{ mime: "image/png", locations: ["javascript:alert(1)"], alt_text: "Unsafe link" }] };
  dom.window.addEventListener("error", (event) => { errors.push(event.error); event.preventDefault(); });
  const chrome = { runtime: { openOptionsPage: async () => {}, sendMessage: async ({ type, payload }) => {
    calls.push({ type, payload });
    let result;
    switch (type) {
      case "vault.status": result = status; break;
      case "feed.get": result = { items: [], nextCursor: null }; break;
      case "crosspost.list": result = { items: [] }; break;
      case "crosspost.create": result = { record: { ...payload, state: "draft", attemptId: "smoke" }, explanation: {} }; break;
      case "crosspost.discard": result = {}; break;
      case "settings.get": result = { settings: { rpcUrls: [], sponsorUrls: [], network: "harbinger" }, resolved: { network: "harbinger", deployed: true, rpcUrls: [], sponsorUrls: [] }, networks: ["harbinger"] }; break;
      case "adapter.status": result = { facebook: { wanted: false, granted: false, registered: false }, feedInsertion: false }; break;
      case "embed.post": result = { enabled: true, item }; break;
      default: throw new Error(`Unexpected page RPC: ${type}`);
    }
    return { ok: true, result };
  } }, storage: { onChanged: { addListener: (fn) => storageListeners.add(fn), removeListener: (fn) => storageListeners.delete(fn) } } };
  const context = vm.createContext({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver, HTMLElement: dom.window.HTMLElement,
    HTMLIFrameElement: dom.window.HTMLIFrameElement,
    Event: dom.window.Event, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    URL, URLSearchParams, crypto: globalThis.crypto, chrome, location: dom.window.location,
    parent: { postMessage: (message, origin) => resizeMessages.push({ message, origin }) },
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } disconnect() {} },
    fetch: async (url) => { assert.ok(String(url).startsWith("https://extension.test/"), "Only module preloads may fetch in the page test"); return {}; },
    console: { ...console, error: (...args) => errors.push(args.map(String).join(" ")) },
    performance, queueMicrotask,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout,
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval,
  }, { codeGeneration: { strings: false, wasm: false } });
  // Browser globals refer to the same realm (google-protobuf exports through window).
  context.window = context.self = context;
  context.addEventListener = dom.window.addEventListener.bind(dom.window);
  context.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  context.reportError = (error) => errors.push(error);
  const modules = new Map();
  function moduleAt(filename) {
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(readFileSync(filename, "utf8"), { context, identifier: filename }));
    return modules.get(filename);
  }
  const script = dom.window.document.querySelector('script[type="module"]');
  assert.ok(script, `${page}: missing entry script`);
  try {
    const entry = moduleAt(path.join(dist, script.getAttribute("src").replace(/^\//, "")));
    await entry.link((specifier, parent) => moduleAt(path.resolve(path.dirname(parent.identifier), specifier)));
    await entry.evaluate();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    const button = (label) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
    await settle();
    await exercise({ dom, calls, button, settle, errors, resizeMessages, lock: () => {
      item = { ...item, status: "locked", text: undefined, media: undefined, message: "Unlock to read this post." };
      for (const fn of storageListeners) fn({ "osp.session": { newValue: undefined } }, "session");
    } });
    assert.deepEqual(errors, [], `${page}: render errors`);
  } finally {
    for (const id of timers) { clearTimeout(id); clearInterval(id); }
    dom.window.close();
  }
}

await smoke(manifest.side_panel.default_path, async ({ dom, calls, button, settle, errors }) => {
  assert.ok(button("Feed"), "Feed tab must render");
  button("Compose").click();
  await settle();
  const input = dom.window.document.querySelector("textarea");
  assert.ok(input, `Compose tab must render its editor under the MV3 CSP: ${errors.map(String).join("; ")}`);
  // Native value setter + input event exercise React's actual onChange handler.
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(input, "Hello from the packaged composer");
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settle();
  assert.equal(button("Review…").disabled, false);
  button("Review…").click();
  await settle();
  assert.ok(button("Confirm and publish"), "Review must require explicit confirmation");
  assert.equal(calls.filter((c) => c.type === "crosspost.create").length, 1);
  assert.equal(calls.some((c) => c.type === "crosspost.confirm"), false, "Review must not publish");
  button("Cancel").click();
  await settle();
  button("Queue").click();
  await settle();
  assert.ok(dom.window.document.body.textContent.includes("No cross-posts yet"));
  button("Compose").click();
  await settle();
  assert.ok(dom.window.document.querySelector("textarea"), "Compose must survive repeat navigation");
});
await smoke(manifest.options_page, async ({ dom }) => {
  assert.ok(dom.window.document.body.textContent.includes("Facebook adapter"), "Options page must render");
});
await smoke("src/embed/index.html", async ({ dom, calls, settle, lock, resizeMessages }) => {
  const doc = dom.window.document;
  assert.ok(doc.querySelector(".post-author")?.textContent.includes("Jim Profits"));
  assert.ok(doc.querySelector(".chip-friends")?.textContent.includes("Friends"));
  assert.ok(doc.querySelector(".post-text")?.textContent.includes("Private friend text"));
  assert.equal(doc.querySelector('a[href^="javascript:"]'), null);
  assert.equal(doc.querySelector("img"), null, "Media must not load without opting in");
  assert.ok([...doc.querySelectorAll(".post-footer a")].every((a) => a.target === "_blank" && a.href.startsWith("https://opensocial.online/post/")));
  assert.equal(calls.every((call) => call.type === "embed.post"), true, "Embedded cards only perform read-only calls");
  assert.ok(resizeMessages.length > 0);
  assert.equal(resizeMessages[0].origin, "https://www.facebook.com");
  assert.equal(JSON.stringify(resizeMessages).includes("Private friend text"), false);
  lock();
  await settle();
  assert.equal(doc.body.textContent.includes("Private friend text"), false, "Lock must remove decrypted text");
  assert.ok(doc.body.textContent.includes("Unlock to read"));
});
console.log(`dist page smoke passed (${manifest.version}: panel navigation, options and embedded post/lock; eval disabled in independent realms)`);
