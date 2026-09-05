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

async function setup(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // default is already trusted contexts only
  }
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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

// Losing the host permission (chrome://extensions) must unregister the adapter.
chrome.permissions.onRemoved.addListener(() => {
  void background.syncAdapters();
});
