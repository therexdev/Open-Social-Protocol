/**
 * The vault: the identity seed encrypted under a passphrase (SDK lockVault, scrypt +
 * XChaCha20-Poly1305) in IndexedDB; unlocked secrets live only in this in-memory store and
 * are dropped on lock / auto-lock. Nothing secret ever touches localStorage.
 */
import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  VaultError,
  exportIdentity,
  identityFromSeed,
  importIdentity,
  lockVault,
  newIdentitySeed,
  toHex,
  unlockVault,
  type Identity,
  type VaultBlob,
  type VaultKdfParams,
} from "@osp/sdk";
import { KeyStore, type KeyCache } from "../api/keystore";
import { EncryptedStore, deriveAesKey } from "./encryptedStore";
import { type PasskeyAdapter, type PasskeyRecord, unsupportedPasskey, webauthnPasskey } from "./passkey";
import { defaultStorage, type KeyValueStorage } from "./storage";

export type VaultStatus = "loading" | "empty" | "locked" | "unlocked";

/** What is persisted (no plaintext secrets). */
export interface VaultRecord {
  version: 1;
  account: string;
  blob: VaultBlob;
  /** Passkey unlock: a second copy of the vault locked under a random secret wrapped by the PRF output. */
  passkey?: PasskeyRecord & { blob: VaultBlob };
  createdAt: number;
}

export interface DraftRecord {
  id: string;
  account: string;
  text: string;
  audience: number;
  mediaUrls: string[];
  replyTo?: string;
  edit?: { postId: string; previousVersion: string; versionNumber: number };
  createdAt: number;
  updatedAt: number;
  /** hex attempt id; the idempotency key derives from it. */
  attemptId: string;
  state: "draft" | "failed" | "unknown";
  lastError?: string;
}

export interface DraftsFile {
  drafts: DraftRecord[];
}

/** Everything that exists only while unlocked. */
export interface Session {
  identity: Identity;
  keys: KeyStore;
  drafts: EncryptedStore<DraftsFile>;
}

export interface VaultState {
  status: VaultStatus;
  account?: string;
  session?: Session;
  passkeyEnrolled: boolean;
  passkeyAvailable: boolean;
  lastActivity: number;
  autoLockMs: number;
  error?: string;
  init(): Promise<void>;
  create(passphrase: string): Promise<Identity>;
  importFromFile(json: string, passphrase: string): Promise<Identity>;
  unlock(passphrase: string): Promise<Identity>;
  unlockWithPasskey(): Promise<Identity>;
  enrollPasskey(passphrase: string): Promise<void>;
  removePasskey(): Promise<void>;
  changePassphrase(current: string, next: string): Promise<void>;
  lock(): void;
  touch(): void;
  /** Locks when idle for longer than `autoLockMs`; returns true when it locked. */
  checkAutoLock(now?: number): boolean;
  setAutoLockMs(ms: number): void;
  exportFile(): string;
  destroy(): Promise<void>;
}

export const VAULT_KEY = "osp.web.vault";

export interface VaultStoreOptions {
  storage?: KeyValueStorage;
  /** Weaker scrypt parameters for tests. */
  kdf?: Partial<Omit<VaultKdfParams, "name">>;
  passkey?: PasskeyAdapter;
  now?: () => number;
  autoLockMs?: number;
}

export type VaultStore = UseBoundStore<StoreApi<VaultState>>;

