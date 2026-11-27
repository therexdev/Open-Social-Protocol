/** Large hosted recordings: a small ledger reference, bounded upload/encryption
 * chunks, and no file bytes or per-chunk transactions on the chain. */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesEqual, concat, toBase64url, utf8 } from "./encoding.js";
import { randomBytes } from "./crypto/keys.js";
import { LIMITS } from "./constants.js";

export const HOSTED_FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const MEDIA_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
const MAGIC = utf8("OSPFILE2");
const HEADER_BYTES = 20;
const PREFIX = "osp-file:";
export const isClipLocation = (location: string | undefined): boolean => !!location && (location.startsWith("osp-clip://") || location.startsWith(PREFIX));
export function hostedFileUrl(location: string, digest?: Uint8Array): string {
  if (!location.startsWith(PREFIX) || location.length > LIMITS.maxLocationChars) throw Error("Invalid hosted recording reference.");
  const value = location.slice(PREFIX.length), url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    !url.pathname.includes("/osp/") || (digest && (digest.length !== 32 || !url.pathname.endsWith(`/${toBase64url(digest)}`))))
    throw Error("Invalid hosted recording reference.");
  return value;
}
export function hostedFileLocation(url: string, digest: Uint8Array): string {
  const location = `${PREFIX}${url}`; hostedFileUrl(location, digest); return location;
}
export function validateHostedFile(mime: string, size: number, durationMs: number): void {
  if (!["video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav"].includes(mime)) throw Error("Choose a supported video or audio file.");
  if (!Number.isSafeInteger(size) || size < 1 || size > HOSTED_FILE_MAX_BYTES) throw Error("Choose a recording up to 2 GiB.");
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) throw Error("The recording duration is unavailable.");
}
function chunkNonce(nonce: Uint8Array, index: number): Uint8Array {
  const result = new Uint8Array(nonce), view = new DataView(result.buffer);
  view.setBigUint64(16, view.getBigUint64(16) ^ BigInt(index)); return result;
}
function aad(header: Uint8Array, index: number) {
  const counter = new Uint8Array(8); new DataView(counter.buffer).setBigUint64(0, BigInt(index)); return concat(header, counter);
}

/** The public path reads the original File without copying it. Private files use
 * authenticated chunks; no multi-gigabyte ArrayBuffer or base64 draft is made. */
export async function prepareHostedBlob(file: Blob, encrypted: boolean, assertActive: () => void = () => {}) {
  if (!file.size || file.size > HOSTED_FILE_MAX_BYTES) throw Error("Choose a recording up to 2 GiB.");
  const hash = sha256.create(), parts: Blob[] = [];
  const key = encrypted ? randomBytes(32) : undefined, nonce = encrypted ? randomBytes(24) : undefined;
  const header = new Uint8Array(HEADER_BYTES); header.set(MAGIC);
  new DataView(header.buffer).setUint32(8, MEDIA_UPLOAD_PART_BYTES);
  new DataView(header.buffer).setBigUint64(12, BigInt(file.size));
  if (encrypted) { hash.update(header); parts.push(new Blob([header])); }
  try {
    for (let offset = 0, index = 0; offset < file.size; offset += MEDIA_UPLOAD_PART_BYTES, index++) {
      assertActive();
      const plain = new Uint8Array(await file.slice(offset, offset + MEDIA_UPLOAD_PART_BYTES).arrayBuffer());
      assertActive();
      const stored = key && nonce ? xchacha20poly1305(key, chunkNonce(nonce, index), aad(header, index)).encrypt(plain) : plain;
      hash.update(stored);
      if (encrypted) { parts.push(new Blob([new Uint8Array(stored)])); plain.fill(0); stored.fill(0); }
    }
    const blob = encrypted ? new Blob(parts, { type: "application/octet-stream" }) : file;
    if (blob.size > HOSTED_FILE_MAX_BYTES) throw Error("The encrypted recording exceeds 2 GiB. Choose a slightly smaller file.");
    assertActive();
    return { blob, digest: hash.digest(), ...(key && nonce && { encryption: { key: new Uint8Array(key), nonce: new Uint8Array(nonce) } }) };
  } finally { key?.fill(0); }
}

/** Plaintext is released to a player only after the whole ciphertext's committed
 * size/hash and every chunk tag are verified. Swaps, omissions and truncation fail. */
export async function openHostedBlob(response: Response, digest: Uint8Array, size: number, mime: string,
  encryption?: { key: Uint8Array; nonce: Uint8Array }, signal?: AbortSignal): Promise<Blob> {
  if (!response.ok || !response.body || digest.length !== 32 || !Number.isSafeInteger(size) || size < 1 || size > HOSTED_FILE_MAX_BYTES)
    throw Error("The hosted recording is unavailable.");
  const reader = response.body.getReader(), hash = sha256.create(), parts: Blob[] = [];
  let pending = new Uint8Array(0), consumed = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const take = async (length: number) => {
    const result = new Uint8Array(length); let offset = 0;
    while (offset < length) {
      if (signal?.aborted) throw Error("Recording loading cancelled.");
      if (!pending.length) {
        const chunk = await reader.read();
        if (signal?.aborted) throw Error("Recording loading cancelled.");
        if (chunk.done) throw Error("The hosted recording is incomplete.");
        pending = new Uint8Array(chunk.value);
      }
      const count = Math.min(length - offset, pending.length);
      result.set(pending.subarray(0, count), offset); offset += count; pending = pending.subarray(count);
    }
    hash.update(result); consumed += result.length; return result;
  };
  try {
    if (encryption) {
      if (encryption.key.length !== 32 || encryption.nonce.length !== 24) throw Error("Invalid recording key.");
      const header = await take(HEADER_BYTES), view = new DataView(header.buffer);
      const chunkBytes = view.getUint32(8), plainSize = Number(view.getBigUint64(12));
      if (!bytesEqual(header.subarray(0, 8), MAGIC) || chunkBytes !== MEDIA_UPLOAD_PART_BYTES || !Number.isSafeInteger(plainSize) || plainSize < 1 ||
        HEADER_BYTES + plainSize + 16 * Math.ceil(plainSize / chunkBytes) !== size) throw Error("Invalid encrypted recording header.");
      for (let offset = 0, index = 0; offset < plainSize; offset += chunkBytes, index++) {
        const cipher = await take(Math.min(chunkBytes, plainSize - offset) + 16);
        const plain = xchacha20poly1305(encryption.key, chunkNonce(encryption.nonce, index), aad(header, index)).decrypt(cipher);
        parts.push(new Blob([new Uint8Array(plain)])); plain.fill(0);
      }
    } else while (consumed < size) parts.push(new Blob([await take(Math.min(MEDIA_UPLOAD_PART_BYTES, size - consumed))]));
    if (pending.length || !(await reader.read()).done || consumed !== size || !bytesEqual(hash.digest(), digest)) throw Error("Recording does not match its published fingerprint.");
    if (signal?.aborted) throw Error("Recording loading cancelled.");
    return new Blob(parts, { type: mime });
  } finally { signal?.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
