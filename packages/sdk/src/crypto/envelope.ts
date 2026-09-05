/**
 * Content envelopes (spec section 5.1).
 *
 * Suite 1: `payload = XChaCha20-Poly1305(content_key, nonce, canonical(content), aad_bytes)`,
 * `wrapped_content_key = XChaCha20-Poly1305(epoch_key, wrap_nonce, content_key, "osp/v1/wrap" || aad_bytes)`.
 * Suite 0: `payload = canonical(content)` in the clear (everyone audience only).
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { AUDIENCE, DOMAIN, ENVELOPE_VERSION, LIMITS, PROTOCOL_VERSION, SUITE } from "../constants.js";
import { concat, decode, encode, utf8 } from "../encoding.js";
import { addressToBytes, chainIdToBytes, type AddressLike, type ChainIdLike } from "../ids.js";
import { randomBytes, type Rng } from "./keys.js";

export class EnvelopeError extends Error {
  override name = "EnvelopeError";
}

/** osp.envelope.media_item */
export interface MediaItem {
  content_hash?: Uint8Array;
  mime?: string;
  size?: string | number | bigint;
  locations?: string[];
  wrapped_key?: Uint8Array;
  nonce?: Uint8Array;
  alt_text?: string;
}

/** osp.envelope.content (plaintext of a post). */
export interface Content {
  version?: number;
  text?: string;
  mime?: string;
  media?: MediaItem[];
  /** BCP 47 language tag. */
  lang?: string;
  /** Client creation time in ms; informational. */
  created_at?: string | number | bigint;
  /** Host-site publication reference for cross-posts. */
  external_ref?: string;
}

/** osp.envelope.envelope */
export interface Envelope {
  version: number;
  suite: number;
  payload: Uint8Array;
  nonce?: Uint8Array;
  wrapped_content_key?: Uint8Array;
  wrap_nonce?: Uint8Array;
}

/** Inputs of osp.envelope.aad. `postId` is ignored (forced empty) when `versionNumber === 1`. */
export interface AadInput {
  protocolVersion?: number;
  chainId: ChainIdLike;
  author: AddressLike;
  postId?: Uint8Array;
  audience: number;
  audienceId?: Uint8Array;
  epoch: number;
  versionNumber: number;
}

const CONTENT_TYPE = "osp.envelope.content";
const ENVELOPE_TYPE = "osp.envelope.envelope";
const AAD_TYPE = "osp.envelope.aad";

/** Canonical AAD bytes. For first versions the AAD carries an empty post_id (spec 5.1). */
export function buildAad(input: AadInput): Uint8Array {
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new EnvelopeError("versionNumber must be a positive integer");
  }
  const postId = input.versionNumber === 1 ? new Uint8Array(0) : (input.postId ?? new Uint8Array(0));
  if (input.versionNumber > 1 && postId.length !== LIMITS.hashBytes) {
    throw new EnvelopeError("postId is required for versions after the first");
  }
  return encode(AAD_TYPE, {
    protocol_version: input.protocolVersion ?? PROTOCOL_VERSION,
    chain_id: chainIdToBytes(input.chainId),
    author: addressToBytes(input.author),
    post_id: postId,
    audience: input.audience,
    audience_id: input.audienceId ?? new Uint8Array(0),
    epoch: input.epoch,
    version_number: input.versionNumber,
  });
}

/** Decodes AAD bytes (mostly for debugging and vectors). */
export function decodeAad(bytes: Uint8Array): {
  protocol_version: number;
  chain_id: Uint8Array;
  author: Uint8Array;
  post_id: Uint8Array;
  audience: number;
  audience_id: Uint8Array;
  epoch: number;
  version_number: number;
} {
  return decode(AAD_TYPE, bytes);
}

function aadBytes(aad: AadInput | Uint8Array): Uint8Array {
  return aad instanceof Uint8Array ? aad : buildAad(aad);
}

/**
 * Checks the pilot limits the chain enforces on a content document (spec section 6): at most
 * `LIMITS.maxMediaRefs` media items, `LIMITS.maxLocationsPerRef` locations per item, each at
 * most `LIMITS.maxLocationChars` characters. Throws `EnvelopeError`; UIs can call it early.
 */
