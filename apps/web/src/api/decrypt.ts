/**
 * Opening PostViews: plaintext (everyone) directly, friends-only through the key store.
 * Decryption happens on the device; a missing key is a normal state, not an error.
 */
import { LIFECYCLE, SUITE, bytesEqual, contentHash, decodeEnvelope, decryptContent, type AadInput, type Envelope, type MediaItem, type ProtocolClient } from "@osp/sdk";
import { bytesOf } from "../util/bytes";
import type { KeyResolverIdentity, KeySource, KeyStore, KeyVerifier } from "./keystore";
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
  /** Checks on chain where a sealed key served by the indexer came from (keyProvenance.ts). */
  verify?: KeyVerifier;
  chain?: Pick<ProtocolClient, "reads">;
}

function tryDecrypt(envelope: Envelope, epochKey: Uint8Array, aad: AadInput): OpenedContent | undefined {
  try {
    return decryptContent({ envelope, epochKey, aad }) as OpenedContent;
  } catch {
    return undefined;
  }
}

/** Decrypts or decodes a post for display. Never throws. */
export async function openPost(post: PostView, ctx: OpenContext): Promise<PostContent> {
  if (ctx.chain) {
    try {
      const record = (await ctx.chain.reads.publications.get_post({ post_id: bytesOf(post.postId) }))?.value;
      if (!record) return { status: "error", message: "This post is awaiting network confirmation. Checking again automatically." };
      if (record.state === LIFECYCLE.DELETED) return { status: "tombstone" };
      if (record.state === LIFECYCLE.AUTHOR_HIDDEN) return { status: "hidden" };
      if (record.state === LIFECYCLE.UNAVAILABLE) return { status: "unavailable" };
      if (record.author !== post.author || record.audience !== post.audience || record.version_count !== post.versionNumber || !bytesEqual(record.latest_version, bytesOf(post.contentHash))) {
        return { status: "error", message: "The feed has not supplied the current verified version of this post. Refresh the feed to check again." };
      }
    } catch {
      return { status: "error", message: "This post could not be verified while the network is unavailable. Checking again automatically." };
    }
  }
  if (post.state === LIFECYCLE.DELETED) return { status: "tombstone", ...(post.stateReason && { reason: post.stateReason }) };
  if (post.state === LIFECYCLE.AUTHOR_HIDDEN) return { status: "hidden", ...(post.stateReason && { reason: post.stateReason }) };
  if (post.state === LIFECYCLE.UNAVAILABLE) return { status: "unavailable", ...(post.stateReason && { reason: post.stateReason }) };
  const bytes = bytesOf(post.envelope);
  if (bytes.length === 0) return { status: "error", message: "The indexer did not provide this post's content." };
  if (!bytesEqual(contentHash(bytes), bytesOf(post.contentHash))) return { status: "error", message: "This post's content does not match its published fingerprint." };
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
  const entry = ctx.keySource ? await ctx.keys.resolve(ref, ctx.me, ctx.keySource, { ...(ctx.verify && { verify: ctx.verify }) }) : ctx.keys.entry(ref);
  if (!entry) {
    const who = post.author === ctx.me.account ? "this device has not received the key for this post yet" : "you do not have the key for this post yet";
    return { status: "no-key", message: `Friends-only post: ${who}. Friends receive access to older posts too when the author opens the app to finish sharing. This post will check again automatically.` };
  }
  const aad: AadInput = {
    chainId: ctx.chainId,
    author: post.author,
    postId: bytesOf(post.postId),
    audience: post.audience,
    audienceId,
    epoch: post.epoch,
    versionNumber: post.versionNumber,
  };
  const content = tryDecrypt(envelope, entry.key, aad);
  if (content) return { status: "decrypted", content };
  // The cached key does not fit this envelope: try the other sealed copies addressed to us.
  if (ctx.keySource) {
    let candidates: Awaited<ReturnType<KeyStore["candidates"]>> = [];
    try {
      candidates = await ctx.keys.candidates(ref, ctx.me, ctx.keySource);
    } catch {
      // indexer unreachable: report with what we have
    }
    for (const candidate of candidates) {
      if (bytesEqual(candidate.key, entry.key)) continue;
      const opened = tryDecrypt(envelope, candidate.key, aad);
      if (!opened) continue;
      // Replace an unverified cache entry with the key that actually opens the author's posts.
      if (!entry.trusted) await ctx.keys.adopt(ref, candidate, ctx.verify);
      return { status: "decrypted", content: opened };
    }
  }
  // Never keep an unverified key that does not open the author's posts.
  if (!entry.trusted) await ctx.keys.forget(ref);
  return { status: "error", message: "This post could not be decrypted with the key you have." };
}
