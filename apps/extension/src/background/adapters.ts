/**
 * Host adapters are registered at runtime (no static content scripts): the Facebook adapter is
 * registered with chrome.scripting.registerContentScripts only while the optional host
 * permission is granted and the user enabled it in the options page. Disabling unregisters the
 * script and drops the permission.
 *
 * Every registration change runs through one promise chain: `permissions.onAdded` / `onRemoved`
 * and the options page's enable/disable can fire together, and an unserialized pair of syncs
 * could read stale settings, then unregister a script the other sync had just registered.
 * Callers pass a settings *loader* so the settings are re-read inside the chain, after any
 * save that was queued before.
 */
import { FACEBOOK_ORIGINS } from "../shared/config";
import type { AdapterStatusView } from "../shared/protocol";
import type { Settings } from "../shared/settings";

export const FACEBOOK_SCRIPT_ID = "osp-facebook-adapter";
export const FACEBOOK_SCRIPT_FILE = "content/facebook.js";

type ChromeLike = Pick<typeof chrome, "permissions" | "scripting">;
type AdapterSettings = Pick<Settings, "facebookAdapter" | "feedInsertion">;
export type AdapterSettingsSource = AdapterSettings | (() => Promise<AdapterSettings>);

export function adapterApi(api: ChromeLike = chrome) {
  let chain: Promise<unknown> = Promise.resolve();

  /** Serializes registration changes so concurrent syncs cannot interleave. */
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  }

  /** The Facebook host patterns the user currently grants (chrome://extensions lets them revoke one site at a time). */
  async function facebookGrantedOrigins(): Promise<string[]> {
    const granted: string[] = [];
    for (const origin of FACEBOOK_ORIGINS) {
      try {
        if (await api.permissions.contains({ origins: [origin] })) granted.push(origin);
      } catch {
        // treated as not granted
      }
    }
    return granted;
  }

  async function facebookGranted(): Promise<boolean> {
    return (await facebookGrantedOrigins()).length > 0;
  }

  async function registeredFacebookScript(): Promise<chrome.scripting.RegisteredContentScript | undefined> {
    try {
      const scripts = await api.scripting.getRegisteredContentScripts({ ids: [FACEBOOK_SCRIPT_ID] });
      return scripts.find((s) => s.id === FACEBOOK_SCRIPT_ID);
    } catch {
      return undefined;
    }
  }

  async function facebookRegistered(): Promise<boolean> {
    return (await registeredFacebookScript()) !== undefined;
  }

  /** Registers the adapter for exactly the granted Facebook origins (re-registers when the set changed). */
  async function registerFacebook(): Promise<void> {
    const matches = await facebookGrantedOrigins();
    if (matches.length === 0) throw new Error("Grant the Facebook host permission first.");
    const existing = await registeredFacebookScript();
    if (existing) {
      const same = existing.matches?.length === matches.length && matches.every((m) => existing.matches?.includes(m));
      if (same) return;
      await api.scripting.unregisterContentScripts({ ids: [FACEBOOK_SCRIPT_ID] });
    }
    await api.scripting.registerContentScripts([
      {
        id: FACEBOOK_SCRIPT_ID,
        js: [FACEBOOK_SCRIPT_FILE],
        matches,
        runAt: "document_idle",
        world: "ISOLATED",
        persistAcrossSessions: true,
        allFrames: false,
      },
    ]);
  }

  async function unregisterFacebook(): Promise<void> {
    if (!(await facebookRegistered())) return;
    await api.scripting.unregisterContentScripts({ ids: [FACEBOOK_SCRIPT_ID] });
  }

  /** Registers when wanted + granted; unregisters otherwise. Serialized; the settings are read inside the chain. */
  function sync(source: AdapterSettingsSource): Promise<AdapterStatusView> {
    return serialized(async () => {
      const settings = typeof source === "function" ? await source() : source;
      const granted = await facebookGranted();
      if (settings.facebookAdapter && granted) await registerFacebook();
      else await unregisterFacebook();
      return { facebook: { wanted: settings.facebookAdapter, granted, registered: await facebookRegistered() }, feedInsertion: settings.feedInsertion };
    });
  }

  /** Unregisters the adapter and drops the host permission (serialized with the syncs). */
  function disableFacebook(): Promise<void> {
    return serialized(async () => {
      await unregisterFacebook();
      try {
        await api.permissions.remove({ origins: FACEBOOK_ORIGINS });
      } catch {
        // the permission may already be gone
      }
    });
  }

  async function status(settings: AdapterSettings): Promise<AdapterStatusView> {
    return { facebook: { wanted: settings.facebookAdapter, granted: await facebookGranted(), registered: await facebookRegistered() }, feedInsertion: settings.feedInsertion };
  }

  return { facebookGranted, facebookGrantedOrigins, facebookRegistered, registerFacebook, unregisterFacebook, sync, disableFacebook, status };
}
