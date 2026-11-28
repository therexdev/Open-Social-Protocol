/**
 * Service worker entry (Manifest V3, module worker). Wires chrome events to the background
 * services. Keys and plaintext never leave this worker.
 */
import "./bootstrap";
import { localArea, sessionArea } from "../shared/storage";
import { createBackground } from "./app";

const AUTOLOCK_ALARM = "osp.autolock";
const SWEEP_ALARM = "osp.sweep";

const background = createBackground({ local: localArea(), session: sessionArea(), runtimeId: chrome.runtime.id });

chrome.runtime.onMessage.addListener(background.router.listener);

// Firefox for Android has no Chrome side panel. Its toolbar action opens the same
// standalone client in a full tab, preserving the Facebook/X tab for the return trip.
if (import.meta.env.VITE_OSP_BROWSER === 'firefox' || !chrome.sidePanel?.setPanelBehavior) chrome.action.onClicked.addListener(() => {
  void (async () => {
    const url = chrome.runtime.getURL("src/sidepanel/index.html");
    const existing = (await chrome.tabs.query({})).find(tab => tab.url?.split("#")[0] === url);
    if (existing?.id !== undefined) await chrome.tabs.update(existing.id, { active: true });
    else await chrome.tabs.create({ url });
  })().catch(console.error);
});

async function setup(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // default is already trusted contexts only
  }
  if (import.meta.env.VITE_OSP_BROWSER !== 'firefox' && chrome.sidePanel?.setPanelBehavior) await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create(AUTOLOCK_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 5 });
  await background.syncAdapters();
  await background.refreshBadge();
}

chrome.runtime.onInstalled.addListener(() => {
  void setup();
});
chrome.runtime.onStartup.addListener(() => {
  void setup();
});
void setup();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTOLOCK_ALARM) void background.autoLock();
  else if (alarm.name === SWEEP_ALARM) void background.sweep().then(() => background.refreshBadge());
});

// Host permissions can change outside the options page (chrome://extensions "site access"):
// losing them must unregister the adapter, regaining them re-registers it for the granted sites.
chrome.permissions.onRemoved.addListener(() => {
  void background.syncAdapters();
});
chrome.permissions.onAdded.addListener(() => {
  void background.syncAdapters();
});
