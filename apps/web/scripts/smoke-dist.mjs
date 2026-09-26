// Exercise the shipped SPA with saved empty overrides, without injecting services or ENV.
// jsdom verifies behavior; this is not a visual/browser-acceptance test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://opensocial.test/people?q=Release", pretendToBeVisual: true });
const errors = [];
const requests = [];
const timers = new Set();
const pending = [];
const doc = dom.window.document;
dom.window.localStorage.setItem("osp.web.settings", JSON.stringify({ network: process.env.VITE_OSP_NETWORK || "harbinger", indexerUrl: "", sponsorUrls: [], rpcUrls: [], payment: "sponsor-then-self" }));
const matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} });
const fetch = async input => {
  const url = new URL(String(input), dom.window.location.href);
  requests.push(url);
  // Hold the response until assertions have observed the actual request destination.
  if (url.pathname === "/v1/people") return new Promise(resolve => pending.push(() => resolve(new Response(JSON.stringify({ items: [] })))));
  throw new Error(`Unexpected network request: ${url.href}`);
};
const context = vm.createContext({
  window: dom.window, document: doc, navigator: dom.window.navigator, location: dom.window.location,
  localStorage: dom.window.localStorage, history: dom.window.history, matchMedia, scrollTo() {},
  Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
  HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver,
  TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, URLSearchParams, AbortController, AbortSignal,
  Request, Response, Headers, crypto: globalThis.crypto, fetch, structuredClone, performance, queueMicrotask,
  console: { ...console, error: (...args) => errors.push(args.map(String).join(" ")) },
  addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  setTimeout(fn, ms) { const id = setTimeout(fn, ms); timers.add(id); return id; }, clearTimeout,
  setInterval(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; }, clearInterval,
});
context.window = context.self = context;
const modules = new Map();
function moduleAt(filename) {
  if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(readFileSync(filename, "utf8"), { context, identifier: filename }));
  return modules.get(filename);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
try {
  const entry = moduleAt(path.join(dist, doc.querySelector('script[type="module"]').getAttribute("src").replace(/^\//, "")));
  await entry.link((specifier, parent) => moduleAt(path.resolve(path.dirname(parent.identifier), specifier)));
  await entry.evaluate();
  for (let i = 0; i < 35 && !requests.some(url => url.pathname === "/v1/people"); i++) await settle();
  assert.ok(!doc.body.textContent.includes("No indexer is configured"), "Release has no indexer configured");
  const people = requests.find(url => url.pathname === "/v1/people");
  assert.ok(people, "Shipped app never requested the nickname search API");
  assert.ok(people.protocol === "https:" || people.hostname === "localhost" || people.hostname === "127.0.0.1", "Invalid indexer endpoint");
  pending.splice(0).forEach(resolve => resolve());
  for (let i = 0; i < 20 && !doc.body.textContent.includes("No people found"); i++) await settle();
  assert.ok(doc.body.textContent.includes("No people found"), "Shipped app could not render its indexer response");
  // Inspect the effective sponsor through the real Settings UI, not a replacement resolver.
  doc.querySelector('.desktop-nav a[href="/settings"]').click();
  for (let i = 0; i < 20 && !doc.body.textContent.includes("Network and endpoints"); i++) await settle();
  const hint = [...doc.querySelectorAll(".field")].find(field => field.querySelector("label")?.textContent.includes("Sponsors"))?.querySelector(".hint")?.textContent;
  assert.ok(hint && !hint.includes("none") && hint.includes("http"), "Release has no sponsor configured");
  assert.deepEqual(errors, [], "Shipped app encountered runtime errors");
  console.log(`web dist smoke passed: saved empty overrides resolve indexer ${people.origin}, nickname search reaches it, and Settings reports a sponsor`);
} finally {
  pending.splice(0).forEach(resolve => resolve());
  for (const id of timers) { clearTimeout(id); clearInterval(id); }
  dom.window.close();
}
