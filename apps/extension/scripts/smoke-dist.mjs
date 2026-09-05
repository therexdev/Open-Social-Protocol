// Boots the built service worker (dist/) under Node the way Chrome's MV3 CSP would run it:
// `Function()` and `eval` are disabled, the global scope looks like a worker (self, no window)
// and `chrome` is a small in-memory stub. Verifies module evaluation order (the no-eval protobuf
// runtime must install before any bundled dependency generates code), the bootstrap side effects
// (side panel bound to the action, alarms, badge) and the message router through the real bundle.
// Runs as the last step of `npm run build`; it needs dist/manifest.json.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (!existsSync(path.join(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found: run `vite build` first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// ---- manifest gates (docs/client-ux-principles.md, extension journey)
check(manifest.manifest_version === 3, "manifest_version must be 3");
check(manifest.background?.type === "module" && typeof manifest.background?.service_worker === "string", "background must be a module service worker");
check(existsSync(path.join(dist, manifest.background.service_worker)), "service worker file missing from dist");
check(typeof manifest.side_panel?.default_path === "string" && existsSync(path.join(dist, manifest.side_panel.default_path)), "side panel page missing");
check(typeof manifest.options_page === "string" && existsSync(path.join(dist, manifest.options_page)), "options page missing");
check(manifest.content_scripts === undefined, "no static content_scripts allowed");
check(JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "sidePanel", "scripting", "alarms", "activeTab"]), "unexpected permissions");
check(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(["https://www.facebook.com/*", "https://web.facebook.com/*"]), "unexpected optional_host_permissions");
check(manifest.host_permissions === undefined, "no host_permissions allowed (optional only)");
check(/script-src 'self'/.test(manifest.content_security_policy?.extension_pages ?? "") && !/unsafe-eval/.test(manifest.content_security_policy?.extension_pages ?? ""), "CSP must be script-src 'self' without unsafe-eval");
check(existsSync(path.join(dist, "content/facebook.js")), "dist/content/facebook.js missing");
const facebookScript = existsSync(path.join(dist, "content/facebook.js")) ? readFileSync(path.join(dist, "content/facebook.js"), "utf8") : "";
check(!/^\s*(import|export)\s/m.test(facebookScript), "content script must be a classic script (no import/export)");
check(facebookScript.includes("Also publish to Open Social Protocol"), "content script lost its label");
for (const file of Object.values(manifest.icons ?? {})) check(existsSync(path.join(dist, file)), `icon missing: ${file}`);

// ---- a worker-like global scope with eval disabled
const calls = [];
const evt = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, removeListener() {}, hasListener: () => false });
const area = () => {
  const m = new Map();
  return {
    async get(k) {
      const out = {};
      for (const key of typeof k === "string" ? [k] : (k ?? [...m.keys()])) if (m.has(key)) out[key] = structuredClone(m.get(key));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) m.set(k, structuredClone(v));
    },
    async remove(k) {
      for (const key of typeof k === "string" ? [k] : k) m.delete(key);
    },
    async setAccessLevel(o) {
      calls.push(["setAccessLevel", o.accessLevel]);
    },
  };
};
const chrome = {
  runtime: { id: "smokeextensionid", onMessage: evt(), onInstalled: evt(), onStartup: evt(), getURL: (p) => `chrome-extension://smokeextensionid/${p}` },
  storage: { local: area(), session: area(), onChanged: evt() },
  alarms: { create: async (name, info) => calls.push(["alarm", name, info.periodInMinutes]), clear: async () => true, get: async () => undefined, onAlarm: evt() },
  sidePanel: { setPanelBehavior: async (b) => calls.push(["setPanelBehavior", b.openPanelOnActionClick === true]) },
  permissions: { getAll: async () => ({ origins: [], permissions: [] }), contains: async () => false, remove: async () => true, onAdded: evt(), onRemoved: evt() },
  scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => undefined, unregisterContentScripts: async () => undefined },
  action: { setBadgeText: async (d) => calls.push(["badge", d.text]), setBadgeBackgroundColor: async () => undefined },
  tabs: { query: async () => [] },
};
globalThis.chrome = chrome;
globalThis.self = globalThis;
if ("window" in globalThis) delete globalThis.window;
const RealFunction = Function;
const forbidden = (what) =>
  function () {
    throw new EvalError(`${what} is not allowed under the MV3 CSP (script-src 'self')`);
  };
