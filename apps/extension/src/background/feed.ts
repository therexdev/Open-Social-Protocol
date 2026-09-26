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
import { decodeProfile } from "@osp/sdk";
import { bytesOf } from "../shared/bytes";

export interface FeedDeps {
  clients: () => Promise<Clients>;
  session: () => Promise<UnlockedSession | undefined>;
  keys: (session: UnlockedSession) => Promise<KeyStore>;
  vault: VaultManager;
  now?: () => number;
  ttlMs?: number;
}

export class FeedService {
  private readonly cache = new Map<string, { at: number; page: FeedPage }>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly deps: FeedDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.ttlMs = deps.ttlMs ?? 20_000;
  }

  invalidate(): void {
    this.cache.clear();
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
    for (const post of raw.items ?? []) {
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
    return { items: raw.items.map(({ postId }) => ({ postId })), nextCursor: raw.nextCursor ?? null };
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
