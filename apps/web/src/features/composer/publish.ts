/**
 * Builds the operations for a publication (spec sections 2, 5, 6):
 *  - everyone: suite-0 envelope, `publish`;
 *  - friends: read relationships.get_audience for the epoch, reuse or create the epoch key,
 *    seal it to every active friend (+ self) and submit [distribute_keys..., publish] in ONE
 *    transaction.
 * The idempotency key derives from a persisted attempt id; callers never republish blindly
 * (see `findExistingPost`).
 */
import {
  AUDIENCE,
  LIMITS,
  buildKeyPackageSets,
  contentHash as sha256Envelope,
  encodeContent,
  encryptContent,
  idempotencyKey,
  newEpochKey,
  postId as computePostId,
  type Content,
  type DistributeKeysArgs,
  type MediaRefInput,
  type OperationJson,
  type PublishArgs,
  type Recipient,
  type Rng,
} from "@osp/sdk";
import type { KeyStore } from "../../api/keystore";
import { bytesOf, fromHex, toBase64url } from "../../util/bytes";

/** The parts of ProtocolClient the composer needs (mockable). */
export interface PublishChain {
  chainId: string;
  ops: {
    publications: {
      publish(args: PublishArgs): Promise<OperationJson>;
      distribute_keys(args: DistributeKeysArgs): Promise<OperationJson>;
    };
  };
  reads: {
    relationships: { get_audience(args: { account: string }): Promise<{ value?: { epoch: number } } | undefined> };
    publications: {
      get_author_state(args: { author: string }): Promise<{ value?: { next_sequence: string } } | undefined>;
      get_post_by_idempotency_key(args: { author: string; idempotency_key: Uint8Array }): Promise<{ value?: { post_id: Uint8Array } } | undefined>;
    };
    identity: { get_identity(args: { account: string }): Promise<{ value?: { encryption_key: Uint8Array; key_version: number } } | undefined> };
  };
}

/** The parts of IndexerClient the composer needs (mockable). */
export interface PublishIndexer {
  graph(account: string): Promise<{ friends: Array<{ account: string }> }>;
  profile(account: string): Promise<{ encryptionKey: string; keyVersion: number } | undefined>;
}

export interface PublishIdentity {
  account: string;
  encryption: { secretKey: Uint8Array; publicKey: Uint8Array; keyVersion: number };
}

export interface PublishInput {
  chain: PublishChain;
  indexer: PublishIndexer;
  me: PublishIdentity;
  keys: KeyStore;
  text: string;
  audience: typeof AUDIENCE.EVERYONE | typeof AUDIENCE.FRIENDS;
  media?: MediaAttachment[];
  /** base64url post id of the parent for replies. */
  replyTo?: string;
  /** New version of an existing post. */
  edit?: { postId: string; previousVersion: string; versionNumber: number };
  /** Persisted 16-byte attempt id (hex or bytes). */
  attemptId: Uint8Array | string;
  lang?: string;
  createdAt?: number;
  rng?: Rng;
}

export interface MediaAttachment {
  url: string;
  mime: string;
  size: number;
  /** sha256 of the fetched bytes. */
  contentHash: Uint8Array;
  altText?: string;
}

export interface PublishPlan {
  operations: OperationJson[];
  postId: Uint8Array;
  contentHash: Uint8Array;
  idempotencyKey: Uint8Array;
  audience: number;
  epoch: number;
  sequence: string;
  versionNumber: number;
  envelopeBytes: number;
  /** Set when the plan distributes a (new) epoch key; store it after a successful submit. */
  epochKey?: Uint8Array;
  recipients: string[];
  /** Friends without a registered encryption key (they cannot receive the key). */
  skipped: string[];
}

export class PublishError extends Error {
  override name = "PublishError";
}

/** Bytes an envelope will occupy for `content` (exact for suite 0, upper bound for suite 1). */
export function estimateEnvelopeBytes(content: Content, encrypted: boolean): number {
  const plain = encodeContent(content).length;
  // suite 1: payload tag (16) + nonce (24) + wrapped key (32 + 16) + wrap nonce (24) + field headers.
  return encrypted ? plain + 16 + 24 + 48 + 24 + 16 : plain + 8;
}

