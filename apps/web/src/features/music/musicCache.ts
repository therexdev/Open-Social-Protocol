import { MUSIC_MAX_BYTES } from "@osp/sdk";
import { defaultStorage, type KeyValueStorage } from "../../vault/storage";

const INDEX = "osp.web.music-cache.v1.index";
const PREFIX = "osp.web.music-cache.v1.bytes:";
export const MUSIC_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
type Index = Record<string, { size: number; used: number }>;

/** Stores verified chain bytes only. Restricted tracks stay encrypted; no reading keys
 * or decoded audio enter this cache. Failures never prevent network playback. */
export function createMusicCache(storage: KeyValueStorage, capacity = MUSIC_CACHE_BYTES, now = Date.now) {
  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T>(work: () => Promise<T>): Promise<T> => {
    const task = queue.catch(() => undefined).then(async () =>
      typeof navigator !== "undefined" && navigator.locks?.request
        ? await navigator.locks.request("osp:music-cache", work)
        : await work()
    );
    queue = task;
    return task;
  };
  const readIndex = async (): Promise<Index> => {
    const value = await storage.get<Index>(INDEX);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, entry]) =>
      entry && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= MUSIC_MAX_BYTES && Number.isFinite(entry.used)
    ));
  };
  return {
    async get(key: string): Promise<Uint8Array | undefined> {
      try {
        return await locked(async () => {
          const index = await readIndex(), entry = index[key];
          if (!entry) return;
          const bytes = await storage.get<Uint8Array>(PREFIX + key);
          if (now() - entry.used > MAX_AGE || !(bytes instanceof Uint8Array) || bytes.length !== entry.size) {
            await storage.del(PREFIX + key);
            delete index[key];
            await storage.set(INDEX, index);
            return;
          }
          entry.used = now();
          await storage.set(INDEX, index);
          return bytes.slice();
        });
      } catch { return undefined; }
    },
    async put(key: string, bytes: Uint8Array): Promise<void> {
      if (!bytes.length || bytes.length > Math.min(capacity, MUSIC_MAX_BYTES)) return;
      const copy = bytes.slice();
      try {
        await locked(async () => {
          const index = await readIndex();
          let total = Object.values(index).reduce((n, entry) => n + entry.size, 0) - (index[key]?.size ?? 0);
          for (const [oldKey, entry] of Object.entries(index).sort((a, b) => a[1].used - b[1].used)) {
            if (oldKey === key) continue;
            if (now() - entry.used > MAX_AGE || total + copy.length > capacity) {
              await storage.del(PREFIX + oldKey);
              total -= entry.size;
              delete index[oldKey];
            }
          }
          index[key] = { size: copy.length, used: now() };
          // Register before writing bytes so a failed index write cannot orphan a large blob.
          await storage.set(INDEX, index);
          await storage.set(PREFIX + key, copy);
        });
      } catch { /* Offline/quota/private-mode storage failures are optional cache misses. */ }
    },
    async remove(key: string): Promise<void> {
      try {
        await locked(async () => {
          const index = await readIndex();
          await storage.del(PREFIX + key);
          delete index[key];
          await storage.set(INDEX, index);
        });
      } catch { /* The next read also verifies cached bytes. */ }
    },
    async clear(): Promise<void> {
      await locked(async () => {
        const index = await readIndex();
        for (const key of Object.keys(index)) await storage.del(PREFIX + key);
        await storage.del(INDEX);
      });
    },
  };
}

let cache: ReturnType<typeof createMusicCache> | undefined;
export function musicCache() {
  // No persistent cache in environments without IndexedDB (including node tests).
  if (typeof indexedDB === "undefined") return undefined;
  return cache ??= createMusicCache(defaultStorage());
}
export async function clearMusicCache() { await musicCache()?.clear(); }