export function validateContent(content: Content): void {
  const media = content.media ?? [];
  if (media.length > LIMITS.maxMediaRefs) {
    throw new EnvelopeError(`content has ${media.length} media refs, above the limit of ${LIMITS.maxMediaRefs}`);
  }
  media.forEach((item, index) => {
    const locations = item.locations ?? [];
    if (locations.length > LIMITS.maxLocationsPerRef) {
      throw new EnvelopeError(`media[${index}] has ${locations.length} locations, above the limit of ${LIMITS.maxLocationsPerRef}`);
    }
    locations.forEach((location, i) => {
      if (location.length > LIMITS.maxLocationChars) {
        throw new EnvelopeError(`media[${index}].locations[${i}] is ${location.length} chars, above the limit of ${LIMITS.maxLocationChars}`);
      }
    });
  });
}

/** Throws `EnvelopeError` when encoded envelope bytes exceed `LIMITS.maxEnvelopeBytes`. */
export function validateEnvelopeSize(bytes: Uint8Array): void {
  if (bytes.length > LIMITS.maxEnvelopeBytes) {
    throw new EnvelopeError(`envelope is ${bytes.length} bytes, above the limit of ${LIMITS.maxEnvelopeBytes}`);
  }
}

/** Canonical encoding of a content document (validates the media limits first). */
export function encodeContent(content: Content): Uint8Array {
  validateContent(content);
  return encode(CONTENT_TYPE, content as Record<string, unknown>);
}

export function decodeContent(bytes: Uint8Array): Required<Pick<Content, "version" | "text" | "mime" | "lang" | "external_ref">> & {
  media: Required<MediaItem>[];
  created_at: string;
} {
  return decode(CONTENT_TYPE, bytes);
}

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return encode(ENVELOPE_TYPE, envelope as unknown as Record<string, unknown>);
}

export function decodeEnvelope(bytes: Uint8Array): Required<Envelope> {
  return decode(ENVELOPE_TYPE, bytes);
}

export interface EncryptContentOptions {
  content: Content;
  /** AAD object or canonical AAD bytes. Required for suite 1; optional for suite 0. */
  aad?: AadInput | Uint8Array;
  /** Audience epoch key (32 bytes). Required for suite 1. */
  epochKey?: Uint8Array;
  /** Defaults to suite 1 when an epoch key is given, suite 0 otherwise. */
  suite?: number;
  rng?: Rng;
  /** Deterministic overrides (vectors/tests). Drawn from `rng` in this order when absent. */
  contentKey?: Uint8Array;
  nonce?: Uint8Array;
  wrapNonce?: Uint8Array;
}

export interface EncryptContentResult {
  envelope: Envelope;
  /** Canonical envelope bytes, i.e. `publish_arguments.envelope`. */
  bytes: Uint8Array;
  /** sha256(bytes) */
  contentHash: Uint8Array;
  /** The random content key (suite 1 only); needed to wrap per-media keys. */
  contentKey?: Uint8Array;
}

/**
 * Builds the envelope for a post. Enforces the pilot limits up front (`validateContent`,
 * `LIMITS.maxEnvelopeBytes`) so an oversized post fails before anything is persisted or
 * published elsewhere.
 */
