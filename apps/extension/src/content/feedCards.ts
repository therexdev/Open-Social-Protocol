/**
 * Optional labeled feed insertion (off by default): one container "Open Social Protocol posts"
 * at the top of the host's main feed with up to 5 public posts fetched through the service
 * worker. Text only (textContent), no HTML from the posts, no scripts, no inline handlers.
 */
export const FEED_ATTR = "data-osp-feed";
export const FEED_TITLE = "Open Social Protocol posts";

export interface FeedCardsRuntime {
  document: Document;
  sendMessage: (message: unknown) => Promise<unknown> | unknown;
}

interface FeedReply {
  ok?: boolean;
  result?: { enabled?: boolean; items?: Array<{ postId: string; author: string; text: string; createdAt: string }> };
}

const pending = new WeakMap<Document, { enabled: boolean; items: NonNullable<FeedReply["result"]>["items"] } | Promise<unknown>>();

function style(el: HTMLElement, css: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, css);
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function findFeedRoot(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('[role="feed"]') ?? doc.querySelector<HTMLElement>("main");
}

export function buildFeedContainer(doc: Document, items: NonNullable<FeedReply["result"]>["items"] = []): HTMLElement {
  const section = doc.createElement("section");
  section.setAttribute(FEED_ATTR, "1");
  section.setAttribute("role", "region");
  section.setAttribute("aria-label", FEED_TITLE);
  style(section, { margin: "8px 0 16px", padding: "12px", border: "1px dashed #5e84ff", borderRadius: "10px", background: "#f3f6ff", color: "#1b2340", font: "14px/1.4 system-ui, sans-serif" });
  const header = doc.createElement("div");
  style(header, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontWeight: "600" });
  const title = doc.createElement("span");
  title.textContent = FEED_TITLE;
  const badge = doc.createElement("span");
  badge.textContent = "from the protocol, not from this site";
  style(badge, { fontWeight: "400", fontSize: "12px", opacity: "0.7" });
  header.append(title, badge);
  section.append(header);
  if (items.length === 0) {
    const emptyNote = doc.createElement("div");
    emptyNote.textContent = "No public posts yet.";
    section.append(emptyNote);
  }
  for (const item of items.slice(0, 5)) {
    const article = doc.createElement("article");
    style(article, { padding: "8px 0", borderTop: "1px solid #d9e0ff" });
    const author = doc.createElement("div");
    author.textContent = shortAddress(item.author);
    style(author, { fontSize: "12px", opacity: "0.7" });
    const body = doc.createElement("p");
    body.textContent = item.text;
    style(body, { margin: "4px 0 0", whiteSpace: "pre-wrap" });
    article.append(author, body);
    section.append(article);
  }
  return section;
}

/** Inserts the labeled container once the feed root exists; asks the service worker at most once per page. */
export async function maybeInsertFeedCards(runtime: FeedCardsRuntime): Promise<HTMLElement | null> {
  const doc = runtime.document;
  const existing = doc.querySelector<HTMLElement>(`[${FEED_ATTR}]`);
  if (existing) return existing;
  // No feed on this page (composer-only views, settings, ...): do not even ask the service worker.
  if (!findFeedRoot(doc)) return null;
  let state = pending.get(doc);
  if (!state) {
    const request = Promise.resolve(runtime.sendMessage({ type: "feed.request", payload: { limit: 5 } }))
      .then((reply) => {
        const r = reply as FeedReply | undefined;
        const resolved = { enabled: r?.ok === true && r.result?.enabled === true, items: r?.result?.items ?? [] };
        pending.set(doc, resolved);
        return resolved;
      })
      .catch(() => {
        const resolved = { enabled: false, items: [] };
        pending.set(doc, resolved);
        return resolved;
      });
    pending.set(doc, request);
    state = request;
  }
  const resolved = state instanceof Promise ? ((await state) as { enabled: boolean; items: NonNullable<FeedReply["result"]>["items"] }) : state;
  if (!resolved.enabled) return null;
  if (doc.querySelector(`[${FEED_ATTR}]`)) return doc.querySelector<HTMLElement>(`[${FEED_ATTR}]`);
  const root = findFeedRoot(doc);
  if (!root) return null;
  const container = buildFeedContainer(doc, resolved.items);
  root.insertBefore(container, root.firstChild);
  return container;
}

/** Test helper: forget the cached reply for a document. */
export function resetFeedCards(doc: Document): void {
  pending.delete(doc);
}
