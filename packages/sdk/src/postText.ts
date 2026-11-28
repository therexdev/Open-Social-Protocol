/** Long post text stays on hosting. The existing small publication envelope
 * authenticates its fingerprint, location and (inside private posts) reading key. */
import { bytesEqual, fromBase64url, toBase64url, utf8, utf8Decode } from "./encoding.js";
import { contentHash } from "./ids.js";
import { encryptMedia, openMedia, readMediaResponse } from "./media.js";
import type { Content } from "./crypto/envelope.js";

export const POST_TEXT_MAX_CHARACTERS = 100_000;
export const POST_TEXT_MAX_BYTES = 400_000;
export const POST_TEXT_REFERENCE_MAX_BYTES = 1024;
export const LONG_POST_FALLBACK = "This is a longer post. Update your Open Social client to read the full text.";
export function validatePostText(text: string): void {
  if (text.length > POST_TEXT_MAX_CHARACTERS) throw Error("Posts can contain up to 100,000 characters.");
  const bytes = utf8(text);
  if (bytes.length > POST_TEXT_MAX_BYTES || utf8Decode(bytes) !== text) throw Error("This post contains invalid text.");
}
type Reference = { version: 1; url: string; size: number; digest: string; key?: string; nonce?: string };
function encoded(value: unknown, length: number): value is string {
  if (typeof value !== "string") return false;
  try { const bytes = fromBase64url(value); return bytes.length === length && toBase64url(bytes) === value; } catch { return false; }
}
function reference(value: string, encrypted: boolean): Reference {
  if (utf8(value).length > POST_TEXT_REFERENCE_MAX_BYTES) throw Error("Invalid long-post reference.");
  const ref = JSON.parse(value) as Reference;
  if (!ref || ref.version !== 1 || typeof ref.url !== "string" || ref.url.length > 256 ||
    !Number.isSafeInteger(ref.size) || ref.size < (encrypted ? 17 : 1) || ref.size > POST_TEXT_MAX_BYTES + (encrypted ? 16 : 0) || !encoded(ref.digest, 32) ||
    Object.keys(ref).some(key => !["version", "url", "size", "digest", "key", "nonce"].includes(key)) ||
    (encrypted ? !encoded(ref.key, 32) || !encoded(ref.nonce, 24) : ref.key !== undefined || ref.nonce !== undefined)) throw Error("Invalid long-post reference.");
  const url = new URL(ref.url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.includes("/osp/") || !url.pathname.endsWith(`/${ref.digest}`))
    throw Error("Invalid long-post location.");
  return ref;
}

export async function storePostText(text: string, encrypted: boolean, store: (bytes: Uint8Array) => Promise<string>): Promise<string> {
  validatePostText(text);
  const plain = utf8(text), sealed = encrypted ? encryptMedia(plain) : undefined;
  const bytes = sealed?.ciphertext ?? plain;
  try {
    const url = await store(bytes);
    const result = JSON.stringify({ version: 1, url, size: bytes.length, digest: toBase64url(contentHash(bytes)),
      ...(sealed && { key: toBase64url(sealed.key), nonce: toBase64url(sealed.nonce) }) } satisfies Reference);
    reference(result, encrypted); return result;
  } finally { sealed?.key.fill(0); if (encrypted) plain.fill(0); }
}

/** Cache only verified stored bytes, never decrypted private text or keys. Failed
 * downloads remain retryable. Each client can supply its own fetch/cache. */
export function createPostTextResolver(fetchFn: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
  const cache = new Map<string, Uint8Array>(), pending = new Map<string, Promise<Uint8Array>>(); let cachedBytes = 0;
  const load = async (ref: Reference) => {
    const id = JSON.stringify([ref.url, ref.size, ref.digest]);
    const old = cache.get(id); if (old) { cache.delete(id); cache.set(id, old); return old; }
    const inFlight = pending.get(id); if (inFlight) return inFlight;
    const task = (async () => {
      const signal = AbortSignal.timeout(15_000);
      const response = await fetchFn(ref.url, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal });
      if (!response.ok) throw Error("The full text is temporarily unavailable. Please try again.");
      const bytes = await readMediaResponse(response, ref.size, signal);
      if (bytes.length !== ref.size || !bytesEqual(contentHash(bytes), fromBase64url(ref.digest))) throw Error("The full text does not match its published fingerprint.");
      cache.set(id, bytes); cachedBytes += bytes.length;
      while (cache.size > 32 || cachedBytes > 8 * 1024 * 1024) { const first = cache.keys().next().value!; cachedBytes -= cache.get(first)!.length; cache.delete(first); }
      return bytes;
    })();
    pending.set(id, task);
    try { return await task; } finally { pending.delete(id); }
  };
  return async <T extends Content>(content: T, encrypted: boolean): Promise<T> => {
    if (!content.text_ref) return content;
    if (content.text !== LONG_POST_FALLBACK || content.mime !== "text/plain") throw Error("Unsupported long-post content.");
    const ref = reference(content.text_ref, encrypted), stored = await load(ref), key = ref.key ? fromBase64url(ref.key) : undefined;
    try {
      const bytes = openMedia(stored, fromBase64url(ref.digest), key ? { key, nonce: fromBase64url(ref.nonce!) } : undefined);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); validatePostText(text);
      return { ...content, text };
    } finally { key?.fill(0); }
  };
}
export const resolvePostText = createPostTextResolver();
