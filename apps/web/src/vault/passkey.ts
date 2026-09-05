/**
 * Optional passkey unlock (WebAuthn PRF extension). The PRF output wraps a random vault
 * secret; when PRF is unavailable the client silently falls back to the passphrase.
 */
import { utf8 } from "@osp/sdk";
import { bytesOf, toArrayBuffer, toBase64url } from "../util/bytes";

export interface PasskeyRecord {
  credentialId: string;
  /** PRF evaluation salt (base64url, 32 bytes). */
  salt: string;
  iv: string;
  /** AES-GCM wrapped vault secret (base64url). */
  wrapped: string;
}

export interface PasskeyAdapter {
  supported(): Promise<boolean>;
  enroll(account: string, secret: Uint8Array): Promise<PasskeyRecord>;
  open(record: PasskeyRecord): Promise<Uint8Array>;
}

export class PasskeyError extends Error {
  override name = "PasskeyError";
}

type PrfExtensionResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

async function prfKey(output: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", output, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(utf8("osp/web/passkey")), info: toArrayBuffer(utf8("vault-secret")) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function rpId(): string {
  return location.hostname || "localhost";
}

async function evaluate(credentialId: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: rpId(),
      allowCredentials: [{ id: toArrayBuffer(credentialId), type: "public-key" }],
      userVerification: "required",
      extensions: { prf: { eval: { first: toArrayBuffer(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new PasskeyError("No passkey was selected.");
  const results = assertion.getClientExtensionResults() as PrfExtensionResults;
  const first = results.prf?.results?.first;
  if (!first) throw new PasskeyError("This passkey does not support the PRF extension; use your passphrase.");
  return first;
}

export const webauthnPasskey: PasskeyAdapter = {
  async supported() {
    try {
      if (typeof PublicKeyCredential === "undefined" || !navigator.credentials) return false;
      const withCaps = PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> };
      if (typeof withCaps.getClientCapabilities === "function") {
        const caps = await withCaps.getClientCapabilities();
        if (caps["extension:prf"] === false) return false;
      }
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  async enroll(account, secret) {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Open Social", id: rpId() },
        user: { id: toArrayBuffer(utf8(account)), name: account, displayName: `Open Social ${account.slice(0, 8)}` },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
        timeout: 120_000,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new PasskeyError("Passkey creation was cancelled.");
    const enabled = (credential.getClientExtensionResults() as PrfExtensionResults).prf?.enabled;
    if (enabled === false) throw new PasskeyError("This passkey does not support the PRF extension; use your passphrase.");
    const credentialId = new Uint8Array(credential.rawId);
    const output = await evaluate(credentialId, salt);
    const key = await prfKey(output);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(secret));
    return { credentialId: toBase64url(credentialId), salt: toBase64url(salt), iv: toBase64url(iv), wrapped: toBase64url(new Uint8Array(wrapped)) };
  },

  async open(record) {
    const output = await evaluate(bytesOf(record.credentialId), bytesOf(record.salt));
    const key = await prfKey(output);
    try {
      const secret = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(bytesOf(record.iv)) }, key, toArrayBuffer(bytesOf(record.wrapped)));
      return new Uint8Array(secret);
    } catch {
      throw new PasskeyError("The passkey did not unlock the vault; use your passphrase.");
    }
  },
};

export const unsupportedPasskey: PasskeyAdapter = {
  supported: async () => false,
  enroll: async () => {
    throw new PasskeyError("Passkeys are not available here.");
  },
  open: async () => {
    throw new PasskeyError("Passkeys are not available here.");
  },
};
