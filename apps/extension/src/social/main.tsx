// Install the CSP-safe codec before any client dependency can encode a message.
import "../shared/bootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "../../../web/src/App";
import { startAutoLock, useVault } from "../../../web/src/vault/store";
import { startSettingsSync, useSettings, SETTINGS_KEY } from "../../../web/src/stores/settings";
import { rpc } from "../shared/rpc";
import type { SettingsView } from "../shared/protocol";
import "../../../web/src/styles.css";
import "./style.css";

function SocialApp() {
  const status = useVault(s => s.status);
  return <>
    <aside className="extension-app-bar" aria-label="Extension controls">
      <span>Extension {chrome.runtime.getManifest().version}</span>
      <a href={chrome.runtime.getURL("src/permissions/index.html")} target="_blank" rel="noopener noreferrer">Microphone / camera</a>
      <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>Browser settings</button>
    </aside>
    {status === "empty" && <div className="extension-signin-note" role="note">Already on Open Social? Import your existing identity backup below to use the same account. This full app has its own encrypted sign-in; your Facebook browser authorization stays in Browser tools.</div>}
    <App/>
  </>;
}

async function start() {
  // Copy only non-secret endpoint preferences once; never overwrite an existing app vault or settings.
  if (!localStorage.getItem(SETTINGS_KEY)) {
    try {
      const { settings } = await rpc<SettingsView>("settings.get");
      const { network, rpcUrls, indexerUrl, sponsorUrls, autoLockMinutes, payment } = settings;
      useSettings.getState().update({ network, rpcUrls, indexerUrl, sponsorUrls, autoLockMinutes, payment });
    } catch { /* The bundled deployment defaults still work if the worker is restarting. */ }
  }
  startAutoLock(useVault);
  startSettingsSync(useSettings);
  createRoot(document.getElementById("root")!).render(<StrictMode><HashRouter><SocialApp/></HashRouter></StrictMode>);
}
void start();