export function createVaultStore(options: VaultStoreOptions = {}): VaultStore {
  const storage = options.storage ?? defaultStorage();
  const passkey = options.passkey ?? (typeof navigator !== "undefined" && "credentials" in navigator ? webauthnPasskey : unsupportedPasskey);
  const now = options.now ?? (() => Date.now());
  const lockOptions = options.kdf ? { kdf: options.kdf } : {};

  const readRecord = () => storage.get<VaultRecord>(VAULT_KEY);

  async function openSession(identity: Identity): Promise<Session> {
    const keyCrypto = await deriveAesKey(identity.seed, "keystore");
    const draftCrypto = await deriveAesKey(identity.seed, "drafts");
    const keys = new KeyStore(new EncryptedStore<KeyCache>(storage, `osp.web.keys.${identity.account}`, keyCrypto));
    await keys.init();
    const drafts = new EncryptedStore<DraftsFile>(storage, `osp.web.drafts.${identity.account}`, draftCrypto);
    return { identity, keys, drafts };
  }

  return create<VaultState>()((set, get) => {
    const enter = async (identity: Identity): Promise<Identity> => {
      const session = await openSession(identity);
      set({ status: "unlocked", account: identity.account, session, lastActivity: now(), error: undefined });
      return identity;
    };

    return {
      status: "loading",
      passkeyEnrolled: false,
      passkeyAvailable: false,
      lastActivity: now(),
      autoLockMs: options.autoLockMs ?? 15 * 60_000,

      async init() {
        try {
          const record = await readRecord();
          const passkeyAvailable = await passkey.supported();
          if (record && record.version === 1) {
            set({ status: "locked", account: record.account, passkeyEnrolled: record.passkey !== undefined, passkeyAvailable, session: undefined });
          } else {
            set({ status: "empty", account: undefined, passkeyEnrolled: false, passkeyAvailable, session: undefined });
          }
        } catch (error) {
          set({ status: "empty", error: error instanceof Error ? error.message : String(error) });
        }
      },

      async create(passphrase) {
        if (passphrase.length < 8) throw new VaultError("Choose a passphrase of at least 8 characters.");
        const seed = newIdentitySeed();
        const identity = identityFromSeed(seed, 1);
        const blob = await lockVault({ seed, keyVersion: 1, account: identity.account }, passphrase, lockOptions);
        const record: VaultRecord = { version: 1, account: identity.account, blob, createdAt: now() };
        await storage.set(VAULT_KEY, record);
        set({ passkeyEnrolled: false });
        return enter(identity);
      },

      async importFromFile(json, passphrase) {
        if (passphrase.length < 8) throw new VaultError("Choose a passphrase of at least 8 characters.");
        const imported = importIdentity(json);
        const identity = identityFromSeed(imported.seed, imported.keyVersion);
        const blob = await lockVault({ seed: imported.seed, keyVersion: imported.keyVersion, account: identity.account }, passphrase, lockOptions);
        const record: VaultRecord = { version: 1, account: identity.account, blob, createdAt: now() };
        await storage.set(VAULT_KEY, record);
        set({ passkeyEnrolled: false });
        return enter(identity);
      },

      async unlock(passphrase) {
        const record = await readRecord();
        if (!record) throw new VaultError("There is no account on this device yet.");
        const secrets = await unlockVault(record.blob, passphrase);
        return enter(identityFromSeed(secrets.seed, secrets.keyVersion));
      },

      async unlockWithPasskey() {
        const record = await readRecord();
        if (!record?.passkey) throw new VaultError("No passkey is set up for this account.");
        const secret = await passkey.open(record.passkey);
        const secrets = await unlockVault(record.passkey.blob, toHex(secret));
        return enter(identityFromSeed(secrets.seed, secrets.keyVersion));
      },

      async enrollPasskey(passphrase) {
        const record = await readRecord();
        if (!record) throw new VaultError("There is no account on this device yet.");
        const secrets = await unlockVault(record.blob, passphrase);
        const secret = crypto.getRandomValues(new Uint8Array(32));
        const enrolled = await passkey.enroll(record.account, secret);
        const blob = await lockVault(secrets, toHex(secret), lockOptions);
        await storage.set(VAULT_KEY, { ...record, passkey: { ...enrolled, blob } });
        set({ passkeyEnrolled: true });
      },

      async removePasskey() {
        const record = await readRecord();
        if (!record) return;
        const { passkey: _removed, ...rest } = record;
        await storage.set(VAULT_KEY, rest);
        set({ passkeyEnrolled: false });
      },

      async changePassphrase(current, next) {
        if (next.length < 8) throw new VaultError("Choose a passphrase of at least 8 characters.");
        const record = await readRecord();
        if (!record) throw new VaultError("There is no account on this device yet.");
        const secrets = await unlockVault(record.blob, current);
        const blob = await lockVault(secrets, next, lockOptions);
        await storage.set(VAULT_KEY, { ...record, blob });
      },

      lock() {
        const { status, account } = get();
        if (status !== "unlocked") return;
        set({ status: "locked", session: undefined, account });
      },

      touch() {
        const state = get();
        if (state.status === "unlocked") set({ lastActivity: now() });
      },

      checkAutoLock(at = now()) {
        const state = get();
        if (state.status !== "unlocked" || state.autoLockMs <= 0) return false;
        if (at - state.lastActivity >= state.autoLockMs) {
          state.lock();
          return true;
        }
        return false;
      },

      setAutoLockMs(ms) {
        set({ autoLockMs: Math.max(0, ms) });
      },

      exportFile() {
        const session = get().session;
        if (!session) throw new VaultError("Unlock your account to export it.");
        const { seed, keyVersion, account } = session.identity;
        return exportIdentity({ seed, keyVersion, account });
      },

      async destroy() {
        const account = get().account;
        await storage.del(VAULT_KEY);
        if (account) {
          await storage.del(`osp.web.keys.${account}`);
          await storage.del(`osp.web.drafts.${account}`);
        }
        set({ status: "empty", session: undefined, account: undefined, passkeyEnrolled: false });
      },
    };
  });
}

export const useVault: VaultStore = createVaultStore();

/** Wires activity tracking and the auto-lock timer; returns a cleanup function. */
export function startAutoLock(store: VaultStore, intervalMs = 15_000): () => void {
  const touch = () => store.getState().touch();
  const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "focus", "scroll"];
  for (const name of events) window.addEventListener(name, touch, { passive: true });
  const onVisibility = () => {
    if (document.visibilityState === "visible") store.getState().checkAutoLock();
    else touch();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const timer = window.setInterval(() => store.getState().checkAutoLock(), intervalMs);
  return () => {
    for (const name of events) window.removeEventListener(name, touch);
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearInterval(timer);
  };
}
