/**
 * Small encrypted JSON documents (cached epoch keys, drafts) stored outside the vault but
 * under a key derived from the identity seed, so nothing readable sits in IndexedDB.
 * AES-256-GCM through WebCrypto; the key never leaves memory.
 */
import { toBase64url, utf8, utf8Decode } from "@osp/sdk";
import { bytesOf, toArrayBuffer } from "../util/bytes";
import type { KeyValueStorage } from "./storage";

export interface EncryptedRecord {
  version: 1;
  cipher: "aes-256-gcm";
  iv: string;
  ciphertext: string;
}

/** HKDF-SHA256(seed, salt = "osp/web", info) -> AES-GCM key. */
export async function deriveAesKey(secret: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", toArrayBuffer(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(utf8("osp/web")), info: toArrayBuffer(utf8(info)) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext));
  return { version: 1, cipher: "aes-256-gcm", iv: toBase64url(iv), ciphertext: toBase64url(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(key: CryptoKey, record: EncryptedRecord): Promise<T> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(bytesOf(record.iv)) }, key, toArrayBuffer(bytesOf(record.ciphertext)));
  return JSON.parse(utf8Decode(new Uint8Array(plaintext))) as T;
}

export class EncryptedStore<T> {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly storageKey: string,
    private readonly key: CryptoKey,
  ) {}

  async load(): Promise<T | undefined> {
    const record = await this.storage.get<EncryptedRecord>(this.storageKey);
    if (!record || record.version !== 1) return undefined;
    try {
      return await decryptJson<T>(this.key, record);
    } catch {
      return undefined;
    }
  }

  async save(value: T): Promise<void> {
    await this.storage.set(this.storageKey, await encryptJson(this.key, value));
  }

  async clear(): Promise<void> {
    await this.storage.del(this.storageKey);
  }
}
