import { startAutoLock, useVault } from "../../../web/src/vault/store";
import { startSettingsSync, useSettings, SETTINGS_KEY } from "../../../web/src/stores/settings";
import type { SettingsView } from "../shared/protocol";
import { rpc } from "../shared/rpc";

/** Keep the prior extension-local encrypted vault/history. No website storage or app is accessed. */
export async function startExtensionRuntime() {
  if (!localStorage.getItem(SETTINGS_KEY)) {
    try {
      const {settings}=await rpc<SettingsView>("settings.get");
      const {network,rpcUrls,indexerUrl,sponsorUrls,autoLockMinutes,payment}=settings;
      useSettings.getState().update({network,rpcUrls,indexerUrl,sponsorUrls,autoLockMinutes,payment});
    } catch { /* Deployment defaults remain usable if the worker is restarting. */ }
  }
  // Preserve old direct-post links while keeping all new navigation in the panel.
  if(location.hash.startsWith("#post=")) {
    const post=new URLSearchParams(location.hash.slice(1)).get("post");
    if(post&&/^[A-Za-z0-9_-]{43}=?$/.test(post)) history.replaceState(null,"",`#/post/${encodeURIComponent(post)}`);
  }
  const stopLock=startAutoLock(useVault),stopSettings=startSettingsSync(useSettings);
  return ()=>{stopLock();stopSettings();};
}
