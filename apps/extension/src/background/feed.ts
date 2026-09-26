/**
 * Feed reads: indexer pages opened with the key store (friends-only posts decrypted here, in the
 * service worker). Content scripts only receive post identifiers. Decrypted card content goes
 * directly to read-only extension frames, never into the host page's DOM or messages.
 */
import type { FeedItem, FeedPage, FeedRequestReply, FeedScope } from "../shared/protocol";
import type { Clients } from "./clients";
import { openPost, toFeedItem } from "./decrypt";
import type { KeyStore } from "./keystore";
import type { UnlockedSession, VaultManager } from "./vault";
import { type Promotion, decodeProfile, eligiblePromotion, insertPromotions, promotionKey } from "@osp/sdk";
import type { PostView } from "../shared/indexer";
import type { KeyValueArea } from "../shared/storage";
import { bytesOf } from "../shared/bytes";

export interface FeedDeps {
  clients: () => Promise<Clients>;
  session: () => Promise<UnlockedSession | undefined>;
  keys: (session: UnlockedSession) => Promise<KeyStore>;
  vault: VaultManager;
  now?: () => number;
  ttlMs?: number;
  promotionStorage?: KeyValueArea;
}

export class FeedService {
  private readonly cache = new Map<string, { at: number; page: FeedPage }>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly promotionCache = new Map<string, { at: number; items: PostView[] }>();
  private readonly organicSeen = new Map<string, Set<string>>();
  private readonly promotionCredit = new Map<string, number>();
  private readonly selected = new Map<string, Record<string, { nonce: string; opportunity: string }>>();
  private boardCache?: { at: number; value: Promise<{values: Promotion[]; block: string} | undefined> };
  private readonly promotionSeen = new Map<string, Set<string>>();


  constructor(private readonly deps: FeedDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.ttlMs = deps.ttlMs ?? 20_000;
  }

  invalidate(): void {
    this.cache.clear();
    this.promotionCache.clear();
    this.boardCache = undefined;
  }

  async page(scope: FeedScope, cursor?: string, options: { limit?: number; refresh?: boolean } = {}): Promise<FeedPage> {
    const session = await this.deps.session();
    const key = `${scope}|${session?.account ?? ""}|${cursor ?? ""}|${options.limit ?? ""}`;
    const cached = this.cache.get(key);
    if (cached && !options.refresh && this.now() - cached.at < this.ttlMs) return cached.page;
    const clients = await this.deps.clients();
    if (scope === "friends" && !session) return { items: [], nextCursor: null, notice: "Unlock your account to see friends-only posts." };
    const raw = await clients.indexer.feed({ ...(session && { viewer: session.account }), scope, cursor, limit: options.limit ?? 20 });
    const chainId = clients.resolved.chainId ?? "";
    const keys = session ? await this.deps.keys(session) : undefined;
    const me = session ? { account: session.account, encryption: this.deps.vault.encryption(session) } : undefined;
    const items: FeedItem[] = [];
    const posts = await this.withPromotions(raw.items ?? [], scope, clients, session);
    for (const post of posts) {
      const opened = await openPost(post, { chainId, chain: clients.protocol, keys, me, keySource: clients.indexer });
      items.push(toFeedItem(post, opened));
    }
    const page: FeedPage = { items, nextCursor: raw.nextCursor ?? null };
    this.cache.set(key, { at: this.now(), page });
    return page;
  }

  /** Host scripts receive identifiers, never decrypted content or profile/account details. */
  async references(scope: "public" | "friends" | "all", cursor?: string, limit = 5): Promise<Omit<FeedRequestReply, "enabled">> {
    const session = await this.deps.session();
    if (scope === "friends" && !session) return { items: [], nextCursor: null, notice: "Unlock Open Social to see your friends’ posts." };
    const clients = await this.deps.clients();
    const raw = await clients.indexer.feed({ scope: session ? scope : "public", ...(session && { viewer: session.account }), cursor, limit });
    const posts = await this.withPromotions(raw.items, scope, clients, session);
    return { items: posts.map(({ postId }) => ({ postId })), nextCursor: raw.nextCursor ?? null };
  }

