/**
 * Audience epoch keys and per-recipient sealing (spec section 5.2).
 *
 * seal_key   = HKDF-SHA256(ikm = X25519(eph.secret, recipient_pub), salt = eph.pub || recipient_pub,
 *                          info = "osp/v1/seal", len = 32)
 * ciphertext = XChaCha20-Poly1305(seal_key, nonce, epoch_key,
 *                                 aad = author || audience_id || u32be(epoch) || recipient)
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { DOMAIN, KEY_PACKAGE_VERSION, LIMITS, SUITE } from "../constants.js";
import { bytesEqual, concat, decode, encode, u32be, utf8 } from "../encoding.js";
import { addressToBytes, type AddressLike } from "../ids.js";
import { randomBytes, x25519KeyPair, type Rng } from "./keys.js";

export class AudienceError extends Error {
  override name = "AudienceError";
}

/** osp.envelope.sealed_key */
export interface SealedKey {
  recipient: Uint8Array;
  recipient_key_version: number;
  ephemeral_public_key: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** osp.envelope.key_package_set */
export interface KeyPackageSet {
  version: number;
  suite: number;
  author: Uint8Array;
  audience_id: Uint8Array;
  epoch: number;
  keys: SealedKey[];
}

/** Identifies an (author, audience, epoch) triple. `audienceId` is empty for the friends audience. */
export interface AudienceContext {
  author: AddressLike;
  audienceId?: Uint8Array;
  epoch: number;
}

/** A member the epoch key is sealed for. */
export interface Recipient {
  address: AddressLike;
  /** The member's current identity encryption key (X25519, 32 bytes). */
  publicKey: Uint8Array;
  keyVersion: number;
}

const KEY_PACKAGE_TYPE = "osp.envelope.key_package_set";

/** A fresh random 32-byte epoch key. */
export function newEpochKey(rng: Rng = randomBytes): Uint8Array {
  const key = rng(LIMITS.keyBytes);
  if (key.length !== LIMITS.keyBytes) throw new AudienceError("rng returned the wrong length");
  return key;
}

/** `author || audience_id || u32be(epoch) || recipient` */
export function sealAad(context: AudienceContext, recipient: AddressLike): Uint8Array {
  return concat(
    addressToBytes(context.author),
    context.audienceId ?? new Uint8Array(0),
    u32be(context.epoch),
    addressToBytes(recipient),
  );
}

/** Derives the sealing key from an X25519 shared secret and both public keys. */
export function deriveSealKey(sharedSecret: Uint8Array, ephemeralPublicKey: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, concat(ephemeralPublicKey, recipientPublicKey), utf8(DOMAIN.SEAL), LIMITS.keyBytes);
}

export interface SealEpochKeyOptions extends AudienceContext {
  epochKey: Uint8Array;
  recipient: AddressLike;
  recipientPublicKey: Uint8Array;
  recipientKeyVersion: number;
  rng?: Rng;
  /** Deterministic overrides (vectors/tests). Drawn from `rng` in this order when absent. */
  ephemeralSecretKey?: Uint8Array;
  nonce?: Uint8Array;
}

/** Seals an epoch key for one recipient. */
export function sealEpochKey(options: SealEpochKeyOptions): SealedKey {
  if (options.epochKey.length !== LIMITS.keyBytes) throw new AudienceError("epoch key must be 32 bytes");
  if (options.recipientPublicKey.length !== LIMITS.keyBytes) throw new AudienceError("recipient public key must be 32 bytes");
  const rng = options.rng ?? randomBytes;
  const ephemeral = options.ephemeralSecretKey
    ? { secretKey: options.ephemeralSecretKey, publicKey: x25519.getPublicKey(options.ephemeralSecretKey) }
    : x25519KeyPair(rng);
  const nonce = options.nonce ?? rng(LIMITS.nonceBytes);
  if (nonce.length !== LIMITS.nonceBytes) throw new AudienceError("nonce must be 24 bytes");
  const shared = x25519.getSharedSecret(ephemeral.secretKey, options.recipientPublicKey);
  const sealKey = deriveSealKey(shared, ephemeral.publicKey, options.recipientPublicKey);
  const recipient = addressToBytes(options.recipient);
  const aad = sealAad(options, recipient);
  const ciphertext = xchacha20poly1305(sealKey, nonce, aad).encrypt(options.epochKey);
  return {
    recipient,
    recipient_key_version: options.recipientKeyVersion,
    ephemeral_public_key: ephemeral.publicKey,
    nonce,
    ciphertext,
  };
}

export interface OpenEpochKeyOptions extends AudienceContext {
  sealed: SealedKey;
  /** The recipient's X25519 secret for `sealed.recipient_key_version`. */
  recipientSecretKey: Uint8Array;
}

