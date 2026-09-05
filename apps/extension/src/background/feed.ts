/**
 * Feed reads: indexer pages opened with the key store (friends-only posts decrypted here, in the
 * service worker). Cached briefly in memory; a content script only ever receives the plaintext
 * of everyone-audience posts.
 */
import { SUITE, decodeEnvelope, decryptContent } from "@osp/sdk";
import { bytesOf } from "../shared/bytes";
import type { PostView } from "../shared/indexer";
import type { FeedItem, FeedPage, FeedRequestReply, FeedScope } from "../shared/protocol";
import type { Clients } from "./clients";
import { openPost, toFeedItem } from "./decrypt";
import type { KeyStore } from "./keystore";
import type { UnlockedSession, VaultManager } from "./vault";

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
      const opened = await openPost(post, { chainId, keys, me, keySource: clients.indexer });
      items.push(toFeedItem(post, opened));
    }
    const page: FeedPage = { items, nextCursor: raw.nextCursor ?? null };
    this.cache.set(key, { at: this.now(), page });
    return page;
  }

  /** Up to `limit` public posts with plaintext, for the labeled host-feed cards. */
  async publicPreview(limit = 5): Promise<FeedRequestReply["items"]> {
    const clients = await this.deps.clients();
    const raw = await clients.indexer.feed({ scope: "public", limit: Math.min(Math.max(limit, 1), 5) });
    const items: FeedRequestReply["items"] = [];
    for (const post of raw.items ?? []) {
      const text = plaintextOf(post);
      if (text !== undefined) items.push({ postId: post.postId, author: post.author, text, createdAt: post.createdAt });
    }
    return items;
  }
}

function plaintextOf(post: PostView): string | undefined {
  if (post.state !== 0) return undefined;
  try {
    const envelope = decodeEnvelope(bytesOf(post.envelope));
    if (envelope.suite !== SUITE.PLAINTEXT) return undefined;
    return decryptContent({ envelope }).text ?? "";
  } catch {
    return undefined;
  }
}
