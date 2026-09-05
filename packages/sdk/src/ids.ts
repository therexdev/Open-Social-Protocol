/**
 * Protocol identifiers (spec sections 2.1 - 2.3).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { DOMAIN, LIMITS, PROTOCOL_VERSION } from "./constants.js";
import { concat, EncodingError, fromBase58, fromBase64url, toBase58, u32be, u64be, utf8 } from "./encoding.js";
import { randomBytes, type Rng } from "./crypto/keys.js";

/** A Koinos address as Base58 text or its 25 raw bytes. */
export type AddressLike = string | Uint8Array;
/** A chain id as returned by `chain.get_chain_id` (base64url multihash) or its raw bytes. */
export type ChainIdLike = string | Uint8Array;

/** Returns the 25 raw bytes of an address. */
export function addressToBytes(address: AddressLike): Uint8Array {
  const bytes = typeof address === "string" ? fromBase58(address) : new Uint8Array(address);
  if (bytes.length !== LIMITS.addressBytes) {
    throw new EncodingError(`address must be ${LIMITS.addressBytes} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** Returns the Base58 form of an address. */
export function addressToString(address: AddressLike): string {
  return typeof address === "string" ? address : toBase58(addressToBytes(address));
}

/** True when `value` parses as a 25-byte Koinos address. */
export function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return fromBase58(value).length === LIMITS.addressBytes;
  } catch {
    return false;
  }
}

/** Raw chain id bytes (multihash prefix included) from the RPC base64url value. */
export function chainIdToBytes(chainId: ChainIdLike): Uint8Array {
  const bytes = typeof chainId === "string" ? fromBase64url(chainId) : new Uint8Array(chainId);
  if (bytes.length === 0) throw new EncodingError("chain id must not be empty");
  return bytes;
}

/** `content_hash = sha256(envelope_bytes)` */
export function contentHash(envelopeBytes: Uint8Array): Uint8Array {
  return sha256(envelopeBytes);
}

export interface PostIdInput {
  chainId: ChainIdLike;
  /** Defaults to PROTOCOL_VERSION (1). */
  protocolVersion?: number;
  author: AddressLike;
  /** Author's 1-based publication sequence. */
  sequence: number | bigint | string;
  /** sha256 of the envelope bytes (32 bytes). */
  contentHash: Uint8Array;
}

/**
 * `post_id = sha256("osp/v1/post-id" || chain_id || u32be(protocol_version) || author(25)
 *                   || u64be(sequence) || content_hash)`
 */
export function postId(input: PostIdInput): Uint8Array {
  if (input.contentHash.length !== LIMITS.hashBytes) {
    throw new EncodingError(`contentHash must be ${LIMITS.hashBytes} bytes`);
  }
  return sha256(
    concat(
      utf8(DOMAIN.POST_ID),
      chainIdToBytes(input.chainId),
      u32be(input.protocolVersion ?? PROTOCOL_VERSION),
      addressToBytes(input.author),
      u64be(input.sequence),
      input.contentHash,
    ),
  );
}

/** `idempotency_key = sha256("osp/v1/idem" || author || client_attempt_id)[0..16]` */
export function idempotencyKey(author: AddressLike, attemptId: Uint8Array): Uint8Array {
  if (attemptId.length !== LIMITS.attemptIdBytes) {
    throw new EncodingError(`attemptId must be ${LIMITS.attemptIdBytes} bytes`);
  }
  return sha256(concat(utf8(DOMAIN.IDEMPOTENCY), addressToBytes(author), attemptId)).slice(0, LIMITS.idempotencyKeyBytes);
}

/** `audience_id = sha256("osp/v1/audience" || author || label)[0..16]` for custom audiences. */
export function customAudienceId(author: AddressLike, label: string): Uint8Array {
  if (label.length === 0) throw new EncodingError("audience label must not be empty");
  return sha256(concat(utf8(DOMAIN.AUDIENCE), addressToBytes(author), utf8(label))).slice(0, LIMITS.audienceIdBytes);
}

/** A fresh random 16-byte client attempt id; persist it before submitting (spec 2.2). */
export function newAttemptId(rng: Rng = randomBytes): Uint8Array {
  const id = rng(LIMITS.attemptIdBytes);
  if (id.length !== LIMITS.attemptIdBytes) throw new EncodingError("rng returned the wrong length");
  return id;
}
