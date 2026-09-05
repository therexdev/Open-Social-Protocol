/**
 * Audience epoch keys per (author, audienceId, epoch): resolved from the sealed keys the
 * indexer serves for the signed-in account (`/v1/keys/:me`) and opened with the identity's
 * X25519 secret. Cached in memory and, when a persistence store is given, encrypted at rest.
 */
import { decode, deriveEncryptionSecret, openEpochKey, type SealedKey } from "@osp/sdk";
import { bytesOf, fromHex, toBase64url, toHex } from "../util/bytes";
import type { EncryptedStore } from "../vault/encryptedStore";
import type { SealedKeyView } from "./indexer";

export interface EpochKeyRef {
  author: string;
  /** Empty for the friends audience. */
  audienceId: Uint8Array;
  epoch: number;
}

export interface KeyResolverIdentity {
  account: string;
  seed: Uint8Array;
  encryption: { secretKey: Uint8Array; keyVersion: number };
}

export interface KeySource {
  keys(account: string, filter: { author?: string; audienceId?: string; epoch?: number }): Promise<SealedKeyView[]>;
}

export type KeyCache = Record<string, string>;

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

  has(ref: EpochKeyRef): boolean {
    return this.cache.has(epochKeyId(ref));
  }

  async put(ref: EpochKeyRef, key: Uint8Array): Promise<void> {
    this.cache.set(epochKeyId(ref), key);
    this.misses.delete(epochKeyId(ref));
    await this.flush();
  }

  /** Number of cached keys (settings / diagnostics). */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Returns the epoch key for `ref` when the signed-in identity has a sealed copy: from the
   * cache, otherwise by fetching sealed keys addressed to `me` and opening the first that fits.
   */
  async resolve(ref: EpochKeyRef, me: KeyResolverIdentity, source: KeySource, options: { retryAfterMs?: number; now?: number } = {}): Promise<Uint8Array | undefined> {
    await this.init();
    const cached = this.get(ref);
    if (cached) return cached;
    const id = epochKeyId(ref);
    const now = options.now ?? Date.now();
    const missedAt = this.misses.get(id);
    if (missedAt !== undefined && now - missedAt < (options.retryAfterMs ?? 30_000)) return undefined;
    let items: SealedKeyView[];
    try {
      items = await source.keys(me.account, { author: ref.author, audienceId: toBase64url(ref.audienceId), epoch: ref.epoch });
    } catch {
      return undefined;
    }
    for (const item of items) {
      const key = openSealedView(item, ref, me);
      if (key) {
        await this.put(ref, key);
        return key;
      }
    }
    this.misses.set(id, now);
    return undefined;
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
  const version = sealed.recipient_key_version || me.encryption.keyVersion;
  const recipientSecretKey = version === me.encryption.keyVersion ? me.encryption.secretKey : deriveEncryptionSecret(me.seed, version);
  try {
    return openEpochKey({ author: ref.author, audienceId: ref.audienceId, epoch: ref.epoch, sealed, recipientSecretKey });
  } catch {
    return undefined;
  }
}
