import { create } from "zustand";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface PwaState {
  prompt?: InstallPrompt;
  registration?: ServiceWorkerRegistration;
  updateAvailable: boolean;
  offline: boolean;
  installed: boolean;
}
export const usePwa = create<PwaState>(() => ({ updateAvailable: false, offline: false, installed: false }));
let started = false;
let requestedUpdate = false;
export function startPwa() {
  if (started) return;
  started = true;
  const standalone = window.matchMedia("(display-mode: standalone)");
  const sync = () => usePwa.setState({ offline: !navigator.onLine, installed: standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone) });
  sync();
  standalone.addEventListener?.("change", sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); usePwa.setState({ prompt: event as InstallPrompt }); });
  window.addEventListener("appinstalled", () => usePwa.setState({ prompt: undefined, installed: true }));
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Other tabs keep their drafts and scroll position. Only the tab that asked reloads.
    usePwa.setState({ updateAvailable: false });
    if (requestedUpdate) window.location.reload();
  });
  void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => {
    usePwa.setState({ registration, updateAvailable: Boolean(registration.waiting && navigator.serviceWorker.controller) });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) usePwa.setState({ updateAvailable: true });
      });
    });
    window.addEventListener("focus", () => { if (navigator.onLine) void registration.update().catch(() => {}); });
  }).catch(() => { /* The online app remains usable if storage or service workers are disabled. */ });
}
export function applyUpdate() {
  const worker = usePwa.getState().registration?.waiting;
  if (!worker) return;
  requestedUpdate = true;
  worker.postMessage({ type: "ACTIVATE_UPDATE" });
}
