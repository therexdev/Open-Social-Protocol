/**
 * Audience epoch keys per (author, audienceId, epoch).
 *
 * Trust model (spec section 1: the indexer is a convenience, never a source of truth):
 *  - keys generated on this device are trusted;
 *  - sealed keys the indexer serves for the signed-in account (`/v1/keys/:me`) are opened with
 *    the identity's X25519 secret and become trusted only once the `distribute_keys`
 *    transaction they came from is verified on chain (see keyProvenance.ts);
 *  - anything else stays in memory, is used for reading only, and is never persisted or reused
 *    for publishing.
 *
 * Trusted keys are cached encrypted at rest together with the accounts known to hold a sealed
 * copy, so the composer can hand the key to friends who joined after it was distributed.
 */
import { bytesEqual, decode, deriveEncryptionSecret, openEpochKey, type SealedKey } from "@osp/sdk";
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

/** Outcome of checking on chain where a sealed key served by the indexer came from. */
export type KeyProvenance =
  | { status: "verified"; recipients: string[] }
  | { status: "rejected"; reason: string }
  | { status: "unavailable"; reason: string };

export type KeyVerifier = (item: SealedKeyView, ref: EpochKeyRef) => Promise<KeyProvenance>;

export interface EpochKeyEntry {
  key: Uint8Array;
  /** Accounts known to hold a sealed copy (from this device's distributions or the verified chain record). */
  recipients: string[];
  /** Generated here or verified on chain: safe to encrypt new posts with. */
  trusted: boolean;
}

export interface KeyCandidate {
  key: Uint8Array;
  item: SealedKeyView;
}

export interface KeyCacheEntry {
  key: string;
  recipients: string[];
}

/** Persisted shape: trusted entries only. Plain hex strings are the pre-provenance format. */
export type KeyCache = Record<string, string | KeyCacheEntry>;

export interface ResolveOptions {
  verify?: KeyVerifier;
  retryAfterMs?: number;
  now?: number;
}

export function epochKeyId(ref: EpochKeyRef): string {
  return `${ref.author}|${toBase64url(ref.audienceId)}|${ref.epoch}`;
}

export class KeyStore {
  private readonly cache = new Map<string, EpochKeyEntry>();
  private readonly misses = new Map<string, number>();
  private loaded = false;

