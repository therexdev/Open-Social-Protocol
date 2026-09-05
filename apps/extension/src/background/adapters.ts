/**
 * Host adapters are registered at runtime (no static content scripts): the Facebook adapter is
 * registered with chrome.scripting.registerContentScripts only while the optional host
 * permission is granted and the user enabled it in the options page. Disabling unregisters the
 * script and drops the permission.
 */
import { FACEBOOK_ORIGINS } from "../shared/config";
import type { AdapterStatusView } from "../shared/protocol";
import type { Settings } from "../shared/settings";

export const FACEBOOK_SCRIPT_ID = "osp-facebook-adapter";
export const FACEBOOK_SCRIPT_FILE = "content/facebook.js";

type ChromeLike = Pick<typeof chrome, "permissions" | "scripting">;

export function adapterApi(api: ChromeLike = chrome) {
  async function facebookGranted(): Promise<boolean> {
    try {
      return await api.permissions.contains({ origins: FACEBOOK_ORIGINS });
    } catch {
      return false;
    }
  }

  async function facebookRegistered(): Promise<boolean> {
    try {
      const scripts = await api.scripting.getRegisteredContentScripts({ ids: [FACEBOOK_SCRIPT_ID] });
      return scripts.some((s) => s.id === FACEBOOK_SCRIPT_ID);
    } catch {
      return false;
    }
  }

  async function registerFacebook(): Promise<void> {
    if (await facebookRegistered()) return;
    await api.scripting.registerContentScripts([
      {
        id: FACEBOOK_SCRIPT_ID,
        js: [FACEBOOK_SCRIPT_FILE],
        matches: FACEBOOK_ORIGINS,
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

  /** Registers when wanted + granted; unregisters otherwise. Returns the resulting status. */
  async function sync(settings: Pick<Settings, "facebookAdapter" | "feedInsertion">): Promise<AdapterStatusView> {
    const granted = await facebookGranted();
    if (settings.facebookAdapter && granted) await registerFacebook();
    else await unregisterFacebook();
    return { facebook: { wanted: settings.facebookAdapter, granted, registered: await facebookRegistered() }, feedInsertion: settings.feedInsertion };
  }

  async function disableFacebook(): Promise<void> {
    await unregisterFacebook();
    try {
      await api.permissions.remove({ origins: FACEBOOK_ORIGINS });
    } catch {
      // the permission may already be gone
    }
  }

  async function status(settings: Pick<Settings, "facebookAdapter" | "feedInsertion">): Promise<AdapterStatusView> {
    return { facebook: { wanted: settings.facebookAdapter, granted: await facebookGranted(), registered: await facebookRegistered() }, feedInsertion: settings.feedInsertion };
  }

  return { facebookGranted, facebookRegistered, registerFacebook, unregisterFacebook, sync, disableFacebook, status };
}
