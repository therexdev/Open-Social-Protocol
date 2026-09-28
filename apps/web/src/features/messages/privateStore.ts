import {
  fromBase64url,
  randomBytes,
  toBase64url,
  x25519KeyPair,
  type PrivateScope,
  type RatchetSetup,
  type RatchetState,
  type RatchetWire,
} from "@osp/sdk";
import {
  decryptJson,
  deriveAesKey,
  encryptJson,
  type EncryptedRecord,
} from "../../vault/encryptedStore";
import { defaultStorage, type KeyValueStorage } from "../../vault/storage";

export interface Invitation {
  kind: "invite";
  id: string;
  from: string;
  to: string;
  deviceId: string;
  alias: string;
  identityKey: string;
  oneTimeKey: string;
  returnKey: string;
  createdAt: number;
  expiresAt: number;
}
export interface Acceptance {
  kind: "accept";
  id: string;
  from: string;
  to: string;
  alias: string;
  peerAlias: string;
}
export interface Closure {
  kind: "close";
  id: string;
  from: string;
  to: string;
  createdAt: number;
}
export interface Signed<T> {
  value: T;
  signature: string;
}
export interface AcceptanceEnvelope {
  kind: "accept";
  id: string;
  identityKey: string;
  wire: RatchetWire;
}
export interface LocalMessage {
  id: string;
  text: string;
  mine: boolean;
  timestamp: number;
  state: "sending" | "confirming" | "sent" | "not-sent" | "stopped";
  envelopeHash?: string;
}
export interface PrivateChat {
  id: string;
  peer: string;
  aliasId: string;
  alias: string;
  peerAlias?: string;
  status: "outgoing" | "incoming" | "accepting" | "ready" | "closed";
  setup?: RatchetSetup;
  returnSecret?: string;
  invitation?: Invitation;
  ratchet?: RatchetState;
  after: string;
  messages: LocalMessage[];
  createdAt: number;
  closeNotice?: "needed" | "queued" | "sent" | "received";
  closedAt?: number;
  closeChannelPending?: boolean;
  closeChannelAttempt?: number;
  closeError?: string;
  supersededBy?: string;
}
export interface PrivateOutbox {
  id: string;
  actor: string;
  derivationId: string;
  purpose: "invitation" | "conversation";
  peer: string;
  envelope: string;
  chatId: string;
  kind?: "close";
  lastAttempt?: number;
  error?: string;
  observed?: boolean;
}
export interface Funding {
  id: string;
  sponsor: string;
  endpoint: string;
  units: number;
  lastAttempt?: number;
  grantId?: string;
  lastAllocationAttempt?: number;
}
export interface PrivateFile {
  version: 2;
  deviceId: string;
  deliverySecret: string;
  deliveryPublic: string;
  pickleKey: string;
  enabled: boolean;
  registered?: boolean;
  autoConnect?: boolean;
  prepareInAdvance?: boolean;
  spareAliasId?: string;
  spareAliasReady?: boolean;
  deviceAttempt?: number;
  inboxAfter: string;
  inboxValidation?: 1 | 2;
  chats: PrivateChat[];
  outbox: PrivateOutbox[];
  funding: Record<string, Funding>;
  closedRequests?: Array<{ id: string; peer: string; expiresAt: number }>;
}
export interface QueuedPrivateMessage {
  id: string;
  peer: string;
  chatId?: string;
  text: string;
  createdAt: number;
}
export type ExclusiveLock = <T>(
  name: string,
  action: () => Promise<T>,
) => Promise<T>;
const browserLock: ExclusiveLock = async (name, action) => {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new Error(
      "Private messaging requires a browser with secure storage and Web Locks support. Update your browser and try again.",
    );
  return navigator.locks.request(name, { mode: "exclusive" }, action);
};

/** Dual protection: random non-extractable device key AND unlocked account material.
 * Account recovery exports have neither this key nor a copy of the messaging state.
 * One encrypted document atomically commits ratchet advancement + outbox/history.
 */
