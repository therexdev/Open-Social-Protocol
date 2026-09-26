import { describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../test/chromeMock";
import { FACEBOOK_SCRIPT_FILE, FACEBOOK_SCRIPT_ID, adapterApi } from "./adapters";
import { createTestBackground } from "../test/support";

const settings = (facebookAdapter: boolean) => ({ facebookAdapter, feedInsertion: false });
const later = <T>(value: T, ms = 20) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

it("exposes only the attribution preference to granted host scripts and persists changes through settings", async () => {
  const t = createTestBackground({ origins: ["https://www.facebook.com/*"] });
  await t.call("settings.update", { patch: { facebookAdapter: true } });
  const sender = t.chrome._contentSender("https://www.facebook.com/");
  const message = { type: "adapter.preferences" };
  expect(await t.background.router.handle(message, sender)).toEqual({ ok: true, result: { facebookAttribution: true } });
  await t.call("settings.update", { patch: { facebookAttribution: false } });
  expect(await t.background.router.handle(message, sender)).toEqual({ ok: true, result: { facebookAttribution: false } });
  expect(await t.background.router.handle(message, t.chrome._contentSender("https://evil.test/"))).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(await t.background.router.handle({ type: "settings.get" }, sender)).toMatchObject({ ok: false, error: { code: "forbidden" } });
});

describe("adapter registration is serialized", () => {
  it("attaches to existing active and inactive granted tabs, tolerates closed tabs and refreshes on feed changes", async () => {
    const chrome = createChromeMock({ origins: ["https://www.facebook.com/*"], tabs: [
      { id: 1, url: "https://www.facebook.com/", active: true },
      { id: 2, url: "https://www.facebook.com/groups/42", active: false },
      { id: 3, url: "https://web.facebook.com/", active: false },
      { id: 4, url: "https://example.org/", active: false },
    ] as chrome.tabs.Tab[] });
    const inject = vi.spyOn(chrome.scripting, "executeScript").mockRejectedValueOnce(new Error("Tab closed"));
    const adapters = adapterApi(chrome as never);
    const enabled = await adapters.sync(settings(true));
    expect(enabled.facebook.attachmentWarning).toContain("1 open Facebook tab");
    expect(inject.mock.calls.map(([arg]) => arg.target.tabId)).toEqual([1, 2]);
    expect(inject.mock.calls[1]![0]).toEqual({ target: { tabId: 2, frameIds: [0] }, files: [FACEBOOK_SCRIPT_FILE], world: "ISOLATED" });
    const refreshed = await adapters.sync({ facebookAdapter: true, feedInsertion: true });
    expect(refreshed.facebook.attachmentWarning).toBeUndefined();
    expect(inject.mock.calls.map(([arg]) => arg.target.tabId)).toEqual([1, 2, 1, 2]);
    expect(chrome.scripting._registered.size).toBe(1);
  });

  it("stops injected scripts on disable and partial permission removal, even without readable tab URLs", async () => {
    const chrome = createChromeMock({ origins: ["https://www.facebook.com/*", "https://web.facebook.com/*"], tabs: [
      { id: 1, active: true }, { id: 2, active: false },
    ] as chrome.tabs.Tab[] });
    const send = vi.spyOn(chrome.tabs, "sendMessage");
    const adapters = adapterApi(chrome as never);
    await adapters.sync(settings(true));
    chrome.permissions._granted.origins.delete("https://web.facebook.com/*");
    await adapters.sync(settings(true));
    expect(send).toHaveBeenCalledWith(2, { type: "osp.facebook.stop", origins: ["https://web.facebook.com/*"] }, { frameId: 0 });
    await adapters.disableFacebook();
    expect(send).toHaveBeenCalledWith(1, { type: "osp.facebook.stop", origins: ["https://www.facebook.com/*", "https://web.facebook.com/*"] }, { frameId: 0 });
  });

  it("a sync that started earlier with stale settings cannot undo a later enable", async () => {
    const chrome = createChromeMock({ origins: ["https://www.facebook.com/*"] });
    const adapters = adapterApi(chrome as never);
    // permissions.onAdded fires first and reads settings slowly (still "disabled"); adapter.enable follows with the saved settings
    const stale = adapters.sync(() => later(settings(false)));
    const enable = adapters.sync(settings(true));
    const [first, second] = await Promise.all([stale, enable]);
    expect(first.facebook.registered).toBe(false);
    expect(second.facebook.registered).toBe(true);
    expect(chrome.scripting._registered.has(FACEBOOK_SCRIPT_ID)).toBe(true);
    expect(await adapters.facebookRegistered()).toBe(true);
  });

  it("loaders run inside the chain, after the syncs queued before them", async () => {
    const chrome = createChromeMock({ origins: ["https://www.facebook.com/*"] });
    const adapters = adapterApi(chrome as never);
    let stored = settings(true);
    const order: string[] = [];
    const enable = adapters.sync(async () => {
      order.push("enable");
      return later(stored);
    });
    stored = settings(false);
    const disable = adapters.sync(async () => {
      order.push("disable");
      return stored;
    });
    await Promise.all([enable, disable]);
    expect(order).toEqual(["enable", "disable"]);
    expect(chrome.scripting._registered.has(FACEBOOK_SCRIPT_ID)).toBe(false);
  });

  it("disableFacebook is serialized with syncs and drops the permission", async () => {
    const chrome = createChromeMock({ origins: ["https://www.facebook.com/*", "https://web.facebook.com/*"] });
    const adapters = adapterApi(chrome as never);
    await adapters.sync(settings(true));
    const registered = chrome.scripting._registered.get(FACEBOOK_SCRIPT_ID);
    expect(registered?.matches).toEqual(["https://www.facebook.com/*", "https://web.facebook.com/*"]);
    const sync = adapters.sync(() => later(settings(true)));
    const disable = adapters.disableFacebook();
    await Promise.all([sync, disable]);
    expect(chrome.scripting._registered.size).toBe(0);
    expect((await chrome.permissions.getAll()).origins).toEqual([]);
  });
});
