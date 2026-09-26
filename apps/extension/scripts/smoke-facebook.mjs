// Execute the packaged classic content script, including its entry/lifecycle wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<body><div role="main"><div role="feed"><section id="first-post"><div role="article">Facebook post</div></section><div data-pagelet="FeedUnit_loading">Loading Facebook</div></div></div></body>', { url: "https://www.facebook.com/", pretendToBeVisual: true });
// jsdom has no browser input driver. Capture the listener to exercise the trusted-event
// boundary explicitly; separately prove ordinary synthetic DOM clicks cannot publish.
const capturedClicks = new Map();
const addEvent = dom.window.EventTarget.prototype.addEventListener;
dom.window.EventTarget.prototype.addEventListener = function(type, callback, options) {
  if (type === "click" && options === true) capturedClicks.set(this, callback);
  return addEvent.call(this, type, callback, options);
};
const trustedPost = () => {
  const dialog = dom.window.document.querySelector('[role="dialog"]');
  capturedClicks.get(dialog).call(dialog, { target: dialog.querySelector('[role="button"]'), isTrusted: true });
};
const listeners = new Set();
const requests = [];
const timers = new Set();
let feedEnabled = false;
let attributionEnabled = true;
const chrome = { runtime: { id: "smokeextensionid", getURL: (path) => `chrome-extension://smokeextensionid/${path}`, onMessage: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
  sendMessage: async (message) => {
    requests.push(message);
    return { ok: true, result: message.type === "adapter.preferences" ? { facebookAttribution: attributionEnabled } : message.type === "feed.request" ? { enabled: feedEnabled, items: [{ postId: "q".repeat(43) + "=" }], nextCursor: null } : { status: "published", message: "Published to Open Social · Friends" } };
  },
} };
const context = vm.createContext({ document: dom.window.document, location: dom.window.location, navigator: dom.window.navigator, chrome,
  crypto: globalThis.crypto, MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; }, clearInterval, URL,
  setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; }, clearTimeout,
}, { codeGeneration: { strings: false, wasm: false } });
const script = new vm.Script(readFileSync(new URL("../dist/content/facebook.js", import.meta.url), "utf8"));
const inject = () => script.runInContext(context);
const settle = () => new Promise((resolve) => setTimeout(resolve, 180));
const doc = dom.window.document;
// jsdom lacks native contenteditable editing. Exercise the packaged command path and its input
// notification, not just a string helper. This is not a live Facebook editor acceptance test.
let hostDraft;
doc.execCommand = (command, _ui, text) => {
  const range = doc.getSelection().getRangeAt(0);
  range.deleteContents();
  if (command === "insertText") range.insertNode(doc.createTextNode(text));
  const editor = doc.querySelector('[contenteditable]');
  editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: command === "delete" ? "deleteContentBackward" : "insertText", data: text }));
  hostDraft = editor.textContent;
  return true;
};
const stop = (sender = { id: chrome.runtime.id }, origins = ["https://www.facebook.com/*"]) => {
  for (const fn of listeners) fn({ type: "osp.facebook.stop", origins }, sender);
};
try {
  inject();
  inject();
  await settle();
  assert.equal(listeners.size, 1, "Repeated injection must not add listeners");
  assert.equal(doc.querySelectorAll("[data-osp-facebook-status]").length, 1);
  assert.equal(doc.querySelectorAll("[data-osp-feed]").length, 0);
  doc.body.insertAdjacentHTML("beforeend", '<section role="dialog"><div contenteditable="true" data-lexical-editor="true">My Facebook draft</div><footer><div role="button"><span>Post</span></div></footer></section>');
  await settle();
  assert.equal(doc.querySelectorAll("[data-osp-control]").length, 1, "A later composer must be detected");
  trustedPost();
  assert.equal(requests.some((m) => m.type === "crosspost.publish"), false, "No opt-in means no draft capture");
  doc.querySelector("[data-osp-control] input").checked = true;
  doc.querySelector("[data-osp-control] select").value = "1";
  doc.querySelector('[role="button"]').click();
  assert.equal(requests.some(m => m.type === "crosspost.publish"), false, "Page-generated clicks cannot authorize publishing");
  trustedPost();
  await settle();
  const proposals = requests.filter((m) => m.type === "crosspost.publish");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].payload.text, "My Facebook draft");
  assert.equal(proposals[0].payload.audience, 1);
  assert.equal(hostDraft, "My Facebook draft\n\nPosted on Open Social\nhttps://opensocial.online/about", "Facebook's editor receives the visible link while the protocol receives the original draft");
  assert.equal(doc.querySelector("[data-osp-toast]")?.textContent.includes("Published to Open Social"), true);
  feedEnabled = true;
  inject();
  await settle();
  assert.equal(doc.querySelectorAll('[role="main"] [data-osp-feed]').length, 1, "Feed toggle must take effect on an existing tab");
  const card = doc.querySelector('[data-osp-feed]');
  assert.equal(card.nextElementSibling.id, "first-post", "Loaded articles must precede FeedUnit placeholders");
  doc.querySelector('[data-pagelet]').outerHTML = '<section role="article">Loaded later</section><div data-pagelet="FeedUnit_next">Loading next</div>';
  await settle();
  assert.equal(card.nextElementSibling.id, "first-post", "Placeholder replacement must not push the card to the tail");
  doc.querySelector('[role="feed"]').append(card); await settle();
  assert.equal(card.nextElementSibling.id, "first-post", "External reordering must be detected without observing our own moves in a loop");
  const feedReads = requests.filter(m => m.type === "feed.request").length;
  card.remove(); await settle();
  assert.equal(doc.querySelector('[data-osp-feed]'), card, "Host removal restores the same card");
  assert.equal(requests.filter(m => m.type === "feed.request").length, feedReads, "Restoration must not refetch the feed");
  attributionEnabled = false; inject(); await settle();
  assert.equal(doc.querySelector('[contenteditable]').textContent, "My Facebook draft", "Changing the setting removes the managed footer from an open draft");
  assert.equal(doc.querySelectorAll("[data-osp-control]").length, 1);
  stop({ id: "untrusted" });
  stop({ id: chrome.runtime.id }, ["https://web.facebook.com/*"]);
  assert.equal(listeners.size, 1, "Wrong sender or origin must not stop the adapter");
  stop();
  assert.equal(doc.querySelectorAll("[data-osp-control], [data-osp-feed], [data-osp-facebook-status], [data-osp-toast], [data-osp-hooked]").length, 0);
  assert.equal(listeners.size, 0);
  inject();
  await settle();
  assert.equal(doc.querySelectorAll("[data-osp-control]").length, 1, "Disable/re-enable must restore one usable control");
  doc.querySelector("[data-osp-control] input").checked = true;
  trustedPost();
  assert.equal(requests.filter((m) => m.type === "crosspost.publish").length, 2);
  assert.ok(requests.every((m) => ["feed.request", "crosspost.publish", "adapter.preferences"].includes(m.type)), "Content script may only request feed identifiers and explicit audience-selected publication");
  console.log("dist Facebook smoke passed (mixed loaded/placeholder feed, card recovery, attribution opt-out, native editing boundary, trusted publish + audience, lifecycle; isolated realm)");
} finally {
  stop();
  for (const id of timers) { clearTimeout(id); clearInterval(id); }
  dom.window.close();
}
