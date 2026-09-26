/**
 * Generic host-adapter helpers for content scripts (isolated world, DOM only, no chrome APIs).
 * An adapter describes how to find a composer dialog, its textbox, footer and submit control;
 * these helpers inject one clearly labeled control per dialog, hook the submit action, batch DOM
 * observation with requestAnimationFrame and stop observing after a period of inactivity.
 * Nothing here injects scripts, inline handlers or HTML from untrusted strings.
 */
export interface ComposerAdapter {
  name: string;
  findComposers(root: ParentNode): HTMLElement[];
  findTextbox(dialog: HTMLElement): HTMLElement | null;
  findFooter(dialog: HTMLElement): HTMLElement | null;
  findSubmitButton(dialog: HTMLElement): HTMLElement | null;
}

export const CONTROL_ATTR = "data-osp-control";
export const HOOK_ATTR = "data-osp-hooked";
export const TOAST_ATTR = "data-osp-toast";
export const LABEL_TEXT = "Also publish to Open Social Protocol";
export const BADGE_TEXT = "OSP";

export interface InjectedControl {
  dialog: HTMLElement;
  host: HTMLElement;
  checkbox: HTMLInputElement;
  audience: HTMLSelectElement;
}

function style(el: HTMLElement, css: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, css);
}

/** Builds the control (checkbox + label + badge). Styled by the extension, never like host UI. */
export function buildControl(doc: Document): { host: HTMLElement; checkbox: HTMLInputElement; audience: HTMLSelectElement } {
  const host = doc.createElement("div");
  host.setAttribute(CONTROL_ATTR, "1");
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Open Social Protocol");
  style(host, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    margin: "6px 12px",
    padding: "8px 10px",
    border: "1px dashed #5e84ff",
    borderRadius: "8px",
    background: "#f3f6ff",
    color: "#1b2340",
    font: "13px/1.4 system-ui, sans-serif",
  });
  const label = doc.createElement("label");
  style(label, { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flex: "1" });
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", LABEL_TEXT);
  const text = doc.createElement("span");
  text.textContent = LABEL_TEXT;
  label.append(checkbox, text);
  const audience = doc.createElement("select");
  audience.setAttribute("aria-label", "Open Social audience");
  for (const [value, name] of [["0", "Public"], ["1", "Friends"]]) {
    const option = doc.createElement("option"); option.value = value!; option.textContent = name!; audience.append(option);
  }
  audience.disabled = true;
  style(audience, { color: "#1b2340", background: "#fff", border: "1px solid #5e84ff", borderRadius: "6px", padding: "6px", font: "inherit" });
  checkbox.addEventListener("change", () => { audience.disabled = !checkbox.checked; });
  const badge = doc.createElement("span");
  badge.textContent = BADGE_TEXT;
  badge.setAttribute("title", "Added by the Open Social Protocol extension");
  style(badge, { padding: "2px 6px", borderRadius: "999px", background: "#5e84ff", color: "#fff", fontSize: "11px", fontWeight: "600", letterSpacing: "0.04em" });
  host.append(label, audience, badge);
  return { host, checkbox, audience };
}

/** Injects the control next to the dialog footer; returns null when already present or no anchor exists. */
export function injectControl(dialog: HTMLElement, adapter: ComposerAdapter, doc: Document = dialog.ownerDocument): InjectedControl | null {
  if (dialog.querySelector(`[${CONTROL_ATTR}]`)) return null;
  const footer = adapter.findFooter(dialog);
  if (!footer || !footer.parentElement) return null;
  const { host, checkbox, audience } = buildControl(doc);
  footer.insertAdjacentElement("beforebegin", host);
  return { dialog, host, checkbox, audience };
}

/** Only the composer text (textContent of the textbox); never other page content. */
export function readComposerText(dialog: HTMLElement, adapter: ComposerAdapter): string {
  const textbox = adapter.findTextbox(dialog);
  // innerText preserves paragraphs/line breaks in real contenteditable editors.
  return (textbox?.innerText ?? textbox?.textContent ?? "").replace(/​/g, "").trim();
}

function isEnabled(button: HTMLElement): boolean {
  if ((button as HTMLButtonElement).disabled) return false;
  return button.getAttribute("aria-disabled") !== "true";
}

/**
 * Calls `onSubmit(text)` when the user activates the submit control while the checkbox is on.
 * Uses a capture-phase listener on the dialog so the host's own handler still runs.
 */
