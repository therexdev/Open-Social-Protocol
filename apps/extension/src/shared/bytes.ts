/**
 * Byte helpers on top of the SDK encoders. The indexer serves bytes as base64url strings; the
 * SDK works with Uint8Array; hex is used for persisted records (attempt ids, post ids).
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

/** hex -> bytes; malformed input yields an empty array. */
export function bytesOfHex(value: string | undefined | null): Uint8Array {
  if (!value) return new Uint8Array(0);
  try {
    return fromHex(value);
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

export function randomHex(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function isHex(value: unknown, bytes?: number): value is string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) return false;
  return bytes === undefined ? value.length > 0 : value.length === bytes * 2;
}
