/** Scrolling host-feed placement. Only ids enter Facebook; content renders in extension iframes. */
import type { FeedRequestReply } from "../shared/protocol";
export const FEED_ATTR = "data-osp-feed";
export const FEED_TITLE = "Open Social posts";
const POST_SELECTOR = '[data-pagelet^="FeedUnit_"], [role="article"]';
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
  const feed = main?.querySelector<HTMLElement>('[role="feed"]') ?? doc.querySelector<HTMLElement>('[role="feed"]');
  const area = feed ?? main;
  if (!area) return null;
  const candidates = [...area.querySelectorAll<HTMLElement>(POST_SELECTOR)].filter((el) =>
    !el.closest(`[${FEED_ATTR}], [role="complementary"], aside, [role="dialog"]`) &&
    !el.parentElement?.closest(POST_SELECTOR) && doc.defaultView?.getComputedStyle(el).display !== "none",
  );
  if (feed && candidates.length) {
    const branches = [...new Set(candidates.map((post) => {
      let branch = post;
      while (branch.parentElement && branch.parentElement !== feed) branch = branch.parentElement;
      return branch;
    }))];
    if (branches.length > 1 || candidates.length === 1 && branches[0] === candidates[0]) return { column: feed, posts: branches };
  }
  for (const post of candidates) {
    let branch = post;
    for (let depth = 0; depth < 7 && branch.parentElement && branch.parentElement !== main; depth++) {
      const parent = branch.parentElement;
      const branches = [...parent.children].filter((child): child is HTMLElement =>
        !child.hasAttribute(FEED_ATTR) && candidates.some((candidate) => child === candidate || child.contains(candidate))) as HTMLElement[];
      if (branches.length > 1) return { column: parent, posts: branches };
      branch = parent;
    }
  }
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
  private insert(postId: string, before: HTMLElement | null, column: HTMLElement): void {
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
    column.insertBefore(host, before);
    this.frames.set(postId, frame);
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
        if (lane) for (const id of this.queued.splice(0, 5)) this.insert(id, lane.posts[0] ?? null, lane.column);
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
    const height = this.runtime.document.defaultView?.innerHeight ?? 800;
    for (let i = 2; i < location.posts.length && this.queued.length; i += 3) {
      const anchor = location.posts[i]!;
      const bounds = anchor.getBoundingClientRect();
      if (this.placedAfter.has(anchor) || bounds.bottom < 0 || bounds.top > height * 2) continue;
      this.insert(this.queued.shift()!, anchor.nextElementSibling as HTMLElement | null, location.column);
      this.placedAfter.add(anchor);
    }
  }
  async scan(): Promise<HTMLElement | null> {
    if (!this.alive || this.runtime.document.visibilityState === "hidden") return null;
    const href = this.runtime.document.location?.href ?? "";
    if (href !== this.href) { this.href = href; this.removeCards(); this.enabled = undefined; this.lastPoll = -Infinity; }
    if (this.frames.size && [...this.frames.values()].every((frame) => !frame.isConnected)) this.removeCards();
    for (const [id, frame] of this.frames) if (!frame.isConnected) this.frames.delete(id);
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
    this.frames.clear(); this.notice?.remove(); this.queued = []; this.seen.clear();
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
