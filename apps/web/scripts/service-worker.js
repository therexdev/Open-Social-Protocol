/* Generated with an exact static asset list. No API responses, posts, media, or keys are cached. */
const CACHE = 'osp-shell-' + __VERSION__;
const FILES = __FILES__;
const PATHS = new Set(FILES);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(path => new Request(new URL(path, self.location.origin), { cache: 'reload', credentials: 'omit' })))));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Keep old shells while other tabs can still be running them.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length <= 1) for (const key of await caches.keys()) {
      if (key.startsWith('osp-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Explicitly exclude backend paths even if someone configures a same-origin proxy.
  if (/^\/(?:v\d+|api|rpc)\//.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
    return;
  }
  if (url.search || !PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(url.pathname)) || fetch(request);
  })());
});