globalThis.Function = forbidden("Function()");
globalThis.Function.prototype = RealFunction.prototype;
globalThis.eval = forbidden("eval()");
process.on("unhandledRejection", (error) => {
  failures.push(`unhandled rejection in the service worker: ${error instanceof Error ? error.stack : String(error)}`);
});

try {
  await import(pathToFileURL(path.join(dist, manifest.background.service_worker)).href);
} catch (error) {
  failures.push(`service worker failed to load: ${error instanceof Error ? error.stack : String(error)}`);
}
await new Promise((resolve) => setTimeout(resolve, 250));

const listeners = chrome.runtime.onMessage.listeners;
check(listeners.length === 1, `expected one onMessage listener, got ${listeners.length}`);
check(calls.some((c) => c[0] === "setPanelBehavior" && c[1] === true), "action click must open the side panel (setPanelBehavior)");
check(calls.some((c) => c[0] === "alarm" && c[1] === "osp.autolock"), "auto-lock alarm not created");
check(calls.some((c) => c[0] === "alarm" && c[1] === "osp.sweep"), "sweep alarm not created");
check(calls.some((c) => c[0] === "setAccessLevel" && c[1] === "TRUSTED_CONTEXTS"), "session storage must be trusted-contexts only");

if (listeners.length === 1) {
  const send = (message, sender) =>
    new Promise((resolve) => {
      const r = listeners[0](message, sender, resolve);
      if (r !== true) resolve(r);
    });
  const page = { id: chrome.runtime.id, origin: `chrome-extension://${chrome.runtime.id}`, url: `chrome-extension://${chrome.runtime.id}/src/sidepanel/index.html` };
  const status = await send({ type: "vault.status" }, page);
  check(status?.ok === true && status.result?.status === "empty", `vault.status: ${JSON.stringify(status)}`);
  check(status?.ok === true && typeof status.result?.network?.deployed === "boolean", "vault.status must report the deployment state");
  const wrongSender = await send({ type: "vault.status" }, { ...page, id: "someone-else" });
  check(wrongSender?.ok === false && wrongSender.error?.code === "forbidden", `wrong sender must be refused: ${JSON.stringify(wrongSender)}`);
  const unknown = await send({ type: "nope" }, page);
  check(unknown?.ok === false && unknown.error?.code === "unknown_type", `unknown type must be refused: ${JSON.stringify(unknown)}`);
  const content = { id: chrome.runtime.id, origin: "https://www.facebook.com", url: "https://www.facebook.com/", frameId: 0, tab: { id: 3 } };
  const notGranted = await send({ type: "feed.request", payload: {} }, content);
  check(notGranted?.ok === false && notGranted.error?.code === "forbidden", `content script from a non-granted origin must be refused: ${JSON.stringify(notGranted)}`);
  const privileged = await send({ type: "vault.status" }, content);
  check(privileged?.ok === false && privileged.error?.code === "forbidden", "content scripts must not reach privileged types");
  const oversize = await send({ type: "vault.status", payload: { blob: "x".repeat(40 * 1024) } }, page);
  check(oversize?.ok === false && oversize.error?.code === "too_large", "oversize messages must be refused");
  // vault + orchestrator through the bundle (scrypt, XChaCha20-Poly1305, idempotency keys): no code generation anywhere
  const created = await send({ type: "vault.create", payload: { passphrase: "correct horse battery" } }, page);
  check(created?.ok === true && typeof created.result?.account === "string", `vault.create: ${JSON.stringify(created)}`);
  const draft = await send({ type: "crosspost.create", payload: { text: "smoke", audience: 0, adapter: "sidepanel" } }, page);
  check(draft?.ok === true && draft.result?.record?.state === "draft", `crosspost.create: ${JSON.stringify(draft)}`);
  const locked = await send({ type: "vault.lock" }, page);
  check(locked?.ok === true, "vault.lock");
  const after = await send({ type: "vault.status" }, page);
  check(after?.ok === true && after.result?.status === "locked", `vault should be locked: ${JSON.stringify(after)}`);
}

if (failures.length > 0) {
  console.error("dist smoke test FAILED:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`dist smoke test passed (${manifest.name} ${manifest.version}: worker booted with eval disabled, side panel bound to the action, router enforces sender/origin/type/size)`);
process.exit(0);
