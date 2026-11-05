import { startXAdapter } from "./xAdapter";
const scope = globalThis as typeof globalThis & { __ospX?: ReturnType<typeof startXAdapter> };
if (scope.__ospX) scope.__ospX.refresh();
else {
  const running = startXAdapter();
  if (running) {
    scope.__ospX = running;
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab) return;
      const m = message as { type?: string; origins?: string[] } | null;
      if (m?.type !== "osp.x.stop" || !m.origins?.includes(`${location.origin}/*`)) return;
      running.stop(); delete scope.__ospX; chrome.runtime.onMessage.removeListener(onMessage);
    };
    chrome.runtime.onMessage.addListener(onMessage);
  }
}
