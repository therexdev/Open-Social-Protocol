/**
 * Local key vault (spec section 5.5): identity seed, device secrets and metadata encrypted
 * under a passphrase with scrypt + XChaCha20-Poly1305. Portable across browsers, extension
 * service workers and Node.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { Signer } from "koilib";
import { LIMITS } from "./constants.js";
import { canonicalJson, fromBase64url, fromHex, toBase64url, toHex, utf8, utf8Decode } from "./encoding.js";
import { deriveEncryptionKeyPair, randomBytes, type EncryptionKeyPair, type Rng } from "./crypto/keys.js";

export class VaultError extends Error {
  override name = "VaultError";
}

/** What a client keeps in its vault. */
export interface VaultSecrets {
  /** 32-byte identity seed; the signing key is `Signer.fromSeed(hex(seed))`. */
  seed: Uint8Array;
  /** Current encryption key version published on chain. */
  keyVersion: number;
  /** The identity account (Base58). */
  account: string;
  /** Optional device/session secp256k1 private key (32 bytes). */
  deviceSecret?: Uint8Array;
  deviceAddress?: string;
  /** Free-form JSON-serializable metadata (labels, cached epoch keys as hex, ...). */
  meta?: Record<string, unknown>;
}

export interface VaultKdfParams {
  name: "scrypt";
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

/** Encrypted vault blob; safe to persist. */
export interface VaultBlob {
  version: 1;
  kdf: VaultKdfParams;
  cipher: "xchacha20poly1305";
  /** base64url */
  salt: string;
  /** base64url */
  nonce: string;
  /** base64url */
  ciphertext: string;
}

export const VAULT_KDF_DEFAULT: VaultKdfParams = { name: "scrypt", N: 2 ** 15, r: 8, p: 1, dkLen: 32 };

export interface LockVaultOptions {
  rng?: Rng;
  kdf?: Partial<Omit<VaultKdfParams, "name">>;
  /** Deterministic overrides for tests. */
  salt?: Uint8Array;
  nonce?: Uint8Array;
}

interface VaultPlaintext {
  seed: string;
  keyVersion: number;
  account: string;
  deviceSecret?: string;
  deviceAddress?: string;
  meta?: Record<string, unknown>;
}

function vaultAad(blob: Omit<VaultBlob, "ciphertext" | "nonce">): Uint8Array {
  return utf8(canonicalJson({ version: blob.version, kdf: blob.kdf, cipher: blob.cipher, salt: blob.salt }));
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array, kdf: VaultKdfParams): Promise<Uint8Array> {
  if (kdf.name !== "scrypt") throw new VaultError(`unsupported kdf ${String(kdf.name)}`);
  return scryptAsync(utf8(passphrase.normalize("NFKC")), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen });
}

/** Encrypts secrets under a passphrase. */
export async function lockVault(secrets: VaultSecrets, passphrase: string, options: LockVaultOptions = {}): Promise<VaultBlob> {
  if (passphrase.length === 0) throw new VaultError("passphrase must not be empty");
  if (secrets.seed.length !== LIMITS.seedBytes) throw new VaultError("seed must be 32 bytes");
  const rng = options.rng ?? randomBytes;
  const kdf: VaultKdfParams = { ...VAULT_KDF_DEFAULT, ...options.kdf, name: "scrypt" };
  const salt = options.salt ?? rng(16);
  const nonce = options.nonce ?? rng(LIMITS.nonceBytes);
  const header = { version: 1 as const, kdf, cipher: "xchacha20poly1305" as const, salt: toBase64url(salt) };
  const key = await deriveVaultKey(passphrase, salt, kdf);
  const plaintext: VaultPlaintext = {
    seed: toHex(secrets.seed),
    keyVersion: secrets.keyVersion,
    account: secrets.account,
    ...(secrets.deviceSecret && { deviceSecret: toHex(secrets.deviceSecret) }),
    ...(secrets.deviceAddress && { deviceAddress: secrets.deviceAddress }),
    ...(secrets.meta && { meta: secrets.meta }),
  };
  const ciphertext = xchacha20poly1305(key, nonce, vaultAad(header)).encrypt(utf8(JSON.stringify(plaintext)));
  return { ...header, nonce: toBase64url(nonce), ciphertext: toBase64url(ciphertext) };
}

