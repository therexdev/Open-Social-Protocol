/**
 * Facebook composer adapter (isolated world). Detects composer dialogs by ARIA roles, injects the
 * labeled "Also publish to Open Social Protocol" control, and when the user activates the
 * dialog's submit control with the checkbox on, sends ONLY the composer text to the service worker
 * as a draft proposal. Nothing is published without the side panel's explicit confirmation.
 * If the selectors fail nothing breaks: the side panel composer keeps working (sidebar fallback).
 */
import { createBoundedObserver, scanAndInject, showToast, type BoundedObserver, type ComposerAdapter } from "./adapter";
import { maybeInsertFeedCards, type FeedCardsRuntime } from "./feedCards";

const SUBMIT_LABEL = /^(post|publish)$/i;

export const facebookAdapter: ComposerAdapter = {
  name: "facebook",
  findComposers(root) {
    return [...root.querySelectorAll<HTMLElement>('div[role="dialog"]')].filter((dialog) => dialog.querySelector('[contenteditable="true"][role="textbox"]') !== null);
  },
  findTextbox(dialog) {
    return dialog.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]');
  },
  findSubmitButton(dialog) {
    const buttons = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')];
    const labeled = buttons.find((b) => SUBMIT_LABEL.test((b.getAttribute("aria-label") ?? "").trim()));
    if (labeled) return labeled;
    const enabled = buttons.filter((b) => !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true");
    return enabled.length > 0 ? (enabled[enabled.length - 1] ?? null) : null;
  },
  findFooter(dialog) {
    const button = this.findSubmitButton(dialog);
    if (!button) return null;
    // The footer is the nearest ancestor of the submit control that is not the dialog itself and
    // is a direct child of the dialog's content column (the block that holds the action row).
    let element: HTMLElement | null = button.parentElement;
    let footer: HTMLElement | null = element;
    while (element && element !== dialog) {
      footer = element;
      if (element.parentElement === dialog || element.parentElement?.querySelector('[contenteditable="true"][role="textbox"]')) break;
      element = element.parentElement;
    }
    return footer && footer !== dialog ? footer : button.parentElement;
  },
};

export interface AdapterRuntime extends FeedCardsRuntime {
  document: Document;
  /** The page URL at the moment of a proposal (Facebook navigates client-side; never freeze it at start). */
  location: () => string;
  /** 16 random bytes as hex. */
  randomAttemptId: () => string;
  userGesture?: () => boolean;
  now?: () => number;
}

export const ADAPTER_ATTR = "data-osp-facebook";
export const TOAST_SENT = "Sent to Open Social - confirm in the side panel";

function defaultRuntime(): AdapterRuntime {
  return {
    document,
    location: () => location.href,
    sendMessage: (message) => chrome.runtime.sendMessage(message),
    randomAttemptId: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""),
    userGesture: () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true,
  };
}

export interface RunningAdapter {
  stop(): void;
  observer: BoundedObserver;
  scan(): number;
}

export function startFacebookAdapter(runtime: AdapterRuntime = defaultRuntime()): RunningAdapter | null {
  const doc = runtime.document;
  const root = doc.documentElement;
  if (!root || root.hasAttribute(ADAPTER_ATTR)) return null;
  root.setAttribute(ADAPTER_ATTR, "1");
  const now = runtime.now ?? (() => Date.now());
  let lastSent: { text: string; at: number } | undefined;

  const onSubmit = (text: string) => {
    // A double activation (click + keyboard) must not create two proposals.
    if (lastSent && lastSent.text === text && now() - lastSent.at < 2000) return;
    lastSent = { text, at: now() };
    const payload = {
      hostSite: "facebook" as const,
      text,
      attemptId: runtime.randomAttemptId(),
      url: runtime.location(),
      submitted: true,
      userGesture: runtime.userGesture?.() ?? true,
    };
    Promise.resolve(runtime.sendMessage({ type: "crosspost.propose", payload }))
      .then((reply) => {
        const r = reply as { ok?: boolean; error?: { message?: string } } | undefined;
        if (r?.ok) showToast(doc, TOAST_SENT);
        else showToast(doc, `Not sent to Open Social: ${r?.error?.message ?? "the extension did not answer"}`);
      })
      .catch(() => showToast(doc, "Not sent to Open Social: the extension is unavailable"));
  };

  const scan = () => {
    try {
      const injected = scanAndInject(doc, facebookAdapter, doc, onSubmit);
      void maybeInsertFeedCards(runtime);
      return injected;
    } catch {
      return 0; // the host DOM changed in a way we do not understand: keep the page intact
    }
  };

  const observer = createBoundedObserver({ target: doc.body ?? root, onBatch: () => scan(), idleMs: 60_000, now });
  const resume = () => {
    observer.start();
    scan();
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") resume();
  };
  doc.defaultView?.addEventListener("focus", resume);
  doc.addEventListener("visibilitychange", onVisibility);
  observer.start();
  scan();

  return {
    observer,
    scan,
    stop() {
      observer.stop();
      doc.defaultView?.removeEventListener("focus", resume);
      doc.removeEventListener("visibilitychange", onVisibility);
      root.removeAttribute(ADAPTER_ATTR);
    },
  };
}
