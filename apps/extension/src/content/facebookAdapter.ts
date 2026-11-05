/**
 * Facebook composer adapter (isolated world). Detects composer dialogs by ARIA roles, injects the
 * labeled "Also publish to Open Social Protocol" control, and when the user activates the
 * dialog's submit control with the checkbox on, saves the composer text with its selected audience.
 * It adds the profile footer through native editing on Post, then observes the published Facebook
 * permalink before completing the Open Social copy. Uncertain results remain recoverable.
 * If the selectors fail nothing breaks: the side panel composer keeps working (sidebar fallback).
 */
import { CONTROL_ATTR, TOAST_ATTR, createBoundedObserver, scanAndInject, showToast, type BoundedObserver, type ComposerAdapter } from "./adapter";
import { FEED_ATTR, FEED_POST_SELECTOR, feedStructuralNode, feedCardNeedsRepair, maybeInsertFeedCards, resetFeedCards, type FeedCardsRuntime } from "./feedCards";
import type { PublishReply } from "../shared/protocol";
import { ComposerAttribution } from "./attribution";
import { watchPublishedPost } from "./publishedPost";

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

/** Ignore typing, counters, sidebars and our own insertions. Only a changed post/composer
 * structure needs discovery. Removing our cards externally still triggers restoration. */