/** Decrypts a vault blob. Throws VaultError for a wrong passphrase or a tampered blob. */
export async function unlockVault(blob: VaultBlob, passphrase: string): Promise<VaultSecrets> {
  if (blob.version !== 1) throw new VaultError(`unsupported vault version ${String(blob.version)}`);
  if (blob.cipher !== "xchacha20poly1305") throw new VaultError(`unsupported cipher ${String(blob.cipher)}`);
  const salt = fromBase64url(blob.salt);
  const nonce = fromBase64url(blob.nonce);
  const key = await deriveVaultKey(passphrase, salt, blob.kdf);
  let plaintext: VaultPlaintext;
  try {
    const bytes = xchacha20poly1305(key, nonce, vaultAad(blob)).decrypt(fromBase64url(blob.ciphertext));
    plaintext = JSON.parse(utf8Decode(bytes)) as VaultPlaintext;
  } catch {
    throw new VaultError("cannot unlock vault: wrong passphrase or corrupted data");
  }
  return {
    seed: fromHex(plaintext.seed),
    keyVersion: plaintext.keyVersion,
    account: plaintext.account,
    ...(plaintext.deviceSecret && { deviceSecret: fromHex(plaintext.deviceSecret) }),
    ...(plaintext.deviceAddress && { deviceAddress: plaintext.deviceAddress }),
    ...(plaintext.meta && { meta: plaintext.meta }),
  };
}

/** A fresh 32-byte identity seed. */
export function newIdentitySeed(rng: Rng = randomBytes): Uint8Array {
  const seed = rng(LIMITS.seedBytes);
  if (seed.length !== LIMITS.seedBytes) throw new VaultError("rng returned the wrong length");
  return seed;
}

/** The identity's koilib Signer: `Signer.fromSeed(hex(seed))`. */
export function signerFromSeed(seed: Uint8Array): Signer {
  if (seed.length !== LIMITS.seedBytes) throw new VaultError("seed must be 32 bytes");
  return Signer.fromSeed(toHex(seed));
}

/** A Signer from a raw 32-byte secp256k1 private key (device keys). */
export function signerFromSecret(secret: Uint8Array): Signer {
  if (secret.length !== 32) throw new VaultError("private key must be 32 bytes");
  return new Signer({ privateKey: toHex(secret), compressed: true });
}

export interface DeviceKeyPair {
  signer: Signer;
  address: string;
  /** Raw private key (32 bytes); store it in the vault. */
  secret: Uint8Array;
}

/** A random device/session key pair to be authorized with `identity.authorize_device`. */
export function deviceKeyPair(rng: Rng = randomBytes): DeviceKeyPair {
  const secret = rng(32);
  const signer = signerFromSecret(secret);
  return { signer, address: signer.getAddress(), secret };
}

export interface Identity {
  seed: Uint8Array;
  account: string;
  keyVersion: number;
  signer: Signer;
  encryption: EncryptionKeyPair;
}

/** Everything derived from a seed: account address, signer and encryption key pair. */
export function identityFromSeed(seed: Uint8Array, keyVersion = 1): Identity {
  const signer = signerFromSeed(seed);
  return { seed, account: signer.getAddress(), keyVersion, signer, encryption: deriveEncryptionKeyPair(seed, keyVersion) };
}

/** Portable identity export (seed + key version + account). Treat as a secret. */
export interface IdentityExport {
  version: 1;
  /** hex */
  seed: string;
  keyVersion: number;
  account: string;
}

export function exportIdentity(secrets: Pick<VaultSecrets, "seed" | "keyVersion" | "account">): string {
  if (secrets.seed.length !== LIMITS.seedBytes) throw new VaultError("seed must be 32 bytes");
  const data: IdentityExport = { version: 1, seed: toHex(secrets.seed), keyVersion: secrets.keyVersion, account: secrets.account };
  return JSON.stringify(data);
}

/** Parses an identity export and verifies that the account matches the seed. */
export function importIdentity(json: string | IdentityExport): Pick<VaultSecrets, "seed" | "keyVersion" | "account"> {
  let data: IdentityExport;
  try {
    data = typeof json === "string" ? (JSON.parse(json) as IdentityExport) : json;
  } catch {
    throw new VaultError("identity export is not valid JSON");
  }
  if (data.version !== 1 || typeof data.seed !== "string" || typeof data.account !== "string") {
    throw new VaultError("unsupported identity export");
  }
  const seed = fromHex(data.seed);
  if (seed.length !== LIMITS.seedBytes) throw new VaultError("seed must be 32 bytes");
  const keyVersion = Number.isInteger(data.keyVersion) && data.keyVersion > 0 ? data.keyVersion : 1;
  const account = signerFromSeed(seed).getAddress();
  if (account !== data.account) throw new VaultError("identity export account does not match its seed");
  return { seed, keyVersion, account };
}
