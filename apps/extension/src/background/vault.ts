/**
 * The extension vault and its device-key policy.
 *
 * At rest (chrome.storage.local, VAULT_KEY): a VaultRecord whose `blob` is an SDK VaultBlob
 * (scrypt + XChaCha20-Poly1305 under the user's passphrase). Two modes:
 *
 *  - "owner": the blob holds the identity seed (plus the device secret). This is the state right
 *    after create/import, until the device has been authorized on chain, and afterwards only when
 *    the user explicitly opted to keep the identity seed in this browser.
 *  - "device" (default after authorization): the blob holds ONLY the device secp256k1 secret and
 *    the X25519 encryption secret (needed to read friends-only posts). The identity seed is
 *    discarded: this browser can publish/react/comment/manage relationships within the device's
 *    capabilities and expiry, but cannot rotate keys, authorize devices, block or recover. Losing
 *    the browser loses nothing that the identity file cannot restore.
 *
 * The SDK's VaultSecrets requires a 32-byte `seed`; in device mode that slot carries the
 * encryption secret and `meta.mode === "device"` says so (see openIssues in the report).
 *
 * While unlocked, the secrets live in memory and in chrome.storage.session (cleared when the
 * browser closes, never written to disk) so a restarted service worker stays unlocked until the
 * auto-lock alarm fires. Locking clears both. Secrets never reach a page or a content script.
 */
import {
  CAPABILITY,
  VaultError,
  deriveEncryptionKeyPair,
  deviceKeyPair,
  encryptionPublicKey,
  exportIdentity,
  fromHex,
  identityFromSeed,
  importIdentity,
  lockVault,
  newIdentitySeed,
  signerFromSecret,
  signerFromSeed,
  toHex,
  unlockVault,
  type Rng,
  type Signer,
  type VaultBlob,
  type VaultKdfParams,
  type VaultSecrets,
} from "@osp/sdk";
import type { KeyValueArea } from "../shared/storage";
import type { DeviceInfo, VaultMode, VaultStatus } from "../shared/protocol";

export const VAULT_KEY = "osp.vault";
export const SESSION_KEY = "osp.session";
/** publish | react | comment | relationships (never community/profile administration). */
export const DEVICE_CAPABILITIES = CAPABILITY.PUBLISH | CAPABILITY.REACT | CAPABILITY.COMMENT | CAPABILITY.RELATIONSHIPS;
export const MIN_PASSPHRASE = 8;

export interface VaultRecord {
  version: 1;
  account: string;
  mode: VaultMode;
  keyVersion: number;
  blob: VaultBlob;
  device?: DeviceInfo;
  createdAt: number;
  updatedAt: number;
}

/** Everything that exists only while unlocked (hex for byte fields). */
export interface UnlockedSession {
  account: string;
  keyVersion: number;
  mode: VaultMode;
  encryptionSecret: string;
  encryptionPublicKey: string;
  deviceSecret: string;
  deviceAddress: string;
  /** Present only in owner mode. */
  ownerSeed?: string;
  unlockedAt: number;
  lastActivity: number;
}

export interface VaultManagerOptions {
  local: KeyValueArea;
  session: KeyValueArea;
  /** Weaker scrypt parameters for tests. */
  kdf?: Partial<Omit<VaultKdfParams, "name">>;
  now?: () => number;
  rng?: Rng;
}

export interface VaultView {
  status: VaultStatus;
  account?: string;
  mode?: VaultMode;
  device?: DeviceInfo;
  deviceAuthorized: boolean;
  ownerAvailable: boolean;
  encryptionPublicKey?: string;
  lastActivity?: number;
}

function checkPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new VaultError(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  }
}

export class VaultManager {
  private readonly local: KeyValueArea;
  private readonly sessionArea: KeyValueArea;
  private readonly kdf: VaultManagerOptions["kdf"];
  private readonly now: () => number;
  private readonly rng: Rng | undefined;
  private cached: UnlockedSession | undefined;

  constructor(options: VaultManagerOptions) {
    this.local = options.local;
    this.sessionArea = options.session;
    this.kdf = options.kdf;
    this.now = options.now ?? (() => Date.now());
    this.rng = options.rng;
  }

  private lockOptions() {
    return { ...(this.kdf && { kdf: this.kdf }), ...(this.rng && { rng: this.rng }) };
  }

  async record(): Promise<VaultRecord | undefined> {
    const record = await this.local.get<VaultRecord>(VAULT_KEY);
    return record && record.version === 1 ? record : undefined;
  }

