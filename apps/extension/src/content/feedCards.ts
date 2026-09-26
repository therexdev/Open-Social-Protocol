/** Scrolling host-feed placement. Only ids enter Facebook; content renders in extension iframes. */
import type { FeedRequestReply } from "../shared/protocol";
export const FEED_ATTR = "data-osp-feed";
export const FEED_TITLE = "Open Social posts";
const controllers = new WeakMap<Document, FeedController>();
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
  const eligible = (el: HTMLElement) => !el.closest(`[${FEED_ATTR}], [role="complementary"], aside, [role="dialog"]`) && doc.defaultView?.getComputedStyle(el).display !== "none";
  // Facebook can render another role=feed (recommendations) below its primary home lane.
  // Prefer real FeedUnit containers anywhere in main instead of picking that first role=feed.
  const units = [...main.querySelectorAll<HTMLElement>('[data-pagelet^="FeedUnit_"]')].filter(eligible);
  const candidates = units.length ? units.filter(el => !units.some(other => other !== el && other.contains(el))) :
    [...main.querySelectorAll<HTMLElement>('[role="article"]')].filter(el => eligible(el) && !el.parentElement?.closest('[role="article"]'));
  const locations: FeedLocation[] = [];
  for (const post of candidates) {
    let branch = post;
    for (let depth = 0; depth < 12 && branch.parentElement && branch.parentElement !== main; depth++) {
      const parent = branch.parentElement;
      const css = doc.defaultView?.getComputedStyle(parent);
      if (css?.display === "flex" && !css.flexDirection.startsWith("column")) break;
      const branches = [...parent.children].filter((child): child is HTMLElement =>
        !child.hasAttribute(FEED_ATTR) && candidates.some((candidate) => child === candidate || child.contains(candidate))) as HTMLElement[];
      if (branches.length > 1 || parent.getAttribute("role") === "feed") {
        if (!locations.some(location => location.column === parent)) locations.push({ column: parent, posts: branches });
        break;
      }
      branch = parent;
    }
  }
  if (locations.length) return locations.sort((a, b) => b.posts.length - a.posts.length)[0]!;
  const single = candidates.find((el) => el.matches('[data-pagelet^="FeedUnit_"]'));
  if (single?.parentElement && single.parentElement !== main) return { column: single.parentElement, posts: [single] };
  return null;
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
  private notice?: HTMLElement;
  private now: () => number;
  private href: string;
  private generation = 0;

  constructor(private runtime: FeedCardsRuntime) {
    this.now = runtime.now ?? Date.now;
    this.href = runtime.document.location?.href ?? "";
    this.timer = setInterval(() => { if (runtime.document.visibilityState !== "hidden") void this.poll(); }, 30_000);
    runtime.document.defaultView?.addEventListener("scroll", this.onScroll, { passive: true });
    runtime.document.defaultView?.addEventListener("message", this.onMessage);
    runtime.document.defaultView?.addEventListener("online", this.onScroll);
    runtime.document.addEventListener("visibilitychange", this.onScroll);
  }
  private onScroll = () => {
    if (this.scheduled || !this.alive) return;
    this.scheduled = true;
    const run = () => { this.scheduled = false; void this.scan(); };
    this.runtime.document.defaultView?.requestAnimationFrame ? this.runtime.document.defaultView.requestAnimationFrame(run) : setTimeout(run, 16);
  };
  private onMessage = (event: MessageEvent) => {
    if (event.data?.type !== "osp.card.height" || !Number.isFinite(event.data.height)) return;
    for (const frame of this.frames.values()) {
      const url = new URL(frame.src);
      if (event.source !== frame.contentWindow || event.origin !== `${url.protocol}//${url.host}`) continue;
      frame.style.height = `${Math.min(100000, Math.max(90, Math.ceil(event.data.height)))}px`;
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
    this.anchorCards(location);
  }
  /** React may insert/reorder native children around our unmanaged siblings. Keep every card
   * attached to its native post, including its CSS order, rather than letting it drift to the tail. */
  private anchorCards(location: FeedLocation): void {
    const groups = new Map<HTMLElement, { before: HTMLElement[]; after: HTMLElement[] }>();
    for (const [id, placement] of this.placements) {
      const host = this.frames.get(id)?.parentElement;
      if (!host) continue;
      if (!location.posts.includes(placement.anchor)) placement.anchor = location.posts[Math.min(placement.index, location.posts.length - 1)]!;
      const anchor = placement.anchor;
      if (!anchor) continue;
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
  }
  private showNotice(message: string, location: FeedLocation): void {
    if (!this.notice?.isConnected) {
      this.notice = this.runtime.document.createElement("div");
      this.notice.setAttribute(FEED_ATTR, "notice");
      this.notice.setAttribute("role", "status");
      Object.assign(this.notice.style, { padding: "12px 16px", marginBottom: "12px", borderRadius: "12px", background: "#f6f7fb", color: "#5f6672", font: "14px/1.5 system-ui" });
      location.column.insertBefore(this.notice, location.posts[0] ?? null);
    }
    this.notice.textContent = message;
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
    const location = findFeedLocation(this.runtime.document);
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
        const lane = findFeedLocation(this.runtime.document);
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
    const location = findFeedLocation(this.runtime.document);
    if (!location) return;
    this.anchorCards(location);
    const height = this.runtime.document.defaultView?.innerHeight ?? 800;
    for (let i = 2; i < location.posts.length && this.queued.length; i += 3) {
      const anchor = location.posts[i]!;
      const bounds = anchor.getBoundingClientRect();
      if (this.placedAfter.has(anchor) || bounds.bottom < 0 || bounds.top > height * 2) continue;
      this.insert(this.queued.shift()!, anchor, location, "after");
      this.placedAfter.add(anchor);
    }
  }
  async scan(): Promise<HTMLElement | null> {
    if (!this.alive || this.runtime.document.visibilityState === "hidden") return null;
    const href = this.runtime.document.location?.href ?? "";
    if (href !== this.href) { this.href = href; this.removeCards(); this.enabled = undefined; this.lastPoll = -Infinity; }
    if (this.frames.size && [...this.frames.values()].every((frame) => !frame.isConnected)) this.removeCards();
    // A removed individual card can be restored at its saved anchor without losing its place.
    if (!this.initialized && this.enabled !== false || this.now() - this.lastPoll >= 30_000) await this.poll();
    this.place();
    const location = findFeedLocation(this.runtime.document);
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
