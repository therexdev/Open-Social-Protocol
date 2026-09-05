/**
 * Opening PostViews: plaintext (everyone) directly, friends-only through the key store.
 * Decryption happens in the service worker; a missing key is a normal state, not an error.
 */
import { AUDIENCE, LIFECYCLE, SUITE, decodeEnvelope, decryptContent, type Content } from "@osp/sdk";
import { bytesOf } from "../shared/bytes";
import type { PostView } from "../shared/indexer";
import type { FeedItem, PostContentStatus } from "../shared/protocol";
import type { KeyResolverIdentity, KeySource, KeyStore } from "./keystore";

export interface OpenContext {
  chainId: string;
  keys?: KeyStore;
  me?: KeyResolverIdentity;
  keySource?: KeySource;
}

export interface OpenedPost {
  status: PostContentStatus;
  content?: Content;
  message?: string;
}

/** Decrypts or decodes a post for display. Never throws. */
export async function openPost(post: PostView, ctx: OpenContext): Promise<OpenedPost> {
  if (post.state === LIFECYCLE.DELETED) return { status: "tombstone", message: post.stateReason || "This post was deleted by its author." };
  if (post.state === LIFECYCLE.AUTHOR_HIDDEN) return { status: "hidden", message: post.stateReason || "The author hid this post." };
  if (post.state === LIFECYCLE.UNAVAILABLE) return { status: "unavailable", message: post.stateReason || "This post is unavailable." };
  const bytes = bytesOf(post.envelope);
  if (bytes.length === 0) return { status: "error", message: "The indexer did not provide this post's content." };
  let envelope;
  try {
    envelope = decodeEnvelope(bytes);
  } catch {
    return { status: "error", message: "This post is not readable by this client version." };
  }
  if (envelope.suite === SUITE.PLAINTEXT) {
    try {
      return { status: "plain", content: decryptContent({ envelope }) };
    } catch {
      return { status: "error", message: "This post's content could not be decoded." };
    }
  }
  if (!ctx.keys || !ctx.me || !ctx.keySource) return { status: "locked", message: "Unlock your account to read friends-only posts." };
  if (post.audience !== AUDIENCE.FRIENDS && post.audience !== AUDIENCE.CUSTOM) return { status: "error", message: "Unknown audience." };
  const ref = { author: post.author, audienceId: bytesOf(post.audienceId), epoch: post.epoch };
  const epochKey = await ctx.keys.resolve(ref, ctx.me, ctx.keySource);
  if (!epochKey) return { status: "no-key", message: "You do not have the key for this post (not shared with you, or not indexed yet)." };
  try {
    const aad = {
      chainId: ctx.chainId,
      author: post.author,
      postId: bytesOf(post.postId),
      audience: post.audience,
      audienceId: ref.audienceId,
      epoch: post.epoch,
      versionNumber: post.versionNumber,
    };
    return { status: "decrypted", content: decryptContent({ envelope, aad, epochKey }) };
  } catch {
    return { status: "error", message: "The post could not be decrypted with the key you hold." };
  }
}

export function toFeedItem(post: PostView, opened: OpenedPost): FeedItem {
  return {
    postId: post.postId,
    author: post.author,
    audience: post.audience,
    epoch: post.epoch,
    createdAt: post.createdAt,
    versionNumber: post.versionNumber,
    status: opened.status,
    ...(opened.content?.text !== undefined && { text: opened.content.text }),
    ...(opened.content?.external_ref && { externalRef: opened.content.external_ref }),
    ...(opened.message && { message: opened.message }),
    reactions: post.reactions?.total ?? 0,
    replyCount: post.replyCount ?? 0,
    labels: (post.labels ?? []).map((label) => ({ communityId: label.communityId, label: label.label, reason: label.reason })),
  };
}
