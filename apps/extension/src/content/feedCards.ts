/** Scrolling host-feed placement. Only ids enter Facebook; content renders in extension iframes. */
import type { FeedRequestReply } from "../shared/protocol";
import { facebookTheme, watchFacebookTheme, type FacebookTheme } from "./facebookTheme";
export const FEED_ATTR = "data-osp-feed";
export const FEED_TITLE = "Open Social posts";
const controllers = new WeakMap<Document, FeedController>();
// Numbered rows survive Facebook's loaded -> virtualized -> loaded lifecycle.
export const FEED_POST_SELECTOR = '[aria-posinset], [data-pagelet^="FeedUnit_"], [role="article"]';
const structuralNodes = new WeakSet<Element>();
const parkedCards = new WeakSet<Element>();
export const feedStructuralNode = (element: Element) => structuralNodes.has(element);
const expectedPositions = new WeakMap<Element, { parent: Element; next: Node | null }>();
export function feedCardNeedsRepair(element: Element): boolean {
  if (parkedCards.has(element)) return false;
  const expected = expectedPositions.get(element);
  return !element.isConnected || !!expected && (element.parentElement !== expected.parent || element.nextSibling !== expected.next);
}
export interface FeedCardsRuntime {
  document: Document;
  sendMessage: (message: unknown) => Promise<unknown> | unknown;
  frameUrl?: (postId: string) => string;
  now?: () => number;
}
export interface FeedLocation { column: HTMLElement; posts: HTMLElement[]; keys: Map<HTMLElement, string>; positions: Map<HTMLElement, number> }

/** Locate a vertical post lane; never prepend into the potentially horizontal main layout. */
export function findFeedLocation(doc: Document): FeedLocation | null {
  const main = doc.querySelector<HTMLElement>('[role="main"], main') ?? doc.body;
  if (!main) return null;
  const marker = FEED_POST_SELECTOR;
  const excluded = `[${FEED_ATTR}], [role="complementary"], aside, [role="dialog"], [role="listbox"], [role="menu"], [hidden], [aria-hidden="true"]`;
  const candidates = [...main.querySelectorAll<HTMLElement>(marker)].filter(el =>
    !el.closest(excluded) && !el.parentElement?.closest(marker) &&
    (!el.hasAttribute("aria-posinset") || /^[1-9]\d*$/.test(el.getAttribute("aria-posinset")!)) &&
    // Facebook's trailing skeletons have role=article too; they are not post rows.
    !el.querySelector('[role="status"][data-visualcompletion="loading-state"]'));
  const numbered = candidates.filter(el => el.hasAttribute("aria-posinset"));
  // Prefer real numbered rows over the unnumbered infinite-scroll loading suffix.
  const anchors = numbered.length ? numbered : candidates;
  const styles = new Map<HTMLElement, CSSStyleDeclaration>();
  const css = (el: HTMLElement) => {
    if (!styles.has(el)) styles.set(el, doc.defaultView!.getComputedStyle(el));
    return styles.get(el)!;
  };
  // Count immediate branches once per ancestor (linear in posts * bounded depth).
  const lanes = new Map<HTMLElement, Map<HTMLElement, HTMLElement>>();
  for (const post of anchors) {
    if (css(post).display === "none") continue;
    let branch = post;
    for (let depth = 0; depth < 12 && branch.parentElement; depth++) {
      const parent = branch.parentElement;
      const style = css(parent);
      if (style.display === "none" || style.display === "flex" && !style.flexDirection.startsWith("column")) break;
      if (parent === main && parent.getAttribute("role") !== "feed") break;
      let branches = lanes.get(parent);
      if (!branches) { branches = new Map(); lanes.set(parent, branches); }
      if (!branches.has(branch)) branches.set(branch, post);
      branch = parent;
    }
  }
  let best: FeedLocation | null = null;
  for (const [column, branches] of lanes) {
    if (branches.size < 2 && column.getAttribute("role") !== "feed") continue;
    if (!best || branches.size > best.posts.length) {
      const keys = new Map<HTMLElement, string>(), positions = new Map<HTMLElement, number>();
      for (const [row, post] of branches) {
        const position = Number(post.getAttribute("aria-posinset"));
        if (position > 0) { keys.set(row, `position:${position}`); positions.set(row, position); }
        else if (post.hasAttribute("data-pagelet")) keys.set(row, `pagelet:${post.getAttribute("data-pagelet")}`);
      }
      best = { column, posts: [...branches.keys()], keys, positions };
    }
  }
  const single = anchors.find(el => el.matches('[data-pagelet^="FeedUnit_"]'));
  if (!best && single?.parentElement && single.parentElement !== main) best = { column: single.parentElement, posts: [single], keys: new Map([[single, `pagelet:${single.getAttribute("data-pagelet")}`]]), positions: new Map() };
  if (best) {
    best.posts.sort((a, b) => (Number(css(a).order) || 0) - (Number(css(b).order) || 0));
    structuralNodes.add(best.column);
    for (const post of best.posts) structuralNodes.add(post);
  }
  return best;
}
export function findFeedRoot(doc: Document): HTMLElement | null { return findFeedLocation(doc)?.column ?? null; }