  constructor(private readonly persist?: EncryptedStore<KeyCache>) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persist) return;
    const data = await this.persist.load();
    if (!data) return;
    for (const [id, raw] of Object.entries(data)) {
      try {
        if (typeof raw === "string") {
          // Legacy entry without provenance: readable, but never reused for publishing.
          this.cache.set(id, { key: fromHex(raw), recipients: [], trusted: false });
        } else if (raw && typeof raw.key === "string") {
          const recipients = Array.isArray(raw.recipients) ? raw.recipients.filter((r): r is string => typeof r === "string") : [];
          this.cache.set(id, { key: fromHex(raw.key), recipients, trusted: true });
        }
      } catch {
        // skip corrupted entries
      }
    }
  }

  /** Any cached key (reading). */
  get(ref: EpochKeyRef): Uint8Array | undefined {
    return this.cache.get(epochKeyId(ref))?.key;
  }

  entry(ref: EpochKeyRef): EpochKeyEntry | undefined {
    const found = this.cache.get(epochKeyId(ref));
    return found ? { ...found, recipients: [...found.recipients] } : undefined;
  }

  /** Only keys generated here or verified on chain (publishing). */
  trusted(ref: EpochKeyRef): EpochKeyEntry | undefined {
    const found = this.entry(ref);
    return found?.trusted ? found : undefined;
  }

  has(ref: EpochKeyRef): boolean {
    return this.cache.has(epochKeyId(ref));
  }

  recipients(ref: EpochKeyRef): string[] {
    return this.entry(ref)?.recipients ?? [];
  }

  /** Stores a trusted key (generated on this device or verified on chain) and persists it. */
  async put(ref: EpochKeyRef, key: Uint8Array, options: { recipients?: string[] } = {}): Promise<void> {
    const id = epochKeyId(ref);
    const existing = this.cache.get(id);
    const recipients = new Set<string>(existing?.trusted && bytesEqual(existing.key, key) ? existing.recipients : []);
    for (const r of options.recipients ?? []) recipients.add(r);
    this.cache.set(id, { key, recipients: [...recipients], trusted: true });
    this.misses.delete(id);
    await this.flush();
  }

  /** Keeps an unverified key in memory only (reading). */
  remember(ref: EpochKeyRef, key: Uint8Array): void {
    const id = epochKeyId(ref);
    this.cache.set(id, { key, recipients: [], trusted: false });
    this.misses.delete(id);
  }

  /** Records accounts that received a sealed copy of a trusted key. */
  async addRecipients(ref: EpochKeyRef, accounts: string[]): Promise<void> {
    const id = epochKeyId(ref);
    const existing = this.cache.get(id);
    if (!existing) return;
    const recipients = new Set(existing.recipients);
    for (const a of accounts) recipients.add(a);
    this.cache.set(id, { ...existing, recipients: [...recipients] });
    if (existing.trusted) await this.flush();
  }

  async forget(ref: EpochKeyRef): Promise<void> {
    const id = epochKeyId(ref);
    const existing = this.cache.get(id);
    this.cache.delete(id);
    this.misses.delete(id);
    if (existing?.trusted) await this.flush();
  }

  /** Drops every cached key (Settings: "forget cached reading keys"). */
  async clear(): Promise<void> {
    this.cache.clear();
    this.misses.clear();
    await this.flush();
  }

  /** Number of cached keys (settings / diagnostics). */
  get size(): number {
    return this.cache.size;
  }

  /** Opens every sealed key the source holds for `me` under `ref`; nothing is cached. */
  async candidates(ref: EpochKeyRef, me: KeyResolverIdentity, source: KeySource): Promise<KeyCandidate[]> {
    const items = await source.keys(me.account, { author: ref.author, audienceId: toBase64url(ref.audienceId), epoch: ref.epoch });
    const out: KeyCandidate[] = [];
    for (const item of items) {
      const key = openSealedView(item, ref, me);
      if (key) out.push({ key, item });
    }
    return out;
  }

  /**
   * Caches a candidate: verified on chain -> trusted and persisted with the recipients the
   * chain record names; unverifiable (chain unreachable) -> memory only; rejected -> not kept.
   */
  async adopt(ref: EpochKeyRef, candidate: KeyCandidate, verify?: KeyVerifier): Promise<EpochKeyEntry | undefined> {
    if (verify) {
      let provenance: KeyProvenance;
      try {
        provenance = await verify(candidate.item, ref);
      } catch (error) {
        provenance = { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
      }
      if (provenance.status === "verified") {
        await this.put(ref, candidate.key, { recipients: provenance.recipients });
        return this.entry(ref);
      }
      if (provenance.status === "rejected") return undefined;
    }
    this.remember(ref, candidate.key);
    return this.entry(ref);
  }

  /**
   * The epoch key for `ref` when the signed-in identity has a sealed copy: from the cache,
   * otherwise from the source (first sealed key that opens and is not rejected on chain).
   */
  async resolve(ref: EpochKeyRef, me: KeyResolverIdentity, source: KeySource, options: ResolveOptions = {}): Promise<EpochKeyEntry | undefined> {
    await this.init();
    const cached = this.entry(ref);
    if (cached) return cached;
    const id = epochKeyId(ref);
    const now = options.now ?? Date.now();
    const missedAt = this.misses.get(id);
    if (missedAt !== undefined && now - missedAt < (options.retryAfterMs ?? 30_000)) return undefined;
    let candidates: KeyCandidate[];
    try {
      candidates = await this.candidates(ref, me, source);
    } catch {
      return undefined;
    }
    for (const candidate of candidates) {
      const adopted = await this.adopt(ref, candidate, options.verify);
      if (adopted) return adopted;
    }
    this.misses.set(id, now);
    return undefined;
  }

  /**
   * A key safe to publish with: the trusted cache entry, else a sealed copy from the source
   * whose provenance verifies on chain. `unverifiable` is set when a copy opened but the chain
   * could not be consulted, so the caller must not generate a competing key.
   */
  async resolveTrusted(ref: EpochKeyRef, me: KeyResolverIdentity, source: KeySource, verify?: KeyVerifier): Promise<{ entry?: EpochKeyEntry; unverifiable: boolean }> {
    await this.init();
    const cached = this.trusted(ref);
    if (cached) return { entry: cached, unverifiable: false };
    let candidates: KeyCandidate[];
    try {
      candidates = await this.candidates(ref, me, source);
    } catch {
      return { unverifiable: false };
    }
    let unverifiable = false;
    for (const candidate of candidates) {
      if (!verify) {
        unverifiable = true;
        continue;
      }
      let provenance: KeyProvenance;
      try {
        provenance = await verify(candidate.item, ref);
      } catch (error) {
        provenance = { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
      }
      if (provenance.status === "verified") {
        await this.put(ref, candidate.key, { recipients: provenance.recipients });
        return { entry: this.entry(ref), unverifiable: false };
      }
      if (provenance.status === "unavailable") unverifiable = true;
    }
    return { unverifiable };
  }

  forgetMisses(): void {
    this.misses.clear();
  }

  private async flush(): Promise<void> {
    if (!this.persist) return;
    const data: KeyCache = {};
    for (const [id, entry] of this.cache) {
      if (entry.trusted) data[id] = { key: toHex(entry.key), recipients: entry.recipients };
    }
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