export function buildContent(input: Pick<PublishInput, "text" | "media" | "lang" | "createdAt">): Content {
  const content: Content = { version: 1, text: input.text, mime: "text/plain" };
  if (input.lang) content.lang = input.lang;
  if (input.createdAt) content.created_at = String(input.createdAt);
  if (input.media && input.media.length > 0) {
    content.media = input.media.map((m) => ({
      content_hash: m.contentHash,
      mime: m.mime,
      size: String(m.size),
      locations: [m.url],
      ...(m.altText && { alt_text: m.altText }),
    }));
  }
  return content;
}

function mediaRefs(media: MediaAttachment[] | undefined): MediaRefInput[] {
  return (media ?? []).map((m) => ({ content_hash: m.contentHash, mime: m.mime, size: String(m.size), locations: [m.url] }));
}

/** Resolves every active friend's current encryption key (indexer first, chain as fallback). */
export async function collectRecipients(input: Pick<PublishInput, "chain" | "indexer" | "me">): Promise<{ recipients: Recipient[]; skipped: string[] }> {
  const graph = await input.indexer.graph(input.me.account);
  const recipients: Recipient[] = [{ address: input.me.account, publicKey: input.me.encryption.publicKey, keyVersion: input.me.encryption.keyVersion }];
  const skipped: string[] = [];
  for (const friend of graph.friends) {
    if (friend.account === input.me.account) continue;
    let publicKey: Uint8Array | undefined;
    let keyVersion = 1;
    try {
      const profile = await input.indexer.profile(friend.account);
      if (profile && profile.encryptionKey) {
        publicKey = bytesOf(profile.encryptionKey);
        keyVersion = profile.keyVersion || 1;
      }
    } catch {
      // fall through to the chain
    }
    if (!publicKey || publicKey.length !== LIMITS.keyBytes) {
      try {
        const record = (await input.chain.reads.identity.get_identity({ account: friend.account }))?.value;
        if (record && record.encryption_key.length === LIMITS.keyBytes) {
          publicKey = record.encryption_key;
          keyVersion = record.key_version || 1;
        }
      } catch {
        // unreachable chain: skip this friend for now
      }
    }
    if (publicKey && publicKey.length === LIMITS.keyBytes) recipients.push({ address: friend.account, publicKey, keyVersion });
    else skipped.push(friend.account);
  }
  return { recipients, skipped };
}

/** The author's current friends-audience epoch from the chain (0 when never rotated). */
export async function currentEpoch(chain: PublishChain, account: string): Promise<number> {
  const audience = await chain.reads.relationships.get_audience({ account });
  return audience?.value?.epoch ?? 0;
}

