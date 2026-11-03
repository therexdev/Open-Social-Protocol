import { MUSIC_MAX_BYTES, MUSIC_CHUNK_BYTES, toBase64url, type ProtocolClient } from "@osp/sdk";
import { defaultStorage, type KeyValueStorage } from "../../vault/storage";

const INDEX = "osp.web.music-cache.v1.index";
const PREFIX = "osp.web.music-cache.v1.bytes:";
export const MUSIC_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
type Index = Record<string, { size: number; used: number }>;
const partPrefix = (key: string) => `${key}:part:`;
export const musicCacheKey = (client: ProtocolClient, id: Uint8Array, digest: Uint8Array) =>
  JSON.stringify([client.chainId, client.deployment.contracts.publications.address, toBase64url(id), toBase64url(digest)]);

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
  const getEntries = async (keys: string[]) => locked(async () => {
    const index = await readIndex(), found = new Map<string, Uint8Array>();
    for (const key of keys) {
      const entry = index[key];
      if (!entry) continue;
      const bytes = await storage.get<Uint8Array>(PREFIX + key);
      if (now() - entry.used > MAX_AGE || !(bytes instanceof Uint8Array) || bytes.length !== entry.size) {
        await storage.del(PREFIX + key);
        delete index[key];
      } else {
        entry.used = now();
        found.set(key, bytes.slice());
      }
    }
    await storage.set(INDEX, index);
    return found;
  });
  const putEntries = async (entries: Array<[string, Uint8Array]>, completed?: string) => locked(async () => {
    const index = await readIndex();
    if (completed) {
      for (const key of Object.keys(index).filter(key => key.startsWith(partPrefix(completed)))) {
        await storage.del(PREFIX + key);
        delete index[key];
      }
    }
    for (const [key, bytes] of entries) {
      if (!bytes.length || bytes.length > Math.min(capacity, MUSIC_MAX_BYTES)) continue;
      let total = Object.values(index).reduce((n, entry) => n + entry.size, 0) - (index[key]?.size ?? 0);
      for (const [oldKey, entry] of Object.entries(index).sort((a, b) => a[1].used - b[1].used)) {
        if (oldKey !== key && (now() - entry.used > MAX_AGE || total + bytes.length > capacity)) {
          await storage.del(PREFIX + oldKey);
          total -= entry.size;
          delete index[oldKey];
        }
      }
      index[key] = { size: bytes.length, used: now() };
      // Register first: a failed index write cannot orphan a large blob.
      await storage.set(INDEX, index);
      await storage.set(PREFIX + key, bytes);
    }
  });
  return {
    async get(key: string): Promise<Uint8Array | undefined> {
      try {
        return (await getEntries([key])).get(key);
      } catch { return undefined; }
    },
    async put(key: string, bytes: Uint8Array): Promise<void> {
      if (!bytes.length || bytes.length > Math.min(capacity, MUSIC_MAX_BYTES)) return;
      const copy = bytes.slice();
      try {
        await putEntries([[key, copy]], key);
      } catch { /* Offline/quota/private-mode storage failures are optional cache misses. */ }
    },
    async getPartial(key: string, count: number): Promise<Map<number, Uint8Array>> {
      if (!Number.isInteger(count) || count < 1 || count > Math.ceil(MUSIC_MAX_BYTES / MUSIC_CHUNK_BYTES)) return new Map();
      try {
        const found = await getEntries(Array.from({ length: count }, (_, i) => partPrefix(key) + i));
        return new Map([...found].map(([k, v]) => [Number(k.slice(partPrefix(key).length)), v]));
      } catch { return new Map(); }
    },
    async putPartial(key: string, start: number, chunks: Uint8Array[]): Promise<void> {
      if (!Number.isInteger(start) || start < 0 || start + chunks.length > Math.ceil(MUSIC_MAX_BYTES / MUSIC_CHUNK_BYTES) || chunks.some(c => !c.length || c.length > MUSIC_CHUNK_BYTES)) return;
      try { await putEntries(chunks.map((chunk, i) => [partPrefix(key) + (start + i), chunk.slice()])); }
      catch { /* A missing partial cache only costs another network read. */ }
    },
    async remove(key: string): Promise<void> {
      try {
        await locked(async () => {
          const index = await readIndex();
          for (const match of Object.keys(index).filter(k => k === key || k.startsWith(partPrefix(key)))) {
            await storage.del(PREFIX + match);
            delete index[match];
          }
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
