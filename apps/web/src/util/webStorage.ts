/** A minimal synchronous string storage (localStorage or an in-memory stand-in for tests). */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStringStorage(): StringStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** window.localStorage when usable (private mode and sandboxes may throw), else memory. */
export function safeLocalStorage(): StringStorage {
  try {
    const probe = "__osp_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryStringStorage();
  }
}
