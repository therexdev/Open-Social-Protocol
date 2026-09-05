/**
 * A minimal in-memory `chrome` for tests: runtime messaging, storage areas, alarms,
 * permissions, scripting registration, action badge, side panel and tabs.
 */
type AnyFn = (...args: never[]) => unknown;

class Evt<F extends AnyFn> {
  readonly listeners = new Set<F>();
  addListener = (fn: F) => {
    this.listeners.add(fn);
  };
  removeListener = (fn: F) => {
    this.listeners.delete(fn);
  };
  hasListener = (fn: F) => this.listeners.has(fn);
  hasListeners = () => this.listeners.size > 0;
  emit(...args: Parameters<F>): unknown[] {
    return [...this.listeners].map((fn) => fn(...args));
  }
}

export interface AreaMock {
  data: Map<string, unknown>;
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  setAccessLevel(options: { accessLevel: string }): Promise<void>;
  getBytesInUse(): Promise<number>;
}

function area(): AreaMock {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {};
      const list = keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      for (const key of list) if (data.has(key)) out[key] = structuredClone(data.get(key));
      return out;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) data.delete(key);
    },
    async clear() {
      data.clear();
    },
    async setAccessLevel() {},
    async getBytesInUse() {
      return JSON.stringify([...data.entries()]).length;
    },
  };
}

export interface ChromeMockOptions {
  id?: string;
  origins?: string[];
  permissions?: string[];
  tabs?: chrome.tabs.Tab[];
}

export function createChromeMock(options: ChromeMockOptions = {}) {
  const id = options.id ?? "osp-test-extension";
  const granted = { origins: new Set(options.origins ?? []), permissions: new Set(options.permissions ?? ["storage", "sidePanel", "scripting", "alarms", "activeTab"]) };
  const onMessage = new Evt<(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: unknown) => void) => unknown>();
  const registered = new Map<string, chrome.scripting.RegisteredContentScript>();
  const alarms = new Map<string, chrome.alarms.Alarm>();
  const badge = { text: "", color: "" };
  const tabs: chrome.tabs.Tab[] = options.tabs ?? [];

  const extensionSender = (path = "src/sidepanel/index.html"): chrome.runtime.MessageSender => ({ id, url: `chrome-extension://${id}/${path}`, origin: `chrome-extension://${id}` });

  async function dispatch(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    for (const listener of onMessage.listeners) {
      let resolveReply: (value: unknown) => void = () => undefined;
      const replied = new Promise<unknown>((resolve) => {
        resolveReply = resolve;
      });
      const result = listener(message, sender, resolveReply);
      if (result === true) return replied;
      if (result instanceof Promise) return result;
      if (result !== undefined) return result;
    }
    return undefined;
  }

  const mock = {
    runtime: {
      id,
      lastError: undefined as chrome.runtime.LastError | undefined,
      onMessage,
      onInstalled: new Evt<(details: unknown) => void>(),
      onStartup: new Evt<() => void>(),
      sendMessage: (message: unknown) => dispatch(message, extensionSender()),
      getURL: (path: string) => `chrome-extension://${id}/${path}`,
      openOptionsPage: async () => undefined,
    },
    storage: { local: area(), session: area(), onChanged: new Evt<(changes: unknown, areaName: string) => void>() },
    alarms: {
      create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, { name, scheduledTime: Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000, periodInMinutes: info.periodInMinutes });
      },
      clear: async (name: string) => alarms.delete(name),
      get: async (name: string) => alarms.get(name),
      getAll: async () => [...alarms.values()],
      onAlarm: new Evt<(alarm: chrome.alarms.Alarm) => void>(),
      _alarms: alarms,
    },
    permissions: {
      grantOnRequest: true,
      request: async (perms: chrome.permissions.Permissions) => {
        if (!mock.permissions.grantOnRequest) return false;
        for (const o of perms.origins ?? []) granted.origins.add(o);
        for (const p of perms.permissions ?? []) granted.permissions.add(p);
        mock.permissions.onAdded.emit(perms);
        return true;
      },
      remove: async (perms: chrome.permissions.Permissions) => {
        for (const o of perms.origins ?? []) granted.origins.delete(o);
        for (const p of perms.permissions ?? []) granted.permissions.delete(p);
        mock.permissions.onRemoved.emit(perms);
        return true;
      },
      contains: async (perms: chrome.permissions.Permissions) => (perms.origins ?? []).every((o) => granted.origins.has(o)) && (perms.permissions ?? []).every((p) => granted.permissions.has(p)),
      getAll: async () => ({ origins: [...granted.origins], permissions: [...granted.permissions] }),
      onAdded: new Evt<(perms: chrome.permissions.Permissions) => void>(),
      onRemoved: new Evt<(perms: chrome.permissions.Permissions) => void>(),
      _granted: granted,
    },
    scripting: {
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        for (const script of scripts) {
          if (registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
          registered.set(script.id, script);
        }
      },
      unregisterContentScripts: async (filter?: { ids?: string[] }) => {
        for (const scriptId of filter?.ids ?? [...registered.keys()]) registered.delete(scriptId);
      },
      getRegisteredContentScripts: async (filter?: { ids?: string[] }) => [...registered.values()].filter((s) => !filter?.ids || filter.ids.includes(s.id)),
      updateContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        for (const script of scripts) registered.set(script.id, { ...registered.get(script.id), ...script });
      },
      executeScript: async () => [],
      _registered: registered,
    },
    action: {
      setBadgeText: async (details: { text: string }) => {
        badge.text = details.text;
      },
      setBadgeBackgroundColor: async (details: { color: string }) => {
        badge.color = details.color;
      },
      setTitle: async () => undefined,
      onClicked: new Evt<(tab: chrome.tabs.Tab) => void>(),
      _badge: badge,
    },
    sidePanel: {
      _behavior: { openPanelOnActionClick: false },
      setPanelBehavior: async (behavior: { openPanelOnActionClick?: boolean }) => {
        mock.sidePanel._behavior = { openPanelOnActionClick: behavior.openPanelOnActionClick ?? false };
      },
      setOptions: async () => undefined,
      open: async () => undefined,
    },
    tabs: {
      _tabs: tabs,
      query: async () => tabs.filter((t) => t.active),
      get: async (tabId: number) => tabs.find((t) => t.id === tabId),
      create: async (props: { url?: string }) => {
        const tab = { id: tabs.length + 1, index: tabs.length, active: true, url: props.url } as chrome.tabs.Tab;
        tabs.push(tab);
        return tab;
      },
    },
    /** Delivers `message` to onMessage listeners as if it came from `sender`. */
    _dispatch: dispatch,
    /** A sender for an extension page. */
    _extensionSender: extensionSender,
    /** A sender for a content script in a tab. */
    _contentSender: (url: string, tabId = 7, extra: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender => ({
      id,
      url,
      origin: new URL(url).origin,
      frameId: 0,
      tab: { id: tabId, url, index: 0, active: true } as chrome.tabs.Tab,
      ...extra,
    }),
  };
  return mock;
}

export type ChromeMock = ReturnType<typeof createChromeMock>;

export function installChromeMock(options: ChromeMockOptions = {}): ChromeMock {
  const mock = createChromeMock(options);
  (globalThis as unknown as { chrome: unknown }).chrome = mock;
  return mock;
}
