/**
 * Audience epoch keys per (author, audienceId, epoch): resolved from the sealed keys the
 * indexer serves for the signed-in account (`/v1/keys/:me`) and opened with the identity's
 * X25519 secret. Cached in memory and encrypted at rest (AES-GCM under a key derived from the
 * encryption secret) in chrome.storage.local.
 */
import { decode, openEpochKey, toBase64url, utf8, utf8Decode, type SealedKey } from "@osp/sdk";
import { bytesOf, fromHex, toArrayBuffer, toHex } from "../shared/bytes";
import type { KeyValueArea } from "../shared/storage";
import type { SealedKeyView } from "../shared/indexer";

export interface EpochKeyRef {
  author: string;
  /** Empty for the friends audience. */
  audienceId: Uint8Array;
  epoch: number;
}

export interface KeyResolverIdentity {
  account: string;
  encryption: { secretKey: Uint8Array; keyVersion: number };
}

export interface KeySource {
  keys(account: string, filter: { author?: string; audienceId?: string; epoch?: number }): Promise<SealedKeyView[]>;
}

export interface EncryptedRecord {
  version: 1;
  cipher: "aes-256-gcm";
  iv: string;
  ciphertext: string;
}

export async function deriveAesKey(secret: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", toArrayBuffer(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(utf8("osp/extension")), info: toArrayBuffer(utf8(info)) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class EncryptedStore<T> {
  constructor(
    private readonly storage: KeyValueArea,
    private readonly storageKey: string,
    private readonly key: CryptoKey,
  ) {}

  async load(): Promise<T | undefined> {
    const record = await this.storage.get<EncryptedRecord>(this.storageKey);
    if (!record || record.version !== 1) return undefined;
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(bytesOf(record.iv)) }, this.key, toArrayBuffer(bytesOf(record.ciphertext)));
      return JSON.parse(utf8Decode(new Uint8Array(plaintext))) as T;
    } catch {
      return undefined;
    }
  }

  async save(value: T): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, toArrayBuffer(utf8(JSON.stringify(value))));
    await this.storage.set(this.storageKey, { version: 1, cipher: "aes-256-gcm", iv: toBase64url(iv), ciphertext: toBase64url(new Uint8Array(ciphertext)) } satisfies EncryptedRecord);
  }

  async clear(): Promise<void> {
    await this.storage.remove(this.storageKey);
  }
}

export type KeyCache = Record<string, string>;

export type KeyLookup = { status: "found"; key: Uint8Array } | { status: "missing" } | { status: "unavailable"; error: Error };

export function epochKeyId(ref: EpochKeyRef): string {
  return `${ref.author}|${toBase64url(ref.audienceId)}|${ref.epoch}`;
}

export class KeyStore {
  private readonly cache = new Map<string, Uint8Array>();
  private readonly misses = new Map<string, number>();
  private loaded = false;

  constructor(private readonly persist?: EncryptedStore<KeyCache>) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persist) return;
    const data = await this.persist.load();
    if (!data) return;
    for (const [id, hex] of Object.entries(data)) {
      try {
        this.cache.set(id, fromHex(hex));
      } catch {
        // skip corrupted entries
      }
    }
  }

  get(ref: EpochKeyRef): Uint8Array | undefined {
    return this.cache.get(epochKeyId(ref));
  }

  async put(ref: EpochKeyRef, key: Uint8Array): Promise<void> {
    this.cache.set(epochKeyId(ref), key);
    this.misses.delete(epochKeyId(ref));
    await this.flush();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Looks the key up: cache first, then the sealed keys the indexer serves for `me`. The result
   * distinguishes "the indexer has no key for this epoch" from "the indexer could not be asked",
   * which matters when the caller would otherwise mint a key (spec 5.2: one key per epoch).
   * `missCache: false` bypasses the negative cache and always asks the indexer.
   */
  async lookup(ref: EpochKeyRef, me: KeyResolverIdentity, source: KeySource, options: { retryAfterMs?: number; now?: number; missCache?: boolean } = {}): Promise<KeyLookup> {
    await this.init();
    const cached = this.get(ref);
    if (cached) return { status: "found", key: cached };
    const id = epochKeyId(ref);
    const now = options.now ?? Date.now();
    if (options.missCache !== false) {
      const missedAt = this.misses.get(id);
      if (missedAt !== undefined && now - missedAt < (options.retryAfterMs ?? 30_000)) return { status: "missing" };
    }
    let items: SealedKeyView[];
    try {
      items = await source.keys(me.account, { author: ref.author, audienceId: toBase64url(ref.audienceId), epoch: ref.epoch });
    } catch (error) {
      return { status: "unavailable", error: error instanceof Error ? error : new Error(String(error)) };
    }
    for (const item of items) {
      const key = openSealedView(item, ref, me);
      if (key) {
        await this.put(ref, key);
        return { status: "found", key };
      }
    }
    this.misses.set(id, now);
    return { status: "missing" };
  }

  /** `lookup` for readers: the key or undefined (a missing key and an unreachable indexer both read as "no key"). */
  async resolve(ref: EpochKeyRef, me: KeyResolverIdentity, source: KeySource, options: { retryAfterMs?: number; now?: number } = {}): Promise<Uint8Array | undefined> {
    const result = await this.lookup(ref, me, source, options);
    return result.status === "found" ? result.key : undefined;
  }

  forgetMisses(): void {
    this.misses.clear();
  }

  private async flush(): Promise<void> {
    if (!this.persist) return;
    const data: KeyCache = {};
    for (const [id, key] of this.cache) data[id] = toHex(key);
    try {
      await this.persist.save(data);
    } catch {
      // cache persistence is best effort
    }
  }
}

/** Opens one `/v1/keys` item for `me`; undefined when it is not for us or does not open. */
export function openSealedView(item: SealedKeyView, ref: EpochKeyRef, me: KeyResolverIdentity): Uint8Array | undefined {
  if (item.recipient !== me.account) return undefined;
  let sealed: SealedKey;
  try {
    sealed = decode<SealedKey>("osp.envelope.sealed_key", bytesOf(item.sealedKey));
  } catch {
    return undefined;
  }
  // A device-only vault has just the current encryption secret; keys sealed to older versions stay closed.
  if (sealed.recipient_key_version && sealed.recipient_key_version !== me.encryption.keyVersion) return undefined;
  try {
    return openEpochKey({ author: ref.author, audienceId: ref.audienceId, epoch: ref.epoch, sealed, recipientSecretKey: me.encryption.secretKey });
  } catch {
    return undefined;
  }
}
