/**
 * Promise-based key/value access to a chrome.storage area, plus an in-memory implementation
 * for tests. Values are JSON-serializable objects.
 */
export interface KeyValueArea {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

type StorageAreaLike = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;

export function storageArea(area: StorageAreaLike): KeyValueArea {
  return {
    async get<T>(key: string) {
      const items = (await area.get(key)) as Record<string, unknown>;
      return items?.[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

export function memoryArea(): KeyValueArea & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

export function localArea(): KeyValueArea {
  return storageArea(chrome.storage.local);
}

export function sessionArea(): KeyValueArea {
  return storageArea(chrome.storage.session);
}
