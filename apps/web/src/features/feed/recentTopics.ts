import { LIFECYCLE, SUITE, bytesEqual, contentHash, decodeEnvelope, decryptContent, parseContentReference, resolvePostText, type ProtocolClient } from "@osp/sdk";
import type { IndexerClient } from "../../api/indexer";
import { bytesOf } from "../../util/bytes";
import { extractHashtags } from "../../util/postText";

export interface RecentTopic { tag: string; posts: number; lastUsed: number }
export interface TopicsSnapshot { topics: RecentTopic[]; loading: boolean; unavailable: boolean }
/** Bounded public-only discovery. Cache extracted tags by content fingerprint so
 * polling the feed doesn't download the same long R2 bodies again. */
export class RecentTopics {
  private snapshot: TopicsSnapshot = { topics: [], loading: true, unavailable: false };
  private listeners = new Set<() => void>();
  private tags = new Map<string, string[]>();
  private pending?: Promise<void>;
  private lastRead = 0;
  constructor(private indexer: IndexerClient, private protocol?: ProtocolClient) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: TopicsSnapshot) { this.snapshot = snapshot; for (const listener of this.listeners) listener(); }
  refresh(force = false): Promise<void> {
    if (this.pending) return this.pending;
    if (!force && Date.now() - this.lastRead < 25_000) return Promise.resolve();
    const run = async () => {
      if (!this.indexer.configured) { this.publish({ topics: [], loading: false, unavailable: true }); return; }
      try {
        const page = await this.indexer.feed({ scope: "public", limit: 30 });
        const posts = [...new Map(page.items.filter(p => p.audience === 0 && p.state === LIFECYCLE.ACTIVE && !p.collectionId && !p.galleryOnly && !p.replyTo).map(p => [p.postId, p])).values()];
        const found = new Map<string, RecentTopic>();
        let cursor = 0;
        const worker = async () => {
          while (cursor < posts.length) {
            const post = posts[cursor++]!;
            let tags = this.tags.get(post.contentHash);
            if (!tags) {
              try {
                let bytes = bytesOf(post.envelope);
                const ref = parseContentReference(bytes);
                if (ref) { const load = this.protocol?.contracts.contentLoader; if (!load) continue; bytes = await load(ref); }
                if (!bytesEqual(contentHash(bytes), bytesOf(post.contentHash)) || decodeEnvelope(bytes).suite !== SUITE.PLAINTEXT) continue;
                const content = await resolvePostText(decryptContent({ envelope: bytes }), false);
                tags = extractHashtags(content.text ?? ""); this.tags.set(post.contentHash, tags);
              } catch { continue; } // An unavailable file must not block other public topics.
            }
            for (const tag of tags) {
              const topic = found.get(tag) ?? { tag, posts: 0, lastUsed: 0 };
              topic.posts++; topic.lastUsed = Math.max(topic.lastUsed, Number(post.updatedAt || post.createdAt) || Number(post.createdAt) || 0); found.set(tag, topic);
            }
          }
        };
        await Promise.all([worker(), worker()]);
        while (this.tags.size > 150) this.tags.delete(this.tags.keys().next().value!);
        this.lastRead = Date.now();
        this.publish({ topics: [...found.values()].sort((a,b) => b.lastUsed - a.lastUsed || b.posts - a.posts || a.tag.localeCompare(b.tag)).slice(0,8), loading: false, unavailable: false });
      } catch { this.publish({ topics: [], loading: false, unavailable: true }); }
    };
    this.pending = run().finally(() => { this.pending = undefined; }); return this.pending;
  }
}
const services = new WeakMap<IndexerClient, RecentTopics>();
export function recentTopics(indexer: IndexerClient, protocol?: ProtocolClient) {
  let store = services.get(indexer); if (!store) { store = new RecentTopics(indexer, protocol); services.set(indexer, store); }
  return store;
}