export async function buildPublishPlan(input: PublishInput): Promise<PublishPlan> {
  const attemptId = typeof input.attemptId === "string" ? fromHex(input.attemptId) : input.attemptId;
  const key = idempotencyKey(input.me.account, attemptId);
  const content = buildContent(input);
  if (!content.text || content.text.trim().length === 0) throw new PublishError("Write something first.");
  if ((input.media?.length ?? 0) > LIMITS.maxMediaRefs) throw new PublishError(`At most ${LIMITS.maxMediaRefs} media attachments per post.`);
  const operations: OperationJson[] = [];
  const isEdit = input.edit !== undefined;
  const versionNumber = input.edit?.versionNumber ?? 1;
  const previousVersion = input.edit ? bytesOf(input.edit.previousVersion) : undefined;
  const editPostId = input.edit ? bytesOf(input.edit.postId) : undefined;

  let epoch = 0;
  let epochKey: Uint8Array | undefined;
  let newKey: Uint8Array | undefined;
  let recipients: string[] = [];
  let skipped: string[] = [];
  if (input.audience === AUDIENCE.FRIENDS) {
    epoch = await currentEpoch(input.chain, input.me.account);
    const ref = { author: input.me.account, audienceId: new Uint8Array(0), epoch };
    epochKey = input.keys.get(ref);
    if (!epochKey) {
      newKey = newEpochKey(input.rng);
      epochKey = newKey;
      const collected = await collectRecipients(input);
      recipients = collected.recipients.map((r) => (typeof r.address === "string" ? r.address : toBase64url(r.address)));
      skipped = collected.skipped;
      const sets = buildKeyPackageSets({ author: input.me.account, epoch, epochKey, recipients: collected.recipients, ...(input.rng && { rng: input.rng }) });
      for (const set of sets) {
        operations.push(await input.chain.ops.publications.distribute_keys({ author: input.me.account, epoch, packages: set.bytes }));
      }
    }
  }

  const aad = {
    chainId: input.chain.chainId,
    author: input.me.account,
    ...(editPostId && { postId: editPostId }),
    audience: input.audience,
    epoch,
    versionNumber,
  };
  const encrypted = input.audience === AUDIENCE.FRIENDS ? encryptContent({ content, aad, epochKey, ...(input.rng && { rng: input.rng }) }) : encryptContent({ content, aad });
  const envelope = encrypted.bytes;
  if (envelope.length > LIMITS.maxEnvelopeBytes) {
    throw new PublishError(`This post is ${envelope.length} bytes; the limit is ${LIMITS.maxEnvelopeBytes}. Shorten it or remove attachments.`);
  }
  const hash = sha256Envelope(envelope);

  let sequence = "0";
  let postId: Uint8Array;
  if (isEdit && editPostId) {
    postId = editPostId;
  } else {
    const state = await input.chain.reads.publications.get_author_state({ author: input.me.account });
    sequence = state?.value?.next_sequence ?? "1";
    if (sequence === "0") sequence = "1";
    postId = computePostId({ chainId: input.chain.chainId, author: input.me.account, sequence, contentHash: hash });
  }

  operations.push(
    await input.chain.ops.publications.publish({
      author: input.me.account,
      post_id: postId,
      ...(previousVersion && previousVersion.length > 0 && { previous_version: previousVersion }),
      ...(!isEdit && { sequence }),
      audience: input.audience,
      epoch,
      envelope,
      content_hash: hash,
      ...(input.media && input.media.length > 0 && { media: mediaRefs(input.media) }),
      ...(input.replyTo && { reply_to: bytesOf(input.replyTo) }),
      idempotency_key: key,
    }),
  );

  return {
    operations,
    postId,
    contentHash: hash,
    idempotencyKey: key,
    audience: input.audience,
    epoch,
    sequence,
    versionNumber,
    envelopeBytes: envelope.length,
    ...(newKey && { epochKey: newKey }),
    recipients,
    skipped,
  };
}

/** Spec 7: before retrying, ask the chain whether the idempotency key already produced a post. */
export async function findExistingPost(chain: PublishChain, account: string, attemptId: Uint8Array | string): Promise<Uint8Array | undefined> {
  const id = typeof attemptId === "string" ? fromHex(attemptId) : attemptId;
  const result = await chain.reads.publications.get_post_by_idempotency_key({ author: account, idempotency_key: idempotencyKey(account, id) });
  const found = result?.value?.post_id;
  return found && found.length > 0 ? found : undefined;
}

/** Fetches a media URL and hashes the bytes (requires CORS on the media host). */
export async function attachMediaFromUrl(url: string, fetchFn: typeof fetch = fetch, maxBytes = 50 * 1024 * 1024): Promise<MediaAttachment> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PublishError("Enter a full media URL (https://…).");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new PublishError("Only http(s) media URLs are supported.");
  if (url.length > LIMITS.maxLocationChars) throw new PublishError(`Media URLs are limited to ${LIMITS.maxLocationChars} characters.`);
  let response: Response;
  try {
    response = await fetchFn(url, { mode: "cors" });
  } catch {
    throw new PublishError("The media host does not allow this site to read the file (CORS). Host it elsewhere or paste a link in the text instead.");
  }
  if (!response.ok) throw new PublishError(`The media host answered ${response.status}.`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new PublishError("The file is too large to hash in the browser.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  const mime = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0]?.trim() || "application/octet-stream";
  return { url, mime, size: buffer.length, contentHash: digest };
}
