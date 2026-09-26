/**
 * Facebook composer adapter (isolated world). Detects composer dialogs by ARIA roles, injects the
 * labeled "Also publish to Open Social Protocol" control, and when the user activates the
 * dialog's submit control with the checkbox on, sends ONLY the composer text to the service worker
 * as a draft proposal. Nothing is published without the side panel's explicit confirmation.
 * If the selectors fail nothing breaks: the side panel composer keeps working (sidebar fallback).
 */
import { CONTROL_ATTR, TOAST_ATTR, createBoundedObserver, scanAndInject, showToast, type BoundedObserver, type ComposerAdapter } from "./adapter";
import { FEED_ATTR, maybeInsertFeedCards, resetFeedCards, type FeedCardsRuntime } from "./feedCards";

const SUBMIT_LABEL = /^(post|publish)$/i;
const TEXTBOX = '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor="true"]';

export const facebookAdapter: ComposerAdapter = {
  name: "facebook",
  findComposers(root) {
    return [...root.querySelectorAll<HTMLElement>('[role="dialog"], dialog')].filter((dialog) => dialog.querySelector(TEXTBOX) !== null);
  },
  findTextbox(dialog) {
    return dialog.querySelector<HTMLElement>(TEXTBOX);
  },
  findSubmitButton(dialog) {
    const buttons = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')];
    const labeled = buttons.find((b) => !b.closest(`[${CONTROL_ATTR}]`) && SUBMIT_LABEL.test((b.getAttribute("aria-label") ?? b.textContent ?? "").trim()));
    if (labeled) return labeled;
    // Never guess that the last action is Post (it can be Photo, Close, or a privacy control).
    return dialog.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]');
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
      if (element.parentElement === dialog || element.parentElement?.querySelector(TEXTBOX)) break;
      element = element.parentElement;
    }
    return footer && footer !== dialog ? footer : button;
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
export const STATUS_ATTR = "data-osp-facebook-status";
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
  refresh(): void;
  observer: BoundedObserver;
  scan(): number;
}

export function startFacebookAdapter(runtime: AdapterRuntime = defaultRuntime()): RunningAdapter | null {
  const doc = runtime.document;
  const root = doc.documentElement;
  if (!root || root.hasAttribute(ADAPTER_ATTR)) return null;
  root.setAttribute(ADAPTER_ATTR, "1");
  const now = runtime.now ?? (() => Date.now());
  const hooks = new Map<HTMLElement, () => void>();
  let stopped = false;
  let lastSent: { text: string; at: number } | undefined;

  const onSubmit = (text: string) => {
    if (stopped) return;
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
        if (stopped) return;
        const r = reply as { ok?: boolean; error?: { message?: string } } | undefined;
        if (r?.ok) showToast(doc, TOAST_SENT);
        else showToast(doc, `Not sent to Open Social: ${r?.error?.message ?? "the extension did not answer"}`);
      })
      .catch(() => { if (!stopped) showToast(doc, "Not sent to Open Social: the extension is unavailable"); });
  };

  function showStatus() {
    if (doc.querySelector(`[${STATUS_ATTR}]`)) return;
    const status = doc.createElement("details");
    status.setAttribute(STATUS_ATTR, "1");
    Object.assign(status.style, { position: "fixed", left: "12px", bottom: "12px", zIndex: "2147483646", maxWidth: "260px", padding: "8px 10px", border: "1px solid #5e84ff", borderRadius: "8px", background: "#f3f6ff", color: "#1b2340", font: "13px/1.4 system-ui, sans-serif" });
    const summary = doc.createElement("summary");
    summary.textContent = "Open Social enabled";
    const hint = doc.createElement("p");
    hint.textContent = 'Open Facebook’s Create post dialog for the “Also publish to Open Social Protocol” checkbox. Confirm the draft in the extension’s Queue tab. To see public Open Social posts here, enable the feed box in extension Settings.';
    status.append(summary, hint);
    (doc.body ?? root).append(status);
  }

  const scan = () => {
    if (stopped) return 0;
    try {
      for (const [dialog, unhook] of hooks) {
        if (!dialog.isConnected) { unhook(); hooks.delete(dialog); }
      }
      showStatus();
      const injected = scanAndInject(doc, facebookAdapter, doc, onSubmit, hooks);
      void maybeInsertFeedCards(runtime);
      return injected;
    } catch {
      return 0; // the host DOM changed in a way we do not understand: keep the page intact
    }
  };

  const observer = createBoundedObserver({ target: doc.body ?? root, onBatch: () => scan(), idleMs: 60_000, now });
  const resume = () => {
    if (stopped) return;
    observer.start();
    scan();
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") resume();
  };
  doc.defaultView?.addEventListener("focus", resume);
  doc.addEventListener("visibilitychange", onVisibility);
  // Opening a composer after the observer went idle need not focus the window again.
  doc.addEventListener("pointerdown", resume, true);
  doc.addEventListener("keydown", resume, true);
  observer.start();
  scan();

  return {
    observer,
    scan,
    refresh() {
      if (stopped) return;
      resetFeedCards(doc);
      doc.querySelectorAll(`[${FEED_ATTR}]`).forEach((el) => el.remove());
      resume();
    },
    stop() {
      stopped = true;
      observer.stop();
      doc.defaultView?.removeEventListener("focus", resume);
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.removeEventListener("pointerdown", resume, true);
      doc.removeEventListener("keydown", resume, true);
      for (const unhook of hooks.values()) unhook();
      hooks.clear();
      resetFeedCards(doc);
      doc.querySelectorAll(`[${CONTROL_ATTR}], [${FEED_ATTR}], [${TOAST_ATTR}], [${STATUS_ATTR}]`).forEach((el) => el.remove());
      root.removeAttribute(ADAPTER_ATTR);
    },
  };
}
