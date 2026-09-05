import { describe, expect, it } from "vitest";
import { createChromeMock } from "../test/chromeMock";
import { FACEBOOK_SCRIPT_ID, adapterApi } from "./adapters";

const settings = (facebookAdapter: boolean) => ({ facebookAdapter, feedInsertion: false });
const later = <T>(value: T, ms = 20) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("adapter registration is serialized", () => {
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
