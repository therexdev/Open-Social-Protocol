/**
 * Asynchronous key-value storage for the vault and encrypted caches: IndexedDB through
 * idb-keyval in the browser, an in-memory map in tests.
 */
import { createStore, del, get, set, type UseStore } from "idb-keyval";

export interface KeyValueStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

let idbStore: UseStore | undefined;

function store(): UseStore {
  if (!idbStore) idbStore = createStore("osp-web", "vault");
  return idbStore;
}

export const idbStorage: KeyValueStorage = {
  get: <T>(key: string) => get<T>(key, store()),
  set: (key, value) => set(key, value, store()),
  del: (key) => del(key, store()),
};

export function memoryStorage(): KeyValueStorage & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    del: async (key) => {
      map.delete(key);
    },
  };
}

/** IndexedDB when the browser provides it, otherwise memory (still works, nothing persists). */
export function defaultStorage(): KeyValueStorage {
  return typeof indexedDB === "undefined" ? memoryStorage() : idbStorage;
}