  /** The unlocked session (memory, then chrome.storage.session), if any. */
  async current(): Promise<UnlockedSession | undefined> {
    if (this.cached) return this.cached;
    const stored = await this.sessionArea.get<UnlockedSession>(SESSION_KEY);
    if (stored && typeof stored.account === "string") this.cached = stored;
    return this.cached;
  }

  async status(): Promise<VaultView> {
    const record = await this.record();
    if (!record) return { status: "empty", deviceAuthorized: false, ownerAvailable: false };
    const session = await this.current();
    return {
      status: session ? "unlocked" : "locked",
      account: record.account,
      mode: record.mode,
      ...(record.device && { device: record.device }),
      deviceAuthorized: record.device !== undefined,
      ownerAvailable: session?.ownerSeed !== undefined,
      ...(session && { encryptionPublicKey: session.encryptionPublicKey, lastActivity: session.lastActivity }),
    };
  }

  private async enter(session: UnlockedSession): Promise<UnlockedSession> {
    this.cached = session;
    await this.sessionArea.set(SESSION_KEY, session);
    return session;
  }

  private async storeOwnerVault(seed: Uint8Array, keyVersion: number, passphrase: string): Promise<UnlockedSession> {
    const identity = identityFromSeed(seed, keyVersion);
    const device = deviceKeyPair(this.rng);
    const secrets: VaultSecrets = {
      seed,
      keyVersion,
      account: identity.account,
      deviceSecret: device.secret,
      deviceAddress: device.address,
      meta: { mode: "owner" },
    };
    const blob = await lockVault(secrets, passphrase, this.lockOptions());
    const at = this.now();
    const record: VaultRecord = { version: 1, account: identity.account, mode: "owner", keyVersion, blob, createdAt: at, updatedAt: at };
    await this.local.set(VAULT_KEY, record);
    return this.enter({
      account: identity.account,
      keyVersion,
      mode: "owner",
      encryptionSecret: toHex(identity.encryption.secretKey),
      encryptionPublicKey: toHex(identity.encryption.publicKey),
      deviceSecret: toHex(device.secret),
      deviceAddress: device.address,
      ownerSeed: toHex(seed),
      unlockedAt: at,
      lastActivity: at,
    });
  }

  /** Generates a new identity locally. The vault starts in owner mode (device not authorized yet). */
  async create(passphrase: string): Promise<UnlockedSession> {
    checkPassphrase(passphrase);
    if (await this.record()) throw new VaultError("This browser already holds an account. Remove it first.");
    return this.storeOwnerVault(newIdentitySeed(this.rng), 1, passphrase);
  }

  /** Imports the web client's identity file (JSON { version: 1, seed, keyVersion, account }). */
  async import(json: string, passphrase: string): Promise<UnlockedSession> {
    checkPassphrase(passphrase);
    if (await this.record()) throw new VaultError("This browser already holds an account. Remove it first.");
    const imported = importIdentity(json);
    return this.storeOwnerVault(imported.seed, imported.keyVersion, passphrase);
  }

  private sessionFromSecrets(record: VaultRecord, secrets: VaultSecrets): UnlockedSession {
    if (!secrets.deviceSecret || !secrets.deviceAddress) throw new VaultError("The vault has no device key; remove the account and import it again.");
    if (signerFromSecret(secrets.deviceSecret).getAddress() !== secrets.deviceAddress) throw new VaultError("The vault's device key does not match its address.");
    const mode = (secrets.meta?.mode as VaultMode | undefined) ?? record.mode;
    const at = this.now();
    if (mode === "device") {
      return {
        account: secrets.account,
        keyVersion: secrets.keyVersion,
        mode,
        encryptionSecret: toHex(secrets.seed),
        encryptionPublicKey: toHex(encryptionPublicKey(secrets.seed)),
        deviceSecret: toHex(secrets.deviceSecret),
        deviceAddress: secrets.deviceAddress,
        unlockedAt: at,
        lastActivity: at,
      };
    }
    const identity = identityFromSeed(secrets.seed, secrets.keyVersion);
    if (identity.account !== secrets.account) throw new VaultError("The vault's seed does not match its account.");
    return {
      account: identity.account,
      keyVersion: secrets.keyVersion,
      mode: "owner",
      encryptionSecret: toHex(identity.encryption.secretKey),
      encryptionPublicKey: toHex(identity.encryption.publicKey),
      deviceSecret: toHex(secrets.deviceSecret),
      deviceAddress: secrets.deviceAddress,
      ownerSeed: toHex(secrets.seed),
      unlockedAt: at,
      lastActivity: at,
    };
  }

  async unlock(passphrase: string): Promise<UnlockedSession> {
    const record = await this.record();
    if (!record) throw new VaultError("There is no account in this browser yet.");
    const secrets = await unlockVault(record.blob, passphrase);
    return this.enter(this.sessionFromSecrets(record, secrets));
  }