export type ComposerSubmit = (text: string, audience: number, event: Event) => void;
export function hookSubmit(dialog: HTMLElement, adapter: ComposerAdapter, control: () => InjectedControl | null, onSubmit: ComposerSubmit): () => void {
  if (dialog.hasAttribute(HOOK_ATTR)) return () => undefined;
  dialog.setAttribute(HOOK_ATTR, "1");
  const fire = (event: Event) => {
    const current = control();
    if (!current || !current.checkbox.checked) return;
    const text = readComposerText(dialog, adapter);
    if (text.length === 0) return;
    onSubmit(text, current.audience.value === "1" ? 1 : 0, event);
  };
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    const button = adapter.findSubmitButton(dialog);
    if (!target || !button || !button.contains(target) || !isEnabled(button)) return;
    fire(event);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    const textbox = adapter.findTextbox(dialog);
    const button = adapter.findSubmitButton(dialog);
    if (button && isEnabled(button) && textbox && textbox.contains(event.target as Node)) fire(event);
  };
  dialog.addEventListener("click", onClick, true);
  dialog.addEventListener("keydown", onKey, true);
  return () => {
    dialog.removeEventListener("click", onClick, true);
    dialog.removeEventListener("keydown", onKey, true);
    dialog.removeAttribute(HOOK_ATTR);
  };
}

/** Injects controls and hooks into every composer found under `root`; returns how many were injected now. */
export function scanAndInject(root: ParentNode, adapter: ComposerAdapter, doc: Document, onSubmit: ComposerSubmit, hooks?: Map<HTMLElement, () => void>): number {
  let injected = 0;
  for (const dialog of adapter.findComposers(root)) {
    const control = injectControl(dialog, adapter, doc);
    if (control) injected++;
    if (dialog.hasAttribute(HOOK_ATTR)) continue;
    const unhook = hookSubmit(dialog, adapter, () => {
      const host = dialog.querySelector(`[${CONTROL_ATTR}]`) as HTMLElement | null;
      const checkbox = host?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const audience = host?.querySelector("select") as HTMLSelectElement | null;
      return host && checkbox && audience ? { dialog, host, checkbox, audience } : null;
    }, onSubmit);
    hooks?.set(dialog, unhook);
  }
  return injected;
}

/** A small in-page notice, clearly attributed to the extension. */
export function showToast(doc: Document, text: string, ttlMs = 5000): HTMLElement {
  doc.querySelector(`[${TOAST_ATTR}]`)?.remove();
  const toast = doc.createElement("div");
  toast.setAttribute(TOAST_ATTR, "1");
  toast.setAttribute("role", "status");
  style(toast, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    maxWidth: "320px",
    padding: "10px 14px",
    borderRadius: "10px",
    background: "#181e30",
    color: "#fff",
    font: "13px/1.4 system-ui, sans-serif",
    boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
  });
  const title = doc.createElement("div");
  title.textContent = "Open Social Protocol";
  style(title, { fontWeight: "600", fontSize: "11px", opacity: "0.75", marginBottom: "2px" });
  const body = doc.createElement("div");
  body.textContent = text;
  toast.append(title, body);
  (doc.body ?? doc.documentElement).appendChild(toast);
  setTimeout(() => toast.remove(), ttlMs);
  return toast;
}

export interface BoundedObserverOptions {
  target: Node;
  onBatch: (mutations: MutationRecord[]) => void;
  /** Disconnect after this long without mutations (default 60 s). */
  idleMs?: number;
  schedule?: (callback: () => void) => void;
  now?: () => number;
  filter?: (mutation: MutationRecord) => boolean;
  observe?: MutationObserverInit;
}

export interface BoundedObserver {
  start(): void;
  stop(): void;
  readonly active: boolean;
}

/** A MutationObserver that batches with requestAnimationFrame and disconnects when idle. */
export function createBoundedObserver(options: BoundedObserverOptions): BoundedObserver {
  const idleMs = options.idleMs ?? 60_000;
  const schedule = options.schedule ?? ((cb) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => cb()) : setTimeout(cb, 16)));
  const now = options.now ?? (() => Date.now());
  let observer: MutationObserver | undefined;
  let pending: MutationRecord[] = [];
  let scheduled = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let lastActivity = now();

  const flush = () => {
    scheduled = false;
    const batch = pending;
    pending = [];
    if (batch.length > 0) options.onBatch(batch);
  };
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (now() - lastActivity >= idleMs) stop();
      else armIdle();
    }, idleMs);
  };
  const stop = () => {
    observer?.disconnect();
    observer = undefined;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    pending = [];
  };
  const start = () => {
    if (observer) {
      lastActivity = now();
      return;
    }
    if (typeof MutationObserver !== "function") return;
    observer = new MutationObserver((mutations) => {
      const relevant = options.filter ? mutations.filter(options.filter) : mutations;
      if (!relevant.length) return;
      lastActivity = now();
      pending.push(...relevant.slice(0, Math.max(0, 40 - pending.length)));
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    });
    observer.observe(options.target, options.observe ?? { childList: true, subtree: true });
    lastActivity = now();
    armIdle();
  };
  return {
    start,
    stop,
    get active() {
      return observer !== undefined;
    },
  };
}