export class FeedController {
  private alive = true;
  private busy = false;
  private enabled: boolean | undefined;
  private initialized = false;
  private cursor: string | null | undefined;
  private lastPoll = -Infinity;
  private retryAt = 0;
  private queued: string[] = [];
  private seen = new Set<string>();
  private placedAfter = new WeakMap<HTMLElement, string>();
  private frames = new Map<string, HTMLIFrameElement>();
  private placements = new Map<string, { anchor: HTMLElement; key?: string; index: number }>();
  private timer: ReturnType<typeof setInterval>;
  private scheduled = false;
  private location: FeedLocation | null = null;
  private locationDirty = true;
  private reanchor = true;
  private scrollTimer?: ReturnType<typeof setTimeout>;
  private notice?: HTMLElement;
  private now: () => number;
  private href: string;
  private generation = 0;
  private theme: FacebookTheme = "light";
  private stopTheme: () => void;

  constructor(private runtime: FeedCardsRuntime) {
    this.now = runtime.now ?? Date.now;
    this.href = runtime.document.location?.href ?? "";
    this.theme = facebookTheme(runtime.document);
    this.stopTheme = watchFacebookTheme(runtime.document, theme => { this.theme = theme; for (const frame of this.frames.values()) this.sendTheme(frame); });
    this.timer = setInterval(() => { if (runtime.document.visibilityState !== "hidden") void this.scan(true); }, 30_000);
    runtime.document.defaultView?.addEventListener("scroll", this.onScroll, { passive: true });
    runtime.document.defaultView?.addEventListener("message", this.onMessage);
    runtime.document.defaultView?.addEventListener("online", this.onScroll);
    runtime.document.addEventListener("visibilitychange", this.onScroll);
  }
  private onScroll = () => {
    if (this.scheduled || !this.alive) return;
    this.scheduled = true;
    // Scroll uses the cached lane. No full-document selectors or style reads per animation frame.
    this.scrollTimer = setTimeout(() => { this.scheduled = false; void this.scan(false); }, 120);
  };
  private onMessage = (event: MessageEvent) => {
    if (event.data?.type !== "osp.card.height" || !Number.isFinite(event.data.height)) return;
    for (const frame of this.frames.values()) {
      const url = new URL(frame.src);
      if (event.source !== frame.contentWindow || event.origin !== `${url.protocol}//${url.host}`) continue;
      const height = `${Math.min(100000, Math.max(90, Math.ceil(event.data.height)))}px`;
      if (frame.style.height !== height) frame.style.height = height;
      break;
    }
  };
  private sendTheme(frame: HTMLIFrameElement): void {
    const url = new URL(frame.src);
    frame.style.colorScheme = this.theme;
    frame.contentWindow?.postMessage({ type: "osp.card.theme", theme: this.theme }, `${url.protocol}//${url.host}`);
  }
  private insert(postId: string, anchor: HTMLElement, location: FeedLocation): void {
    const doc = this.runtime.document;
    const frame = doc.createElement("iframe");
    const host = doc.createElement("section");
    host.setAttribute(FEED_ATTR, postId);
    host.setAttribute("aria-label", "Open Social post");
    Object.assign(host.style, { display: "block", width: "100%", minWidth: "0", boxSizing: "border-box", margin: "0 0 12px", flex: "0 0 auto", overflowAnchor: "none" });
    frame.src = this.runtime.frameUrl?.(postId) ?? `${chrome.runtime.getURL("src/embed/index.html")}#post=${encodeURIComponent(postId)}&host=${encodeURIComponent(doc.location.origin)}`;
    const frameUrl = new URL(frame.src), params = new URLSearchParams(frameUrl.hash.slice(1));
    params.set("theme", this.theme); frameUrl.hash = params.toString(); frame.src = frameUrl.href;
    frame.addEventListener("load", () => this.sendTheme(frame));
    frame.title = "Open Social post";
    frame.loading = "lazy";
    frame.allow = "autoplay; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "origin";
    Object.assign(frame.style, { display: "block", width: "100%", height: "180px", border: "0", colorScheme: this.theme });
    host.append(frame);
    location.column.insertBefore(host, anchor.nextSibling);
    this.frames.set(postId, frame);
    this.placements.set(postId, { anchor, key: location.keys.get(anchor), index: location.posts.indexOf(anchor) });
    this.reanchor = true;
  }
  private getLocation(): FeedLocation | null {
    if (this.locationDirty || !this.location?.column.isConnected || this.location.posts.some(post => post.parentElement !== this.location!.column)) {
      this.location = findFeedLocation(this.runtime.document);
      this.locationDirty = false;
      this.reanchor = true;
    }
    return this.location;
  }
  /** React may insert/reorder native children around our unmanaged siblings. Keep every card
   * attached to its native post, including its CSS order, rather than letting it drift to the tail. */
  private anchorCards(location: FeedLocation): void {
    const occupied = new Set<HTMLElement>();
    const byKey = new Map([...location.keys].map(([row, key]) => [key, row]));
    for (const [id, placement] of this.placements) {
      const host = this.frames.get(id)?.parentElement;
      if (!host) continue;
      const sameKey = location.keys.get(placement.anchor) === placement.key;
      const anchor = location.posts.includes(placement.anchor) && sameKey ? placement.anchor :
        placement.key ? byKey.get(placement.key) : location.posts[placement.index];
      if (!anchor || occupied.has(anchor)) {
        // A virtualized-out row has no current slot. Park its card until that exact
        // position returns; never clamp missing anchors to the bottom loading row.
        parkedCards.add(host); expectedPositions.delete(host); host.remove(); continue;
      }
      occupied.add(anchor); placement.anchor = anchor;
      this.placedAfter.set(anchor, location.keys.get(anchor) ?? ""); parkedCards.delete(host);
      const order = this.runtime.document.defaultView?.getComputedStyle(anchor).order || "0";
      if (host.style.order !== order) host.style.order = order;
      const before = anchor.nextSibling;
      if (before !== host || host.parentElement !== location.column) {
        const parent = location.column as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
        if (parent.moveBefore && host.isConnected) parent.moveBefore(host, before);
        else parent.insertBefore(host, before);
      }
      expectedPositions.set(host, { parent: location.column, next: host.nextSibling });
    }
  }
  private showNotice(message: string, location: FeedLocation): void {
    if (!this.notice?.isConnected) {
      this.notice = this.runtime.document.createElement("div");
      this.notice.setAttribute(FEED_ATTR, "notice");
      this.notice.setAttribute("role", "status");
      Object.assign(this.notice.style, { padding: "12px 16px", marginBottom: "12px", borderRadius: "12px", background: "#f6f7fb", color: "#5f6672", font: "14px/1.5 system-ui" });
      location.column.insertBefore(this.notice, location.posts[0] ?? null);
    }
    if (this.notice.textContent !== message) this.notice.textContent = message;
  }
  private async request(cursor?: string, limit = 5): Promise<FeedRequestReply> {
    const reply = await this.runtime.sendMessage({ type: "feed.request", payload: { limit, ...(cursor && { cursor }) } }) as { ok?: boolean; result?: FeedRequestReply };
    if (!reply?.ok || !reply.result) throw new Error("Feed unavailable");
    return reply.result;
  }
  private add(items: FeedRequestReply["items"], first = false): void {
    const ids: string[] = [];
    for (const { postId } of items) if (/^[A-Za-z0-9_-]{43}=?$/.test(postId) && !this.seen.has(postId)) { this.seen.add(postId); ids.push(postId); }
    this.queued = first ? [...ids, ...this.queued] : [...this.queued, ...ids];
  }
  async poll(): Promise<void> {
    const location = this.getLocation();
    if (!this.alive || this.busy || !location || this.runtime.document.visibilityState === "hidden" || this.now() < this.retryAt) return;
    this.busy = true;
    const generation = this.generation;
    const current = () => this.alive && generation === this.generation;
    try {
      const page = await this.request();
      if (!current()) return;
      this.lastPoll = this.now();
      this.enabled = page.enabled;
      if (!page.enabled) { this.removeCards(); return; }
      this.notice?.remove();
      const fresh = [...page.items];
      let cursor = page.nextCursor;
      if (this.initialized && this.seen.size) {
        for (let n = 0; cursor && !fresh.some((item) => this.seen.has(item.postId)) && n < 4; n++) {
          const next = await this.request(cursor, 20);
          if (!current()) return;
          fresh.push(...next.items);
          if (cursor === next.nextCursor) break;
          cursor = next.nextCursor;
        }
      }
      this.add(fresh, true);
      if (!this.initialized) {
        this.cursor = page.nextCursor;
        this.initialized = true;
      }
      if (!this.frames.size && !this.queued.length) this.showNotice(page.notice || "No Open Social posts yet. New posts will appear here.", location);
    } catch {
      this.retryAt = this.now() + 10_000;
      if (current() && !this.frames.size) this.showNotice("Open Social feed is temporarily unavailable. Retrying…", location);
    } finally { this.busy = false; }
    if (current()) this.place();
  }
  private place(): void {
    if (!this.enabled) return;
    const location = this.getLocation();
    if (!location) {
      // During a full host-feed refresh only skeletons may remain. Do not leave
      // old cards as an apparent feed of their own while native rows are absent.
      for (const frame of this.frames.values()) {
        const host = frame.parentElement;
        if (host) { parkedCards.add(host); expectedPositions.delete(host); host.remove(); }
      }
      this.reanchor = true;
      return;
    }
    if (this.reanchor) { this.anchorCards(location); this.reanchor = false; }
    const height = this.runtime.document.defaultView?.innerHeight ?? 800;
    for (let i = 0; i < location.posts.length && this.queued.length; i++) {
      const anchor = location.posts[i]!;
      if ((location.positions.get(anchor) ?? i + 1) % 3 !== 0) continue;
      const bounds = anchor.getBoundingClientRect();
      if (this.placedAfter.get(anchor) === (location.keys.get(anchor) ?? "") || bounds.bottom < 0 || bounds.top > height * 2) continue;
      this.insert(this.queued.shift()!, anchor, location);
      this.placedAfter.set(anchor, location.keys.get(anchor) ?? "");
    }
    if (this.reanchor) { this.anchorCards(location); this.reanchor = false; }
  }
  async scan(rediscover = true): Promise<HTMLElement | null> {
    if (rediscover) this.locationDirty = true;
    if (!this.alive || this.runtime.document.visibilityState === "hidden") return null;
    const href = this.runtime.document.location?.href ?? "";
    if (href !== this.href) { this.href = href; this.locationDirty = true; this.removeCards(); this.enabled = undefined; this.lastPoll = -Infinity; }
    // A removed individual card can be restored at its saved anchor without losing its place.
    if (!this.initialized && this.enabled !== false || this.now() - this.lastPoll >= 30_000) await this.poll();
    this.place();
    const location = this.getLocation();
    if (location && this.enabled && this.initialized && !this.busy && !this.queued.length && this.cursor && this.now() >= this.retryAt) {
      const ahead = location.posts.some((post, i) => (location.positions.get(post) ?? i + 1) % 3 === 0 && this.placedAfter.get(post) !== (location.keys.get(post) ?? "") && post.getBoundingClientRect().bottom >= 0 && post.getBoundingClientRect().top < (this.runtime.document.defaultView?.innerHeight ?? 800) * 2);
      if (ahead) {
        this.busy = true;
        const previous = this.cursor;
        const generation = this.generation;
        try {
          const page = await this.request(previous);
          if (this.alive && generation === this.generation && page.enabled) {
            this.cursor = page.nextCursor === previous ? null : page.nextCursor;
            this.add(page.items);
          }
        } catch { this.retryAt = this.now() + 10_000; }
        finally { this.busy = false; }
        if (this.alive) this.place();
      }
    }
    return this.runtime.document.querySelector<HTMLElement>(`[${FEED_ATTR}]`);
  }
  private removeCards(): void {
    this.generation++;
    for (const frame of this.frames.values()) frame.parentElement?.remove();
    this.frames.clear(); this.placements.clear(); this.notice?.remove(); this.queued = []; this.seen.clear();
    this.placedAfter = new WeakMap(); this.cursor = undefined; this.initialized = false;
  }
  stop(): void {
    this.alive = false;
    this.stopTheme();
    clearInterval(this.timer);
    clearTimeout(this.scrollTimer);
    this.runtime.document.defaultView?.removeEventListener("scroll", this.onScroll);
    this.runtime.document.defaultView?.removeEventListener("message", this.onMessage);
    this.runtime.document.defaultView?.removeEventListener("online", this.onScroll);
    this.runtime.document.removeEventListener("visibilitychange", this.onScroll);
    this.removeCards();
  }
}
export function maybeInsertFeedCards(runtime: FeedCardsRuntime): Promise<HTMLElement | null> {
  let controller = controllers.get(runtime.document);
  if (!controller) { controller = new FeedController(runtime); controllers.set(runtime.document, controller); }
  return controller.scan();
}
export function resetFeedCards(doc: Document): void { controllers.get(doc)?.stop(); controllers.delete(doc); }
