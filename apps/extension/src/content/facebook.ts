// Content script entry (registered at runtime with chrome.scripting.registerContentScripts,
// isolated world, classic script). All logic lives in facebookAdapter.ts so it can be tested.
import { startFacebookAdapter, type RunningAdapter } from "./facebookAdapter";

// Dynamic registration and immediate injection can race. Keep one controller/listener in the
// isolated world and refresh it when settings change instead of duplicating observers/controls.
const scope = globalThis as typeof globalThis & { __ospFacebook?: RunningAdapter };
if (scope.__ospFacebook) scope.__ospFacebook.refresh();
else {
  const running = startFacebookAdapter();
  if (running) {
    scope.__ospFacebook = running;
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab) return;
      const m = message as { type?: string; origins?: string[] } | null;
      if (m?.type !== "osp.facebook.stop" || !m.origins?.includes(`${location.origin}/*`)) return;
      running.stop();
      delete scope.__ospFacebook;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
    chrome.runtime.onMessage.addListener(onMessage);
  }
}
