/** Opt-in hot-wallet access for this browser profile, never a passphrase cache.
 * A non-exportable browser key encrypts the identity in IndexedDB. This does NOT
 * protect against someone using this browser, malicious same-origin JS, or a
 * compromised device. The ordinary passphrase-encrypted vault remains intact.
 */
import { contentHash, exportIdentity, importIdentity, toBase64url, utf8, type Identity, type VaultBlob } from "@osp/sdk";
import { decryptJson, encryptJson, type EncryptedRecord } from "./encryptedStore";
import type { KeyValueStorage } from "./storage";

export const REMEMBER_MS = 30 * 24 * 60 * 60_000;
export const REMEMBER_POINTER = "osp.web.remember-device";
export const rememberedKey = (id: string) => `${REMEMBER_POINTER}.${id}`;
export interface RememberPointer {
  get(): string | undefined;
  set(id: string): void;
  clear(): void;
}
export interface RememberedRecord {
  version: 1;
  key: CryptoKey;
  encrypted: EncryptedRecord;
}
export interface RememberedPayload {
  id: string;
  account: string;
  vaultHash: string;
  createdAt: number;
  expiresAt: number;
  identity: string;
}
export const vaultHash = (blob: VaultBlob) => toBase64url(contentHash(utf8(JSON.stringify(blob))));

export function browserRememberPointer(): RememberPointer | undefined {
  try {
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return undefined;
    const storage = window.localStorage;
    // Only a non-secret record identifier is ever saved here. Clearing it is
    // synchronous, so Lock now stays effective even before IndexedDB completes.
    return {
      get: () => storage.getItem(REMEMBER_POINTER) ?? undefined,
      set: (id) => storage.setItem(REMEMBER_POINTER, id),
      clear: () => storage.removeItem(REMEMBER_POINTER),
    };
  } catch { return undefined; }
}

export async function makeRemembered(identity: Identity, blob: VaultBlob, now: number) {
  const id = toBase64url(crypto.getRandomValues(new Uint8Array(24)));
  const payload: RememberedPayload = {
    id, account: identity.account, vaultHash: vaultHash(blob),
    createdAt: now, expiresAt: now + REMEMBER_MS,
    identity: exportIdentity(identity),
  };
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const record: RememberedRecord = { version: 1, key, encrypted: await encryptJson(key, payload) };
  return { id, record, expiresAt: payload.expiresAt };
}

export async function readRemembered(storage: KeyValueStorage, id: string, account: string, blob: VaultBlob, now: number) {
  const record = await storage.get<RememberedRecord>(rememberedKey(id));
  if (!record || record.version !== 1 || record.key.extractable !== false) return undefined;
  const p = await decryptJson<RememberedPayload>(record.key, record.encrypted);
  if (p.id !== id || p.account !== account || p.vaultHash !== vaultHash(blob) ||
      !Number.isFinite(p.createdAt) || !Number.isFinite(p.expiresAt) ||
      p.expiresAt !== p.createdAt + REMEMBER_MS || now < p.createdAt || now >= p.expiresAt) return undefined;
  const identity = importIdentity(p.identity);
  if (identity.account !== account) return undefined;
  return { identity, expiresAt: p.expiresAt };
}
