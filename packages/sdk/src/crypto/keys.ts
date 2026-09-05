/**
 * Key derivation and randomness (spec sections 5.2 and 5.5).
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { DOMAIN, LIMITS } from "../constants.js";
import { concat, EncodingError, u32be, utf8 } from "../encoding.js";

/** A source of random bytes; defaults to the platform CSPRNG. Tests inject deterministic ones. */
export type Rng = (length: number) => Uint8Array;

/** Cryptographically secure random bytes from `globalThis.crypto` (browsers, workers, Node 19+). */
export function randomBytes(length: number): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("globalThis.crypto.getRandomValues is not available");
  }
  const out = new Uint8Array(length);
  // getRandomValues is limited to 65536 bytes per call.
  for (let offset = 0; offset < length; offset += 65536) {
    cryptoObj.getRandomValues(out.subarray(offset, Math.min(length, offset + 65536)));
  }
  return out;
}

/**
 * `HKDF-SHA256(ikm = seed, salt = empty, info = "osp/v1/enc-key" || u32be(key_version), 32)`
 * The X25519 secret for the identity's encryption key `key_version`.
 */
export function deriveEncryptionSecret(seed: Uint8Array, keyVersion: number): Uint8Array {
  if (seed.length === 0) throw new EncodingError("seed must not be empty");
  const info = concat(utf8(DOMAIN.ENCRYPTION_KEY), u32be(keyVersion));
  return hkdf(sha256, seed, new Uint8Array(0), info, LIMITS.keyBytes);
}

/** X25519 public key (32 bytes) of a secret. */
export function encryptionPublicKey(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== LIMITS.keyBytes) throw new EncodingError("x25519 secret must be 32 bytes");
  return x25519.getPublicKey(secretKey);
}

export interface EncryptionKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  keyVersion: number;
}

/** Derives the identity encryption key pair published through `identity.register`. */
export function deriveEncryptionKeyPair(seed: Uint8Array, keyVersion: number): EncryptionKeyPair {
  const secretKey = deriveEncryptionSecret(seed, keyVersion);
  return { secretKey, publicKey: encryptionPublicKey(secretKey), keyVersion };
}

/** A random X25519 key pair (ephemeral keys for sealing). */
export function x25519KeyPair(rng: Rng = randomBytes): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = rng(LIMITS.keyBytes);
  if (secretKey.length !== LIMITS.keyBytes) throw new EncodingError("rng returned the wrong length");
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** Raw X25519 shared secret. */
export function x25519SharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secretKey, publicKey);
}
