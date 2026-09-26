/** Scrolling host-feed placement. Only ids enter Facebook; content renders in extension iframes. */
import type { FeedRequestReply } from "../shared/protocol";
export const FEED_ATTR = "data-osp-feed";
export const FEED_TITLE = "Open Social posts";
const controllers = new WeakMap<Document, FeedController>();
const expectedPositions = new WeakMap<Element, { parent: Element; next: Node | null }>();
export function feedCardNeedsRepair(element: Element): boolean {
  const expected = expectedPositions.get(element);
  return !element.isConnected || !!expected && (element.parentElement !== expected.parent || element.nextSibling !== expected.next);
}
export interface FeedCardsRuntime {
  document: Document;
  sendMessage: (message: unknown) => Promise<unknown> | unknown;
  frameUrl?: (postId: string) => string;
  now?: () => number;
}
export interface FeedLocation { column: HTMLElement; posts: HTMLElement[] }

/** Locate a vertical post lane; never prepend into the potentially horizontal main layout. */
export function findFeedLocation(doc: Document): FeedLocation | null {
  const main = doc.querySelector<HTMLElement>('[role="main"], main') ?? doc.body;
  if (!main) return null;
  // Loaded articles and FeedUnit placeholders coexist. Never let a placeholder-only suffix
  // hide the already-loaded posts above it. Collapse nested markers into one native post.
  const marker = '[data-pagelet^="FeedUnit_"], [role="article"]';
  const excluded = `[${FEED_ATTR}], [role="complementary"], aside, [role="dialog"], [hidden], [aria-hidden="true"]`;
  const candidates = [...main.querySelectorAll<HTMLElement>(marker)].filter(el =>
    !el.closest(excluded) && !el.parentElement?.closest(marker));
  const styles = new Map<HTMLElement, CSSStyleDeclaration>();
  const css = (el: HTMLElement) => {
    if (!styles.has(el)) styles.set(el, doc.defaultView!.getComputedStyle(el));
    return styles.get(el)!;
  };
  // Count immediate branches once per ancestor (linear in posts * bounded depth).
  const lanes = new Map<HTMLElement, Set<HTMLElement>>();
  for (const post of candidates) {
    if (css(post).display === "none") continue;
    let branch = post;
    for (let depth = 0; depth < 12 && branch.parentElement; depth++) {
      const parent = branch.parentElement;
      const style = css(parent);
      if (style.display === "none" || style.display === "flex" && !style.flexDirection.startsWith("column")) break;
      if (parent === main && parent.getAttribute("role") !== "feed") break;
      let branches = lanes.get(parent);
      if (!branches) { branches = new Set(); lanes.set(parent, branches); }
      branches.add(branch);
      branch = parent;
    }
  }
  let best: FeedLocation | null = null;
  for (const [column, branches] of lanes) {
    if (branches.size < 2 && column.getAttribute("role") !== "feed") continue;
    if (!best || branches.size > best.posts.length) best = { column, posts: [...branches] };
  }
  const single = candidates.find(el => el.matches('[data-pagelet^="FeedUnit_"]'));
  if (!best && single?.parentElement && single.parentElement !== main) best = { column: single.parentElement, posts: [single] };
  if (best) best.posts.sort((a, b) => (Number(css(a).order) || 0) - (Number(css(b).order) || 0));
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
  private placedAfter = new WeakSet<HTMLElement>();
  private frames = new Map<string, HTMLIFrameElement>();
  private placements = new Map<string, { anchor: HTMLElement; side: "before" | "after"; index: number }>();
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

  constructor(private runtime: FeedCardsRuntime) {
    this.now = runtime.now ?? Date.now;
    this.href = runtime.document.location?.href ?? "";
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
  private insert(postId: string, anchor: HTMLElement, location: FeedLocation, side: "before" | "after"): void {
    const doc = this.runtime.document;
    const frame = doc.createElement("iframe");
    const host = doc.createElement("section");
    host.setAttribute(FEED_ATTR, postId);
    host.setAttribute("aria-label", "Open Social post");
    Object.assign(host.style, { display: "block", width: "100%", minWidth: "0", boxSizing: "border-box", margin: "0 0 12px", flex: "0 0 auto", overflowAnchor: "none" });
    frame.src = this.runtime.frameUrl?.(postId) ?? `${chrome.runtime.getURL("src/embed/index.html")}#post=${encodeURIComponent(postId)}&host=${encodeURIComponent(doc.location.origin)}`;
    frame.title = "Open Social post";
    frame.loading = "lazy";
    frame.referrerPolicy = "origin";
    Object.assign(frame.style, { display: "block", width: "100%", height: "180px", border: "0", colorScheme: "normal" });
    host.append(frame);
    location.column.insertBefore(host, side === "before" ? anchor : anchor.nextSibling);
    this.frames.set(postId, frame);
    this.placements.set(postId, { anchor, side, index: location.posts.indexOf(anchor) });
    this.reanchor = true;
  }
  private getLocation(): FeedLocation | null {
    if (this.locationDirty || !this.location?.column.isConnected) {
      this.location = findFeedLocation(this.runtime.document);
      this.locationDirty = false;
      this.reanchor = true;
    }
    return this.location;
  }
  /** React may insert/reorder native children around our unmanaged siblings. Keep every card
   * attached to its native post, including its CSS order, rather than letting it drift to the tail. */
  private anchorCards(location: FeedLocation): void {
    const groups = new Map<HTMLElement, { before: HTMLElement[]; after: HTMLElement[] }>();
    for (const [id, placement] of this.placements) {
      const host = this.frames.get(id)?.parentElement;
      if (!host) continue;
      // The initial five belong before the first real post, even when a loading placeholder
      // was the only marker when we started. Other cards retain their native-post position.
      if (placement.side === "before") placement.anchor = location.posts[0]!;
      else if (!location.posts.includes(placement.anchor)) placement.anchor = location.posts[Math.min(placement.index, location.posts.length - 1)]!;
      const anchor = placement.anchor;
      if (!anchor) continue;
      if (placement.side === "after") this.placedAfter.add(anchor);
      const order = this.runtime.document.defaultView?.getComputedStyle(anchor).order || "0";
      if (host.style.order !== order) host.style.order = order;
      let group = groups.get(anchor);
      if (!group) { group = { before: [], after: [] }; groups.set(anchor, group); }
      group[placement.side].push(host);
    }
    const move = (host: HTMLElement, before: Node | null) => {
      if (host.parentElement === location.column && host.nextSibling === before) return;
      // moveBefore preserves an iframe's browsing context on browsers that support it.
      const parent = location.column as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
      if (parent.moveBefore && host.isConnected) parent.moveBefore(host, before);
      else parent.insertBefore(host, before);
    };
    for (const [anchor, group] of groups) {
      let before: Node = anchor;
      for (const host of [...group.before].reverse()) { move(host, before); before = host; }
      let previous: Node = anchor;
      for (const host of group.after) { if (previous.nextSibling !== host) move(host, previous.nextSibling); previous = host; }
    }
    for (const frame of this.frames.values()) {
      const host = frame.parentElement;
      if (host?.parentElement) expectedPositions.set(host, { parent: host.parentElement, next: host.nextSibling });
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
        const lane = this.getLocation();
        if (lane?.posts[0]) for (const id of this.queued.splice(0, 5)) this.insert(id, lane.posts[0], lane, "before");
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
    if (!location) return;
    if (this.reanchor) { this.anchorCards(location); this.reanchor = false; }
    const height = this.runtime.document.defaultView?.innerHeight ?? 800;
    for (let i = 2; i < location.posts.length && this.queued.length; i += 3) {
      const anchor = location.posts[i]!;
      const bounds = anchor.getBoundingClientRect();
      if (this.placedAfter.has(anchor) || bounds.bottom < 0 || bounds.top > height * 2) continue;
      this.insert(this.queued.shift()!, anchor, location, "after");
      this.placedAfter.add(anchor);
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
      const ahead = location.posts.some((post, i) => i % 3 === 2 && !this.placedAfter.has(post) && post.getBoundingClientRect().bottom >= 0 && post.getBoundingClientRect().top < (this.runtime.document.defaultView?.innerHeight ?? 800) * 2);
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
    this.placedAfter = new WeakSet(); this.cursor = undefined; this.initialized = false;
  }
  stop(): void {
    this.alive = false;
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
