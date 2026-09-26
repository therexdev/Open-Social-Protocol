/**
 * Facebook composer adapter (isolated world). Detects composer dialogs by ARIA roles, injects the
 * labeled "Also publish to Open Social Protocol" control, and when the user activates the
 * dialog's submit control with the checkbox on, sends ONLY the composer text to the service worker
 * with the selected Open Social audience. That Post action publishes immediately.
 * If the selectors fail nothing breaks: the side panel composer keeps working (sidebar fallback).
 */
import { CONTROL_ATTR, TOAST_ATTR, createBoundedObserver, scanAndInject, showToast, type BoundedObserver, type ComposerAdapter } from "./adapter";
import { FEED_ATTR, maybeInsertFeedCards, resetFeedCards, type FeedCardsRuntime } from "./feedCards";
import type { PublishReply } from "../shared/protocol";

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
  /** Testable browser event boundary. Production accepts only real user events. */
  trustedEvent?: (event: Event) => boolean;
  now?: () => number;
}

export const ADAPTER_ATTR = "data-osp-facebook";
export const STATUS_ATTR = "data-osp-facebook-status";
export const TOAST_SENT = "Published to Open Social";

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
  let lastSent: { text: string; audience: number; at: number } | undefined;
  let publishing = false;

  const onSubmit = (text: string, audience: number, event: Event) => {
    if (stopped || publishing || !(runtime.trustedEvent?.(event) ?? event.isTrusted)) return;
    // A double activation (click + keyboard) must not create two proposals.
    if (lastSent && lastSent.text === text && lastSent.audience === audience && now() - lastSent.at < 2000) return;
    lastSent = { text, audience, at: now() };
    const payload = {
      hostSite: "facebook" as const,
      text,
      audience,
      attemptId: runtime.randomAttemptId(),
      url: runtime.location(),
      submitted: true,
      userGesture: runtime.userGesture?.() ?? true,
    };
    publishing = true;
    showToast(doc, `Publishing to Open Social · ${audience === 1 ? "Friends" : "Public"}…`, 60_000);
    Promise.resolve(runtime.sendMessage({ type: "crosspost.publish", payload }))
      .then((reply) => {
        if (stopped) return;
        const r = reply as { ok?: boolean; result?: PublishReply; error?: { message?: string } } | undefined;
        if (r?.ok && r.result) showToast(doc, r.result.message, r.result.status === "published" ? 5000 : 15000);
        else showToast(doc, `Open Social did not publish: ${r?.error?.message ?? "the extension did not answer"}. Open the extension to unlock or check Compose.`, 15000);
      })
      .catch(() => { if (!stopped) showToast(doc, "Open Social could not confirm publication. Open Compose to check the saved post before retrying.", 15000); })
      .finally(() => { publishing = false; });
  };

  function showStatus() {
    if (doc.querySelector(`[${STATUS_ATTR}]`)) return;
    const status = doc.createElement("details");
    status.setAttribute(STATUS_ATTR, "1");
    Object.assign(status.style, { position: "fixed", left: "12px", bottom: "12px", zIndex: "2147483646", maxWidth: "260px", padding: "8px 10px", border: "1px solid #5e84ff", borderRadius: "8px", background: "#f3f6ff", color: "#1b2340", font: "13px/1.4 system-ui, sans-serif" });
    const summary = doc.createElement("summary");
    summary.textContent = "Open Social enabled";
    const hint = doc.createElement("p");
    hint.textContent = 'In Facebook’s Create post box, enable “Also publish to Open Social Protocol” and choose Public or Friends. Clicking Post publishes the Open Social copy immediately while the extension is unlocked. The audience selection applies to Open Social; Facebook uses its own audience setting.';
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
