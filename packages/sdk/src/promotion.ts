import { toBase64url } from "./encoding.js";
import type { Promotion } from "./client/types.js";

export interface PromotionCandidate {
  postId: string; contentHash: string; author: string; audience: number; state: number;
  promoted?: { nonce: string; opportunity: string };
}
/** Verify a replaceable indexer's campaign against the canonical bounded board. */
export function eligiblePromotion<T extends PromotionCandidate>(post: T, board: Promotion[], block: bigint, muted: readonly string[] = []): T | undefined {
  if (post.state !== 0 || post.audience !== 0 || muted.includes(post.author)) return undefined;
  const p = board.find(p => toBase64url(p.post_id) === post.postId);
  if (!p || p.cancelled || p.author !== post.author || toBase64url(p.version) !== post.contentHash || BigInt(p.start_block) > block || BigInt(p.end_block) <= block || BigInt(p.interval) <= 0n) return undefined;
  return { ...post, promoted: { nonce: p.nonce, opportunity: ((block - BigInt(p.start_block)) / BigInt(p.interval)).toString() } };
}
export function promotionKey(post: PromotionCandidate): string {
  return `${post.postId}:${post.promoted?.nonce ?? ""}:${post.promoted?.opportunity ?? ""}`;
}
/** Preserve chronological ordering/cursors and never duplicate an organic post. */
export function insertPromotions<T extends PromotionCandidate>(organic: readonly T[], candidates: readonly T[], seen: ReadonlySet<string>, max = 2): T[] {
  const ids = new Set(organic.map(p => p.postId));
  const eligible = candidates.filter(p => {
    if (!p.promoted || ids.has(p.postId) || seen.has(promotionKey(p))) return false;
    ids.add(p.postId); return true;
  }).slice(0, max);
  const result: T[] = [];
  for (let i = 0; i < organic.length; i++) {
    result.push(organic[i]!);
    if (i >= 2 && (i - 2) % 10 === 0 && eligible.length) result.push(eligible.shift()!);
  }
  return result;
}
