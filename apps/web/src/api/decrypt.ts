/**
 * Opening PostViews: plaintext (everyone) directly, friends-only through the key store.
 * Decryption happens on the device; a missing key is a normal state, not an error.
 */
import { LIFECYCLE, SUITE, decodeEnvelope, decryptContent, type MediaItem } from "@osp/sdk";
import { bytesOf } from "../util/bytes";
import type { KeyResolverIdentity, KeySource, KeyStore } from "./keystore";
import type { PostView } from "./indexer";

export interface OpenedContent {
  version: number;
  text: string;
  mime: string;
  lang: string;
  created_at: string;
  external_ref: string;
  media: Required<MediaItem>[];
}

export type PostContent =
  | { status: "plain" | "decrypted"; content: OpenedContent }
  | { status: "tombstone" | "hidden" | "unavailable"; reason?: string }
  | { status: "no-key" | "locked" | "error"; message: string };

export interface OpenContext {
  chainId: string;
  keys?: KeyStore;
  me?: KeyResolverIdentity;
  keySource?: KeySource;
}

/** Decrypts or decodes a post for display. Never throws. */
export async function openPost(post: PostView, ctx: OpenContext): Promise<PostContent> {
  if (post.state === LIFECYCLE.DELETED) return { status: "tombstone", ...(post.stateReason && { reason: post.stateReason }) };
  if (post.state === LIFECYCLE.AUTHOR_HIDDEN) return { status: "hidden", ...(post.stateReason && { reason: post.stateReason }) };
  if (post.state === LIFECYCLE.UNAVAILABLE) return { status: "unavailable", ...(post.stateReason && { reason: post.stateReason }) };
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
      return { status: "plain", content: decryptContent({ envelope }) as OpenedContent };
    } catch {
      return { status: "error", message: "This post is not readable by this client version." };
    }
  }
  if (envelope.suite !== SUITE.XCHACHA20POLY1305_X25519) {
    return { status: "error", message: "This post uses an encryption suite this client does not support." };
  }
  if (!ctx.keys || !ctx.me) return { status: "locked", message: "Unlock your account to read friends-only posts." };
  const audienceId = bytesOf(post.audienceId);
  const ref = { author: post.author, audienceId, epoch: post.epoch };
  const epochKey = ctx.keySource ? await ctx.keys.resolve(ref, ctx.me, ctx.keySource) : ctx.keys.get(ref);
  if (!epochKey) {
    const who = post.author === ctx.me.account ? "this device has not received the key for this post yet" : "you do not have the key for this post yet";
    return { status: "no-key", message: `Friends-only post: ${who}.` };
  }
  try {
    const content = decryptContent({
      envelope,
      epochKey,
      aad: {
        chainId: ctx.chainId,
        author: post.author,
        postId: bytesOf(post.postId),
        audience: post.audience,
        audienceId,
        epoch: post.epoch,
        versionNumber: post.versionNumber,
      },
    }) as OpenedContent;
    return { status: "decrypted", content };
  } catch {
    return { status: "error", message: "This post could not be decrypted with the key you have." };
  }
}