export function encryptContent(options: EncryptContentOptions): EncryptContentResult {
  const suite = options.suite ?? (options.epochKey ? SUITE.XCHACHA20POLY1305_X25519 : SUITE.PLAINTEXT);
  const plaintext = encodeContent(options.content);
  if (suite === SUITE.PLAINTEXT) {
    if (options.aad && !(options.aad instanceof Uint8Array) && options.aad.audience !== AUDIENCE.EVERYONE) {
      throw new EnvelopeError("suite 0 (plaintext) is only valid for the everyone audience");
    }
    const envelope: Envelope = { version: ENVELOPE_VERSION, suite, payload: plaintext };
    const bytes = encodeEnvelope(envelope);
    validateEnvelopeSize(bytes);
    return { envelope, bytes, contentHash: hash(bytes) };
  }
  if (suite !== SUITE.XCHACHA20POLY1305_X25519) throw new EnvelopeError(`unsupported suite ${suite}`);
  if (!options.epochKey || options.epochKey.length !== LIMITS.keyBytes) {
    throw new EnvelopeError("suite 1 requires a 32-byte epoch key");
  }
  if (!options.aad) throw new EnvelopeError("suite 1 requires the AAD");
  const aad = aadBytes(options.aad);
  const rng = options.rng ?? randomBytes;
  const contentKey = options.contentKey ?? rng(LIMITS.keyBytes);
  const nonce = options.nonce ?? rng(LIMITS.nonceBytes);
  const wrapNonce = options.wrapNonce ?? rng(LIMITS.nonceBytes);
  checkLength(contentKey, LIMITS.keyBytes, "contentKey");
  checkLength(nonce, LIMITS.nonceBytes, "nonce");
  checkLength(wrapNonce, LIMITS.nonceBytes, "wrapNonce");
  const payload = xchacha20poly1305(contentKey, nonce, aad).encrypt(plaintext);
  const wrapped = xchacha20poly1305(options.epochKey, wrapNonce, wrapAad(aad)).encrypt(contentKey);
  const envelope: Envelope = {
    version: ENVELOPE_VERSION,
    suite,
    payload,
    nonce,
    wrapped_content_key: wrapped,
    wrap_nonce: wrapNonce,
  };
  const bytes = encodeEnvelope(envelope);
  validateEnvelopeSize(bytes);
  return { envelope, bytes, contentHash: hash(bytes), contentKey };
}

export interface DecryptContentOptions {
  envelope: Uint8Array | Envelope;
  /** Required for suite 1. */
  aad?: AadInput | Uint8Array;
  /** Required for suite 1. */
  epochKey?: Uint8Array;
}

/** Recovers the content key of a suite-1 envelope. Throws EnvelopeError on tampering or wrong key. */
export function unwrapContentKey(envelope: Envelope, epochKey: Uint8Array, aad: AadInput | Uint8Array): Uint8Array {
  if (envelope.suite !== SUITE.XCHACHA20POLY1305_X25519) throw new EnvelopeError("envelope is not suite 1");
  if (!envelope.wrapped_content_key || !envelope.wrap_nonce) throw new EnvelopeError("envelope has no wrapped content key");
  if (epochKey.length !== LIMITS.keyBytes) throw new EnvelopeError("epoch key must be 32 bytes");
  try {
    return xchacha20poly1305(epochKey, envelope.wrap_nonce, wrapAad(aadBytes(aad))).decrypt(envelope.wrapped_content_key);
  } catch {
    throw new EnvelopeError("content key unwrap failed: wrong epoch key or tampered envelope/AAD");
  }
}

/** Opens an envelope. Suite 0 needs nothing; suite 1 needs the AAD and the epoch key. */
export function decryptContent(options: DecryptContentOptions): ReturnType<typeof decodeContent> {
  const envelope = options.envelope instanceof Uint8Array ? decodeEnvelope(options.envelope) : options.envelope;
  if (envelope.version !== ENVELOPE_VERSION) throw new EnvelopeError(`unsupported envelope version ${envelope.version}`);
  if (envelope.suite === SUITE.PLAINTEXT) {
    return decodeContent(envelope.payload);
  }
  if (envelope.suite !== SUITE.XCHACHA20POLY1305_X25519) throw new EnvelopeError(`unsupported suite ${envelope.suite}`);
  if (!options.epochKey) throw new EnvelopeError("suite 1 requires the epoch key");
  if (!options.aad) throw new EnvelopeError("suite 1 requires the AAD");
  if (!envelope.nonce || envelope.nonce.length !== LIMITS.nonceBytes) throw new EnvelopeError("invalid envelope nonce");
  const aad = aadBytes(options.aad);
  const contentKey = unwrapContentKey(envelope, options.epochKey, aad);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(contentKey, envelope.nonce, aad).decrypt(envelope.payload);
  } catch {
    throw new EnvelopeError("payload authentication failed: tampered envelope or AAD");
  }
  return decodeContent(plaintext);
}

/** `"osp/v1/wrap" || aad_bytes` */
export function wrapAad(aad: Uint8Array): Uint8Array {
  return concat(utf8(DOMAIN.WRAP), aad);
}

function checkLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) throw new EnvelopeError(`${label} must be ${expected} bytes`);
}

function hash(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}
