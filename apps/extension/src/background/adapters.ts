/** Optional host adapters. One queue serializes registration, revocation and refresh so
 * overlapping permission/settings events cannot restore a stale registration. */
import { FACEBOOK_ORIGINS, X_ORIGINS, type FeedHost } from "../shared/hosts";
import type { AdapterStatusView } from "../shared/protocol";
import type { Settings } from "../shared/settings";

export const FACEBOOK_SCRIPT_ID = "osp-facebook-adapter";
export const FACEBOOK_SCRIPT_FILE = "content/facebook.js";
export const X_SCRIPT_ID = "osp-x-adapter";
export const X_SCRIPT_FILE = "content/x.js";
const sites = {
  facebook: { origins: FACEBOOK_ORIGINS, id: FACEBOOK_SCRIPT_ID, file: FACEBOOK_SCRIPT_FILE, label: "Facebook" },
  x: { origins: X_ORIGINS, id: X_SCRIPT_ID, file: X_SCRIPT_FILE, label: "X" },
};
type ChromeLike = Pick<typeof chrome, "permissions" | "scripting" | "tabs">;
type AdapterSettings = Pick<Settings, "facebookAdapter" | "feedInsertion"> & Partial<Pick<Settings, "xAdapter" | "xFeedInsertion">>;
export type AdapterSettingsSource = AdapterSettings | (() => Promise<AdapterSettings>);

export function adapterApi(api: ChromeLike = chrome) {
  let chain: Promise<unknown> = Promise.resolve();
  const warnings: Partial<Record<FeedHost, string>> = {};
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn); chain = next.catch(() => undefined); return next;
  }
  async function grantedOrigins(host: FeedHost): Promise<string[]> {
    const granted: string[] = [];
    for (const origin of sites[host].origins) {
      try { if (await api.permissions.contains({ origins: [origin] })) granted.push(origin); } catch { /* not granted */ }
    }
    return granted;
  }
  async function registered(host: FeedHost) {
    try { return (await api.scripting.getRegisteredContentScripts({ ids: [sites[host].id] })).find(s => s.id === sites[host].id); }
    catch { return undefined; }
  }
  async function stopOpenTabs(host: FeedHost, origins = sites[host].origins) {
    // After revocation URLs can be hidden; deliver to all top frames, whose handlers validate the origin.
    const tabs = await api.tabs.query({});
    await Promise.allSettled(tabs.filter(t => t.id !== undefined).map(t => api.tabs.sendMessage(t.id!, { type: `osp.${host}.stop`, origins }, { frameId: 0 })));
  }
  async function refreshOpenTabs(host: FeedHost, matches: string[]) {
    const tabs = await api.tabs.query({ url: matches });
    const results = await Promise.allSettled(tabs.filter(t => t.id !== undefined).map(t => api.scripting.executeScript({
      target: { tabId: t.id!, frameIds: [0] }, files: [sites[host].file], world: "ISOLATED",
    })));
    const failed = results.filter(r => r.status === "rejected").length;
    warnings[host] = failed ? `Could not attach to ${failed} open ${sites[host].label} tab${failed === 1 ? "" : "s"}. Reload those pages to activate Open Social.` : undefined;
  }
  async function register(host: FeedHost) {
    const matches = await grantedOrigins(host);
    if (!matches.length) throw Error(`Grant the ${sites[host].label} host permission first.`);
    const existing = await registered(host);
    if (existing) {
      if (existing.matches?.length === matches.length && matches.every(m => existing.matches?.includes(m))) return;
      await api.scripting.unregisterContentScripts({ ids: [sites[host].id] });
    }
    await api.scripting.registerContentScripts([{ id: sites[host].id, js: [sites[host].file], matches,
      runAt: "document_idle", world: "ISOLATED", persistAcrossSessions: true, allFrames: false }]);
  }
  async function unregister(host: FeedHost) {
    if (await registered(host)) await api.scripting.unregisterContentScripts({ ids: [sites[host].id] });
  }
  async function status(settings: AdapterSettings): Promise<AdapterStatusView> {
    const state = async (host: FeedHost, wanted: boolean) => ({ wanted, granted: (await grantedOrigins(host)).length > 0,
      registered: !!await registered(host), attachmentWarning: warnings[host] });
    return { facebook: await state("facebook", settings.facebookAdapter), x: await state("x", (settings.xAdapter ?? settings.xFeedInsertion) === true), feedInsertion: settings.feedInsertion };
  }
  function sync(source: AdapterSettingsSource): Promise<AdapterStatusView> {
    return serialized(async () => {
      const settings = typeof source === "function" ? await source() : source;
      for (const host of ["facebook", "x"] as const) {
        const matches = await grantedOrigins(host), wanted = host === "facebook" ? settings.facebookAdapter : settings.xAdapter ?? settings.xFeedInsertion;
        if (wanted && matches.length) {
          await register(host);
          const revoked = sites[host].origins.filter(o => !matches.includes(o));
          if (revoked.length) await stopOpenTabs(host, revoked);
          await refreshOpenTabs(host, matches);
        } else { warnings[host] = undefined; await unregister(host); await stopOpenTabs(host); }
      }
      return status(settings);
    });
  }
  function disable(host: FeedHost): Promise<void> {
    return serialized(async () => {
      await unregister(host); await stopOpenTabs(host); warnings[host] = undefined;
      try { await api.permissions.remove({ origins: sites[host].origins }); } catch { /* already revoked */ }
    });
  }
  return { sync, status, disable,
    facebookGranted: async () => (await grantedOrigins("facebook")).length > 0,
    facebookGrantedOrigins: () => grantedOrigins("facebook"),
    facebookRegistered: async () => !!await registered("facebook"),
    registerFacebook: () => register("facebook"), unregisterFacebook: () => unregister("facebook"), disableFacebook: () => disable("facebook"),
    xGranted: async () => (await grantedOrigins("x")).length > 0,
  };
}
