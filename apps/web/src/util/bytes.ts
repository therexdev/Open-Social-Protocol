/**
 * Byte helpers on top of the SDK encoders. The indexer serves bytes as base64url strings;
 * the SDK works with Uint8Array; hex is used for local persistence keys.
 */
import { fromBase64url, fromHex, toBase64url, toHex } from "@osp/sdk";

export { fromBase64url, fromHex, toBase64url, toHex };

/** base64url -> bytes; empty or malformed input yields an empty array instead of throwing. */
export function bytesOf(value: string | undefined | null): Uint8Array {
  if (!value) return new Uint8Array(0);
  try {
    return fromBase64url(value);
  } catch {
    return new Uint8Array(0);
  }
}

/** A copy of `bytes` backed by a plain ArrayBuffer (what WebCrypto wants). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** sha256 of arbitrary bytes through WebCrypto (media hashes). */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(digest);
}

export function randomId(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