  private promotionBoard(clients: Clients) {
    if (!this.boardCache || this.now() - this.boardCache.at >= 30000) this.boardCache = { at: this.now(), value: clients.protocol?.reads.token.get_promotions({}) ?? Promise.resolve(undefined) };
    return this.boardCache.value;
  }
  private async withPromotions(posts: PostView[], scope: string, clients: Clients, session?: UnlockedSession): Promise<PostView[]> {
    if (!clients.protocol || posts.length < 3) return posts;
    const key = `osp.promotion-delivery:${clients.resolved.chainId}:${session?.account ?? "guest"}`;
    try {
      let cached = this.promotionCache.get(`${key}:${scope}`);
      if (!cached || this.now() - cached.at >= 30000) {
        const [page, board] = await Promise.all([clients.indexer.promotions(session?.account, scope), this.promotionBoard(clients)]);
        cached = { at: this.now(), items: board ? page.items.map(p => eligiblePromotion(p, board.values, BigInt(board.block))).filter((p): p is PostView => !!p) : [] };
        this.promotionCache.set(`${key}:${scope}`, cached);
      }
      let seen = this.promotionSeen.get(key);
      if (!seen) { seen = new Set(await this.deps.promotionStorage?.get<string[]>(key) ?? []); this.promotionSeen.set(key,seen); }
      const organic = this.organicSeen.get(key) ?? new Set<string>();
      let credit = this.promotionCredit.get(key) ?? 7; // First placement after three organic posts, then one per ten new posts.
      for (const p of posts) if (!organic.has(p.postId)) { organic.add(p.postId); credit++; }
      this.organicSeen.set(key,organic);
      const mixed = insertPromotions(posts, cached.items, seen, Math.min(2, Math.floor(credit / 10)));
      const selected = this.selected.get(key) ?? await this.deps.promotionStorage?.get<Record<string, {nonce: string; opportunity: string}>>(key + ":selected") ?? {};
      for (const p of mixed) if (p.promoted) { seen.add(promotionKey(p)); selected[p.postId] = p.promoted; credit -= 10; }
      this.promotionCredit.set(key,Math.min(credit,20));
      this.selected.set(key,selected);
      await this.deps.promotionStorage?.set(key,[...seen].slice(-1000));
      await this.deps.promotionStorage?.set(key + ":selected",Object.fromEntries(Object.entries(selected).slice(-100)));
      return mixed;
    } catch {
      // Older indexers keep the existing feed usable until their economy upgrade.
      this.promotionCache.set(`${key}:${scope}`,{at:this.now(),items:[]});
      return posts;
    }
  }

  /** Read-only embedded extension page: same verification/decryption as the side-panel feed. */
  async card(postId: string): Promise<FeedItem | undefined> {
    const clients = await this.deps.clients();
    const session = await this.deps.session();
    const post = await clients.indexer.post(postId, session?.account);
    if (!post) return undefined;
    const keys = session ? await this.deps.keys(session) : undefined;
    const opened = await openPost(post, { chainId: clients.resolved.chainId ?? "", chain: clients.protocol, keys,
      me: session ? { account: session.account, encryption: this.deps.vault.encryption(session) } : undefined, keySource: clients.indexer });
    const key = `osp.promotion-delivery:${clients.resolved.chainId}:${session?.account ?? "guest"}`;
    const selected = this.selected.get(key) ?? await this.deps.promotionStorage?.get<Record<string, {nonce: string; opportunity: string}>>(key + ":selected");
    const chosen = selected?.[postId];
    if (chosen) {
      try {
        const board = await this.promotionBoard(clients);
        const promoted = board && eligiblePromotion(post, board.values, BigInt(board.block));
        if (promoted?.promoted?.nonce === chosen.nonce && promoted.promoted.opportunity === chosen.opportunity) post.promoted = chosen;
      } catch { /* Never claim paid placement without current canonical verification. */ }
    }
    const item = toFeedItem(post, opened);
    item.viewer = session?.account;
    try {
      const profile = await clients.indexer.profile(post.author);
      const prefix = "data:application/x-osp-profile;base64,";
      if (profile?.profileUri.startsWith(prefix)) item.authorName = decodeProfile(bytesOf(profile.profileUri.slice(prefix.length))).display_name;
    } catch { /* Keep the post readable if only its profile is unavailable. */ }
    // A lock while the network request was running must not restore decrypted content.
    const current = await this.deps.session();
    if (opened.status === "decrypted" && current?.account !== session?.account) return { ...item, text: undefined, media: undefined, externalRef: undefined, status: "locked", message: "Unlock Open Social to read this post." };
    return item;
  }
}