  async lock(): Promise<void> {
    this.cached = undefined;
    await this.sessionArea.remove(SESSION_KEY);
  }

  async touch(): Promise<void> {
    const session = await this.current();
    if (!session) return;
    session.lastActivity = this.now();
    await this.sessionArea.set(SESSION_KEY, session);
  }

  /** Locks when idle for longer than `autoLockMs` (0 disables); returns true when it locked. */
  async checkAutoLock(autoLockMs: number, at = this.now()): Promise<boolean> {
    const session = await this.current();
    if (!session || autoLockMs <= 0) return false;
    if (at - session.lastActivity >= autoLockMs) {
      await this.lock();
      return true;
    }
    return false;
  }

  /**
   * Records the on-chain device authorization and applies the seed policy: unless
   * `keepOwnerSeed`, the vault is re-locked in device mode without the identity seed.
   * The passphrase is required because the blob has to be re-encrypted.
   */
  async completeDeviceAuthorization(input: { passphrase: string; keepOwnerSeed: boolean; device: DeviceInfo }): Promise<UnlockedSession> {
    const record = await this.record();
    if (!record) throw new VaultError("There is no account in this browser yet.");
    const secrets = await unlockVault(record.blob, input.passphrase);
    const mode = (secrets.meta?.mode as VaultMode | undefined) ?? record.mode;
    if (mode !== "owner") throw new VaultError("The identity seed is not in this browser; import the identity file to authorize a device.");
    if (!secrets.deviceSecret || !secrets.deviceAddress) throw new VaultError("The vault has no device key.");
    if (secrets.deviceAddress !== input.device.address) throw new VaultError("The authorized device does not match the vault's device key.");
    const at = this.now();
    let blob: VaultBlob;
    let nextMode: VaultMode;
    if (input.keepOwnerSeed) {
      nextMode = "owner";
      blob = await lockVault({ ...secrets, meta: { mode: "owner", device: input.device } }, input.passphrase, this.lockOptions());
    } else {
      nextMode = "device";
      const encryption = deriveEncryptionKeyPair(secrets.seed, secrets.keyVersion);
      const deviceSecrets: VaultSecrets = {
        // Device mode: the mandatory `seed` slot carries the X25519 encryption secret, never the identity seed.
        seed: encryption.secretKey,
        keyVersion: secrets.keyVersion,
        account: secrets.account,
        deviceSecret: secrets.deviceSecret,
        deviceAddress: secrets.deviceAddress,
        meta: { mode: "device", seedSlot: "encryption-secret", device: input.device },
      };
      blob = await lockVault(deviceSecrets, input.passphrase, this.lockOptions());
    }
    const next: VaultRecord = { ...record, mode: nextMode, blob, device: input.device, updatedAt: at };
    await this.local.set(VAULT_KEY, next);
    const session = this.sessionFromSecrets(next, await unlockVault(blob, input.passphrase));
    return this.enter(session);
  }

  /** Throws VaultError unless the passphrase opens the vault. */
  async verifyPassphrase(passphrase: string): Promise<void> {
    const record = await this.record();
    if (!record) throw new VaultError("There is no account in this browser yet.");
    await unlockVault(record.blob, passphrase);
  }

  /** The identity file (only when the identity seed is in this browser). */
  async export(passphrase: string): Promise<string> {
    const record = await this.record();
    if (!record) throw new VaultError("There is no account in this browser yet.");
    const secrets = await unlockVault(record.blob, passphrase);
    const mode = (secrets.meta?.mode as VaultMode | undefined) ?? record.mode;
    if (mode !== "owner") {
      throw new VaultError("This browser holds only a device key. Export the identity file from the client that holds your identity (the web client or the browser where you created it).");
    }
    return exportIdentity({ seed: secrets.seed, keyVersion: secrets.keyVersion, account: secrets.account });
  }

  async destroy(): Promise<void> {
    await this.lock();
    await this.local.remove(VAULT_KEY);
  }

  /** Signers for an unlocked session: the device key always, the owner key only in owner mode. */
  signers(session: UnlockedSession): { device: Signer; owner?: Signer } {
    const device = signerFromSecret(fromHex(session.deviceSecret));
    return { device, ...(session.ownerSeed && { owner: signerFromSeed(fromHex(session.ownerSeed)) }) };
  }

  encryption(session: UnlockedSession): { secretKey: Uint8Array; publicKey: Uint8Array; keyVersion: number } {
    return { secretKey: fromHex(session.encryptionSecret), publicKey: fromHex(session.encryptionPublicKey), keyVersion: session.keyVersion };
  }
}