export class PrivateStore {
  readonly name: string;
  constructor(
    readonly account: string,
    readonly seed: Uint8Array,
    readonly scope: PrivateScope,
    private readonly active: () => boolean,
    private readonly storage: KeyValueStorage = defaultStorage(),
    private readonly lock: ExclusiveLock = browserLock,
  ) {
    this.name = `osp.private.v2:${scope.chainId}:${scope.contract}:${account}`;
  }
  /** A separate encrypted queue keeps typing/sending independent of a slow sync.
   * Ratchets remain exclusively in edit(); queue entries are removed only after
   * their message ID and advanced ratchet have been committed there together.
   */
  async drafts<T>(action: (drafts: QueuedPrivateMessage[]) => T): Promise<T> {
    return this.lock(`${this.name}:drafts`, async () => {
      this.assertActive();
      const key = await this.storage.get<CryptoKey>(`${this.name}:key`);
      if (!key) throw new Error("Enable private messages on this browser first");
      const accountKey = await deriveAesKey(this.seed, this.name);
      const name = `${this.name}:drafts`;
      const record = await this.storage.get<EncryptedRecord>(name);
      const drafts = record ? await decryptJson<QueuedPrivateMessage[]>(accountKey, await decryptJson<EncryptedRecord>(key, record)) : [];
      const before = JSON.stringify(drafts);
      const result = action(drafts);
      if (JSON.stringify(drafts) !== before) {
        const encrypted = await encryptJson(key, await encryptJson(accountKey, drafts));
        this.assertActive();
        await this.storage.set(name, encrypted);
      }
      this.assertActive();
      return result;
    });
  }
  async edit<T>(
    action: (data: PrivateFile, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.lock(this.name, async () => {
      this.assertActive();
      // Allows "remove account from this browser" to remove every network's chat keys.
      await this.lock(`osp.private.registry:${this.account}`, async () => {
        const registry = `osp.private.registry:${this.account}`;
        const names = (await this.storage.get<string[]>(registry)) ?? [];
        if (!names.includes(this.name))
          await this.storage.set(registry, [...names, this.name]);
      });
      const record = await this.storage.get<EncryptedRecord>(this.name);
      let key = await this.storage.get<CryptoKey>(`${this.name}:key`);
      if (!key && record)
        throw new Error(
          "This browser's messaging key is missing. Account recovery cannot restore these conversations.",
        );
      if (!key) {
        key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
        await this.storage.set(`${this.name}:key`, key);
      }
      const accountKey = await deriveAesKey(this.seed, this.name);
      const deviceKey = key;
      let data: PrivateFile;
      if (record) {
        const inner = await decryptJson<EncryptedRecord>(deviceKey, record);
        data = await decryptJson<PrivateFile>(accountKey, inner);
        if (data.version !== 2)
          throw new Error("Unsupported private messaging storage version");
      } else {
        const delivery = x25519KeyPair();
        data = {
          version: 2,
          deviceId: toBase64url(randomBytes(32)),
          deliverySecret: toBase64url(delivery.secretKey),
          deliveryPublic: toBase64url(delivery.publicKey),
          pickleKey: toBase64url(randomBytes(32)),
          enabled: false,
          inboxAfter: "0",
          chats: [],
          outbox: [],
          funding: {},
        };
        delivery.secretKey.fill(0);
      }
      let committed = record ? JSON.stringify(data) : undefined;
      const save = async () => {
        this.assertActive();
        const next = JSON.stringify(data);
        // A polling read must not rewrite the entire history. Explicit commit points
        // also must not get a second, potentially failing write at the end of edit().
        if (next === committed) return;
        const encrypted = await encryptJson(
          deviceKey,
          await encryptJson(accountKey, data),
        );
        this.assertActive();
        await this.storage.set(this.name, encrypted);
        committed = next;
      };
      this.assertActive();
      const result = await action(data, save);
      await save();
      return result;
    });
  }
  assertActive(): void {
    if (!this.active())
      throw new Error("Unlock your account to continue private messaging");
  }
}

export function validId(id: unknown): id is string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{43}=$/.test(id)) return false;
  try {
    return (
      fromBase64url(id).length === 32 && toBase64url(fromBase64url(id)) === id
    );
  } catch {
    return false;
  }
}