/** Opens a sealed epoch key. Throws AudienceError for a wrong recipient/key or tampering. */
export function openEpochKey(options: OpenEpochKeyOptions): Uint8Array {
  const { sealed } = options;
  if (options.recipientSecretKey.length !== LIMITS.keyBytes) throw new AudienceError("recipient secret must be 32 bytes");
  if (sealed.ephemeral_public_key.length !== LIMITS.keyBytes) throw new AudienceError("invalid ephemeral public key");
  if (sealed.nonce.length !== LIMITS.nonceBytes) throw new AudienceError("invalid nonce");
  const recipientPublicKey = x25519.getPublicKey(options.recipientSecretKey);
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(options.recipientSecretKey, sealed.ephemeral_public_key);
  } catch {
    throw new AudienceError("invalid ephemeral public key");
  }
  const sealKey = deriveSealKey(shared, sealed.ephemeral_public_key, recipientPublicKey);
  const aad = sealAad(options, sealed.recipient);
  try {
    return xchacha20poly1305(sealKey, sealed.nonce, aad).decrypt(sealed.ciphertext);
  } catch {
    throw new AudienceError("sealed key does not open: wrong recipient key or tampered package");
  }
}

export interface BuildKeyPackageSetOptions extends AudienceContext {
  epochKey: Uint8Array;
  /** Include the author itself so every author device can recover the key from history. */
  recipients: Recipient[];
  rng?: Rng;
}

export interface KeyPackage {
  set: KeyPackageSet;
  /** Canonical bytes for `distribute_keys_arguments.packages`. */
  bytes: Uint8Array;
}

/** Seals the epoch key for every recipient into one key package set. Throws if it exceeds the pilot limit. */
export function buildKeyPackageSet(options: BuildKeyPackageSetOptions): KeyPackage {
  const sets = buildKeyPackageSets(options, Number.POSITIVE_INFINITY);
  const first = sets[0];
  if (!first) throw new AudienceError("no recipients");
  if (first.bytes.length > LIMITS.maxKeyPackageBytes) {
    throw new AudienceError(
      `key package set is ${first.bytes.length} bytes, above the ${LIMITS.maxKeyPackageBytes}-byte limit; use buildKeyPackageSets`,
    );
  }
  return first;
}

/**
 * Like buildKeyPackageSet but splits recipients into as many sets as needed so that each
 * encoded set stays within `maxBytes` (spec 5.2: multiple `distribute_keys` calls per epoch).
 */
export function buildKeyPackageSets(options: BuildKeyPackageSetOptions, maxBytes: number = LIMITS.maxKeyPackageBytes): KeyPackage[] {
  if (options.recipients.length === 0) throw new AudienceError("no recipients");
  const context: AudienceContext = { author: options.author, audienceId: options.audienceId, epoch: options.epoch };
  const sealed = options.recipients.map((recipient) =>
    sealEpochKey({
      ...context,
      epochKey: options.epochKey,
      recipient: recipient.address,
      recipientPublicKey: recipient.publicKey,
      recipientKeyVersion: recipient.keyVersion,
      rng: options.rng,
    }),
  );
  const makeSet = (keys: SealedKey[]): KeyPackage => {
    const set: KeyPackageSet = {
      version: KEY_PACKAGE_VERSION,
      suite: SUITE.XCHACHA20POLY1305_X25519,
      author: addressToBytes(options.author),
      audience_id: options.audienceId ?? new Uint8Array(0),
      epoch: options.epoch,
      keys,
    };
    return { set, bytes: encodeKeyPackageSet(set) };
  };
  const out: KeyPackage[] = [];
  let current: SealedKey[] = [];
  for (const key of sealed) {
    const candidate = makeSet([...current, key]);
    if (candidate.bytes.length > maxBytes && current.length > 0) {
      out.push(makeSet(current));
      current = [key];
    } else {
      current.push(key);
    }
  }
  if (current.length > 0) out.push(makeSet(current));
  return out;
}

export function encodeKeyPackageSet(set: KeyPackageSet): Uint8Array {
  return encode(KEY_PACKAGE_TYPE, set as unknown as Record<string, unknown>);
}

/** Parses `distribute_keys_arguments.packages` / `keys_distributed_event.packages`. */
export function parseKeyPackageSet(bytes: Uint8Array): KeyPackageSet {
  const set = decode<KeyPackageSet>(KEY_PACKAGE_TYPE, bytes);
  if (set.version !== KEY_PACKAGE_VERSION) throw new AudienceError(`unsupported key package version ${set.version}`);
  return set;
}

/** Finds the sealed key addressed to `recipient`, if any. */
export function findSealedKeyFor(set: KeyPackageSet, recipient: AddressLike): SealedKey | undefined {
  const target = addressToBytes(recipient);
  return set.keys.find((key) => bytesEqual(key.recipient, target));
}

/** Finds and opens the epoch key for `recipient` from a key package set; undefined when not addressed. */
export function openEpochKeyFromSet(set: KeyPackageSet, recipient: AddressLike, recipientSecretKey: Uint8Array): Uint8Array | undefined {
  const sealed = findSealedKeyFor(set, recipient);
  if (!sealed) return undefined;
  return openEpochKey({
    sealed,
    recipientSecretKey,
    author: set.author,
    audienceId: set.audience_id,
    epoch: set.epoch,
  });
}
