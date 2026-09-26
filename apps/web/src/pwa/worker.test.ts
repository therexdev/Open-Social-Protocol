import workerSource from "../../scripts/service-worker.js?raw";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = workerSource.replace("__VERSION__", '"test"').replace("__FILES__", JSON.stringify(["/index.html", "/assets/app.js", "/manifest.webmanifest"]));
function worker(online = true, tabs = 1) {
  const handlers: Record<string, (event: any) => void> = {};
  const shell = { html: "offline app shell" };
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async (url: string) => url === "/index.html" ? shell : undefined) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["osp-shell-old", "osp-shell-test", "unrelated"]), delete: vi.fn(async () => true) };
  const self = { location: { origin: "https://opensocial.online" }, addEventListener: (name: string, fn: any) => { handlers[name] = fn; }, skipWaiting: vi.fn(), clients: { matchAll: vi.fn(async () => Array.from({ length: tabs }, () => ({}))), claim: vi.fn(async () => {}) } };
  const fetch = vi.fn(async () => { if (!online) throw new Error("offline"); return { ok: true }; });
  runInNewContext(source, { self, caches, fetch, URL, Request });
  return { handlers, self, caches, cache, fetch, shell };
}
describe("PWA privacy and update lifecycle", () => {
  it("never intercepts private APIs, writes, external content or unlisted assets", () => {
    const w = worker();
    for (const [path, method, mode] of [["/v1/feed", "GET", "cors"], ["/api/content", "GET", "navigate"], ["/rpc/read", "GET", "cors"], ["/assets/app.js", "POST", "cors"], ["https://storage.test/private", "GET", "cors"], ["/private-post.json", "GET", "cors"], ["/assets/app.js?key=secret", "GET", "cors"]]) {
      const respondWith = vi.fn();
      w.handlers.fetch!({ request: { url: new URL(path!, "https://opensocial.online").href, method, mode }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it("opens a deep link with the offline app shell when disconnected", async () => {
    const w = worker(false);
    let result: Promise<unknown> | undefined;
    w.handlers.fetch!({ request: { url: "https://opensocial.online/u/1abc", method: "GET", mode: "navigate" }, respondWith: (p: Promise<unknown>) => { result = p; } });
    expect(await result).toBe(w.shell);
  });
  it("waits for an explicit update request and preserves other open tabs' assets", async () => {
    const w = worker(true, 2);
    let done: Promise<unknown> | undefined;
    w.handlers.install!({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    w.handlers.message!({ data: { type: "ACTIVATE_UPDATE" } });
    expect(w.self.skipWaiting).toHaveBeenCalledOnce();
    w.handlers.activate!({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(w.caches.delete).not.toHaveBeenCalled();
    expect(w.self.clients.claim).toHaveBeenCalledOnce();
  });
  it("cleans up only this app's old caches when no other tabs need them", async () => {
    const w = worker();
    let done: Promise<unknown> | undefined;
    w.handlers.activate!({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(w.caches.delete.mock.calls).toEqual([["osp-shell-old"]]);
  });
});
