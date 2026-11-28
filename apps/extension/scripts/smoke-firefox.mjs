// Boot the actual Firefox bundle with a promise-only browser API and a Firefox UUID.
// Account operations must work even without Chrome's sidePanel or storage.session.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const dist = new URL('../dist-firefox/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dist), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, undefined);
assert.equal(manifest.side_panel, undefined);
assert.equal(manifest.browser_specific_settings.gecko_android.strict_min_version, '142.0');
assert.equal(manifest.permissions.includes('sidePanel'), false);
assert.ok(manifest.optional_host_permissions.includes('https://m.facebook.com/*'));
assert.ok(manifest.optional_host_permissions.includes('https://x.com/*'));
assert.ok(manifest.host_permissions.includes('https://api.opensocial.online/*'));
for (const file of ['background.js', 'src/sidepanel/index.html', 'src/embed/index.html', 'content/facebook.js', 'content/x.js']) assert.ok(existsSync(new URL(file, dist)), file);
const evt = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, removeListener() {} });
const area = () => { const values = new Map(); return {
  async get(key) { return { [key]: values.get(key) }; },
  async set(items) { for (const [k,v] of Object.entries(items)) values.set(k,v); },
  async remove(key) { values.delete(key); },
}; };
const id = 'opensocial@opensocial.online', uuid = '03cbdf69-8765-4321-9ab1-012345678901';
const tabs = [], alarms = [];
const browser = {
  runtime: { id, getURL: p => `moz-extension://${uuid}/${p}`, onMessage: evt(), onInstalled: evt(), onStartup: evt() },
  storage: { local: area(), onChanged: evt() },
  action: { onClicked: evt(), async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  alarms: { async create(name) { alarms.push(name); }, onAlarm: evt() },
  permissions: { async getAll() { return { origins: [] }; }, async contains() { return false; }, onAdded: evt(), onRemoved: evt() },
  scripting: { async getRegisteredContentScripts() { return []; } },
  tabs: { async query() { return tabs; }, async create(tab) { tabs.push({ id: 1, ...tab }); }, async update(id, patch) { Object.assign(tabs.find(tab => tab.id === id), patch); }, async sendMessage() {} },
};
const context = vm.createContext({ browser, crypto: globalThis.crypto, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
  URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, structuredClone, queueMicrotask,
  fetch: () => { throw Error('Smoke must not contact the network'); } }, { codeGeneration: { strings: false, wasm: false } });
context.self = context;
vm.runInContext(readFileSync(new URL('background.js', dist), 'utf8'), context);
await new Promise(resolve => setTimeout(resolve, 200));
assert.ok(alarms.includes('osp.autolock'));
assert.ok(alarms.includes('osp.sweep'));
assert.equal(browser.runtime.onMessage.listeners.length, 1);
assert.equal(browser.action.onClicked.listeners.length, 1);
browser.action.onClicked.listeners[0]({});
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(tabs[0]?.url, `moz-extension://${uuid}/src/sidepanel/index.html`);
browser.action.onClicked.listeners[0]({});
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(tabs.length, 1, 'Reuse the existing client tab');
const send = (message, sender) => new Promise(resolve => browser.runtime.onMessage.listeners[0](message, sender, resolve));
const page = { id, url: browser.runtime.getURL('src/sidepanel/index.html') };
assert.equal((await send({ type: 'vault.status' }, page)).result.status, 'empty');
assert.equal((await send({ type: 'settings.get' }, page)).result.resolved.network, 'mainnet');
assert.equal((await send({ type: 'vault.status' }, { ...page, url: 'moz-extension://another-addon/src/sidepanel/index.html' })).ok, false);
assert.equal((await send({ type: 'vault.status' }, { ...page, url: 'https://m.facebook.com/', tab: { id: 2 }, frameId: 0 })).ok, false);
console.log('Firefox smoke passed: actual event-page bundle, promise-only API, installation UUID routing, toolbar tab and memory-only session fallback');