export function relevantFacebookMutation(mutation: MutationRecord): boolean {
  const target = mutation.target.nodeType === 1 ? mutation.target as Element : mutation.target.parentElement;
  const owned = `[${CONTROL_ATTR}], [${FEED_ATTR}], [${STATUS_ATTR}], [${TOAST_ATTR}]`;
  if (target?.closest(`${owned}, ${TEXTBOX}, aside, [role="complementary"]`)) return false;
  const structural = `[role="main"], main, [role="feed"], ${FEED_POST_SELECTOR}, [data-virtualized], [role="dialog"], dialog`;
  if (mutation.type === "attributes") return !!target && (target.matches(structural) || feedStructuralNode(target));
  for (const node of mutation.removedNodes) {
    if (node.nodeType === 1 && (node as Element).hasAttribute(FEED_ATTR) && feedCardNeedsRepair(node as Element)) return true;
    if (node.nodeType === 1 && !node.isConnected && (node as Element).matches(`[${CONTROL_ATTR}]`)) return true;
  }
  for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (!el.matches(owned) && ((target && feedStructuralNode(target)) || el.matches(structural) || el.querySelector(`${structural}, ${TEXTBOX}`))) return true;
  }
  return false;
}

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
  const attributions = new Map<HTMLElement, { editor: ComposerAttribution; unhook: () => void }>();
  let autoCheck = false; // Apply the saved preference before preselecting a composer.
  let replaying = false;
  const manualChoices = new WeakSet<HTMLElement>();
  const pending = new Set<() => void>();
  const attempts = new WeakMap<HTMLElement, { text: string; audience: number; id: string }>();
  let attributionEnabled = false; // Wait for the stored preference before changing a draft.
  let preferenceGeneration = 0;
  let stopped = false;
  let lastSent: { text: string; audience: number; at: number } | undefined;
  let publishing = false;

  const onSubmit = (text: string, audience: number, event: Event) => {
    if (stopped || replaying || !(runtime.trustedEvent?.(event) ?? event.isTrusted)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (publishing) return;
    const dialog = (event.target as Element | null)?.closest<HTMLElement>('[role="dialog"], dialog');
    if (!dialog) return;
    const attribution = attributions.get(dialog)?.editor;
    text = attribution?.text() ?? text;
    if (!text || lastSent && lastSent.text === text && lastSent.audience === audience && now() - lastSent.at < 2000) return;
    lastSent = { text, audience, at: now() };
    let attempt = attempts.get(dialog);
    if (!attempt || attempt.text !== text || attempt.audience !== audience) {
      attempt = { text, audience, id: runtime.randomAttemptId() }; attempts.set(dialog, attempt);
    }
    const attemptId = attempt.id;
    const payload = { hostSite: "facebook" as const, text, audience, attemptId, url: runtime.location(), submitted: true,
      userGesture: runtime.userGesture?.() ?? true, waitForFacebook: true };
    publishing = true;
    showToast(doc, "Preparing your Open Social copy…", 60_000);
    void (async () => {
      try {
        const reply = await runtime.sendMessage({ type: "crosspost.publish", payload }) as { ok?: boolean; result?: PublishReply; error?: { message?: string } };
        if (stopped) return;
        if (!reply?.ok || !reply.result) throw Error(reply?.error?.message || "Open Social did not answer. Unlock it in Browser tools and try Post again.");
        if (!dialog.isConnected || (attribution?.text() ?? text) !== text || !optedIn(dialog)) throw Error("Your draft changed. Review it and click Post again.");
        if (attributionEnabled && attribution && !attribution.sync(true, reply.result.profileUrl)) throw Error("The profile link could not be added. Review the message below the checkbox before posting again.");
        // Let the native input event commit to Facebook's editor before its Post handler runs.
        await new Promise(resolve => setTimeout(resolve, 60));
        if (stopped || !dialog.isConnected || !optedIn(dialog) || (attribution?.text() ?? text) !== text) return;
        const button = facebookAdapter.findSubmitButton(dialog);
        if (!button || button.getAttribute('aria-disabled') === 'true' || (button as HTMLButtonElement).disabled) throw Error("Facebook is still preparing this post. Click Post when it is ready.");
        if (reply.result.awaitingFacebook) {
          let cancel: () => void;
          const finished = () => { pending.delete(cancel); };
          cancel = watchPublishedPost(doc, text, url => {
            finished();
            void Promise.resolve(runtime.sendMessage({ type: "crosspost.facebookComplete", payload: { attemptId, url } })).then(response => {
              if (stopped) return;
              const r = response as { ok?: boolean; result?: PublishReply; error?: { message?: string } };
              showToast(doc, r?.ok ? r.result?.message || "Open Social is confirming your post." : `Open Social needs attention: ${r?.error?.message || 'Open Compose to finish the saved draft.'}`, 15000);
            }).catch(() => { if (!stopped) showToast(doc, "Open Compose to check this saved post before retrying.", 15000); });
          }, () => { finished(); if (!stopped) showToast(doc, "The Facebook post link was not detected. In Browser tools → Compose, add its link to finish your saved Open Social draft.", 20000); });
          pending.add(cancel);
          showToast(doc, "Waiting for Facebook’s published post link…", 60_000);
        } else showToast(doc, reply.result.message, 5000);
        replaying = true;
        try { button.click(); } finally { replaying = false; }
      } catch (error) {
        if (!stopped) showToast(doc, `Post paused: ${error instanceof Error ? error.message : String(error)}`, 15000);
      } finally { publishing = false; }
    })();
  };

  const optedIn = (dialog: HTMLElement) => dialog.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)?.checked === true;
  async function loadPreferences() {
    const generation = ++preferenceGeneration;
    try {
      const reply = await runtime.sendMessage({ type: "adapter.preferences" }) as { ok?: boolean; result?: { facebookAttribution?: boolean; facebookAutoCheck?: boolean } };
      if (stopped || generation !== preferenceGeneration || !reply?.ok || typeof reply.result?.facebookAttribution !== "boolean") return;
      attributionEnabled = reply.result.facebookAttribution;
      autoCheck = reply.result.facebookAutoCheck !== false;
      for (const [dialog, { editor }] of attributions) {
        if (!manualChoices.has(dialog)) {
          const checkbox = dialog.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)!;
          checkbox.checked = autoCheck;
          dialog.querySelector<HTMLSelectElement>(`[${CONTROL_ATTR}] select`)!.disabled = !autoCheck;
        }
        if (!attributionEnabled || !optedIn(dialog)) editor.sync(false);
      }
    } catch { /* Keep publishing available; do not override a preference we could not read. */ }
  }

  function showStatus() {
    if (doc.querySelector(`[${STATUS_ATTR}]`)) return;
    const status = doc.createElement("details");
    status.setAttribute(STATUS_ATTR, "1");
    Object.assign(status.style, { position: "fixed", left: "12px", bottom: "12px", zIndex: "2147483646", maxWidth: "260px", padding: "8px 10px", border: "1px solid #5e84ff", borderRadius: "8px", background: "#f3f6ff", color: "#1b2340", font: "13px/1.4 system-ui, sans-serif" });
    const summary = doc.createElement("summary");
    summary.textContent = "Open Social enabled";
    const hint = doc.createElement("p");
    hint.textContent = 'Cross-posting is checked by default; you can uncheck it for any post or change the default in Settings. Choose Public or Friends for the Open Social copy. After Facebook publishes, its post link is included on Open Social. Unlock Browser tools before posting.';
    status.append(summary, hint);
    (doc.body ?? root).append(status);
  }

  const scan = () => {
    if (stopped) return 0;
    try {
      for (const [dialog, unhook] of hooks) {
        if (!dialog.isConnected) { unhook(); hooks.delete(dialog); attributions.get(dialog)?.unhook(); attributions.delete(dialog); }
      }
      showStatus();
      const injected = scanAndInject(doc, facebookAdapter, doc, onSubmit, hooks);
      for (const dialog of hooks.keys()) {
        if (attributions.has(dialog)) continue;
        const editor = new ComposerAttribution(dialog, facebookAdapter);
        const checkbox = dialog.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)!;
        checkbox.checked = autoCheck;
        dialog.querySelector<HTMLSelectElement>(`[${CONTROL_ATTR}] select`)!.disabled = !autoCheck;
        const changed = (event: Event) => {
          if (!(runtime.trustedEvent?.(event) ?? event.isTrusted)) return;
          if ((event.target as Element | null)?.matches(`[${CONTROL_ATTR}] input`)) { manualChoices.add(dialog); if (!optedIn(dialog)) editor.sync(false); }
        };
        dialog.addEventListener("change", changed);
        attributions.set(dialog, { editor, unhook: () => dialog.removeEventListener("change", changed) });
      }
      void maybeInsertFeedCards(runtime);
      return injected;
    } catch {
      return 0; // the host DOM changed in a way we do not understand: keep the page intact
    }
  };

  const observer = createBoundedObserver({
    target: doc.body ?? root, onBatch: () => scan(), idleMs: 60_000, now,
    filter: relevantFacebookMutation, schedule: callback => setTimeout(callback, 120),
    observe: { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "data-pagelet", "aria-posinset", "data-virtualized", "aria-hidden", "hidden", "style", "class"] },
  });
  const resume = () => {
    if (stopped) return;
    observer.start();
    scan();
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") resume();
    else observer.stop();
  };
  const wake = () => {
    if (stopped || doc.visibilityState === "hidden") return;
    const inactive = !observer.active;
    observer.start();
    if (inactive) scan();
  };
  doc.defaultView?.addEventListener("focus", resume);
  doc.addEventListener("visibilitychange", onVisibility);
  // Opening a composer after the observer went idle need not focus the window again.
  doc.addEventListener("pointerdown", wake, true);
  doc.addEventListener("keydown", wake, true);
  doc.defaultView?.addEventListener("scroll", wake, { passive: true });
  observer.start();
  scan();
  void loadPreferences();

  return {
    observer,
    scan,
    refresh() {
      if (stopped) return;
      void loadPreferences();
      resetFeedCards(doc);
      doc.querySelectorAll(`[${FEED_ATTR}]`).forEach((el) => el.remove());
      resume();
    },
    stop() {
      stopped = true;
      for (const cancel of pending) cancel(); pending.clear();
      observer.stop();
      doc.defaultView?.removeEventListener("focus", resume);
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.removeEventListener("pointerdown", wake, true);
      doc.removeEventListener("keydown", wake, true);
      doc.defaultView?.removeEventListener("scroll", wake);
      for (const unhook of hooks.values()) unhook();
      hooks.clear();
      for (const { editor, unhook } of attributions.values()) { editor.sync(false); unhook(); }
      attributions.clear();
      resetFeedCards(doc);
      doc.querySelectorAll(`[${CONTROL_ATTR}], [${FEED_ATTR}], [${TOAST_ATTR}], [${STATUS_ATTR}]`).forEach((el) => el.remove());
      root.removeAttribute(ADAPTER_ATTR);
    },
  };
}
