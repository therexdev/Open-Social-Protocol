/** Ledger references to hosted content. The digest addresses the original bytes,
 * including ciphertext; the hosting domain is deployment configuration, never identity. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesEqual, fromBase64url, fromHex, toBase64url, toHex, utf8 } from "./encoding.js";
import { readMediaResponse } from "./media.js";

export const CONTENT_MAX_BYTES = 16 * 1024;
const MAGIC = utf8("OSPREF1\0");
const PREFIX = "osp:content:v1:";
export interface ContentReference { digest: Uint8Array; size: number }
export type ContentLoader = (reference: ContentReference) => Promise<Uint8Array>;

function valid(reference: ContentReference): ContentReference {
  if (reference.digest.length !== 32 || !Number.isInteger(reference.size) || reference.size < 1 || reference.size > CONTENT_MAX_BYTES)
    throw Error("Invalid hosted content reference.");
  return reference;
}
export function contentReference(bytes: Uint8Array): ContentReference {
  return valid({ digest: sha256(bytes), size: bytes.length });
}
export function encodeContentReference(reference: ContentReference): Uint8Array {
  valid(reference);
  const result = new Uint8Array(44);
  result.set(MAGIC); new DataView(result.buffer).setUint32(8, reference.size); result.set(reference.digest, 12);
  return result;
}
export function parseContentReference(bytes: Uint8Array): ContentReference | undefined {
  if (!bytesEqual(bytes.subarray(0, 8), MAGIC)) return undefined;
  if (bytes.length !== 44) throw Error("Invalid hosted content reference.");
  return valid({ digest: bytes.slice(12), size: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8) });
}
export function contentReferenceUri(reference: ContentReference): string {
  valid(reference); return `${PREFIX}${reference.size}:${toHex(reference.digest)}`;
}
export function parseContentReferenceUri(value: string): ContentReference | undefined {
  if (!value.startsWith(PREFIX)) return undefined;
  const match = /^osp:content:v1:([1-9][0-9]{0,4}):([0-9a-f]{64})$/.exec(value);
  if (!match) throw Error("Invalid hosted content reference.");
  return valid({ size: Number(match[1]), digest: fromHex(match[2]!) });
}

/** Fetches only from the configured content origin; chain values cannot select
 * arbitrary network destinations. Successful verified bytes have a bounded cache. */
export function createContentLoader(options: { publicUrl: string; chainId: string; identityContract: string; fetch?: typeof fetch }): ContentLoader {
  const base = new URL(options.publicUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw Error("Content hosting requires an HTTPS origin.");
  const fetchFn = options.fetch ?? globalThis.fetch;
  const cache = new Map<string, Promise<Uint8Array>>();
  return async reference => {
    valid(reference);
    const key = `${toBase64url(reference.digest)}:${reference.size}`;
    let pending = cache.get(key);
    if (!pending) {
      // R2 scopes object keys with the UTF-8 chain ID string, not its decoded bytes.
      const url = `${base.href.replace(/\/+$/, "")}/osp/${toBase64url(utf8(options.chainId)).replace(/=+$/, "")}/${options.identityContract}/${toBase64url(reference.digest)}`;
      pending = (async () => {
        const signal = AbortSignal.timeout(15_000);
        const response = await fetchFn(url, { signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
        if (!response.ok) throw Error("Hosted content is temporarily unavailable.");
        const bytes = await readMediaResponse(response, reference.size, signal);
        if (bytes.length !== reference.size || !bytesEqual(sha256(bytes), reference.digest)) throw Error("Hosted content does not match its on-chain fingerprint.");
        return bytes;
      })();
      cache.set(key, pending);
      if (cache.size > 512) cache.delete(cache.keys().next().value!);
      pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
    }
    return new Uint8Array(await pending);
  };
}

/** Restores existing SDK/API shapes without changing any ledger/control fields.
 * Only the named body fields can be hydrated; fetched JSON cannot replace votes,
 * membership, author, access settings, hashes, prices, times or revision numbers. */
export async function hydrateContent<T>(input: T, load: ContentLoader, keepUnavailable = false): Promise<T> {
  async function visit(value: unknown, depth = 0): Promise<unknown> {
    if (depth > 20) throw Error("Content response is too deeply nested.");
    if (Array.isArray(value)) {
      const result = [];
      // Bounded concurrency, including very large public directory responses.
      for (let i = 0; i < value.length; i += 4) result.push(...await Promise.all(value.slice(i, i + 4).map(v => visit(v, depth + 1))));
      return result;
    }
    if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
    const record = { ...value } as Record<string, unknown>;
    for (const key of ["envelope", "body"]) {
      const raw = record[key];
      if (typeof raw !== "string" && !(raw instanceof Uint8Array)) continue;
      if (typeof raw === "string" && !raw.startsWith("T1NQUkVG")) continue;
      try {
        const ref = parseContentReference(typeof raw === "string" ? fromBase64url(raw) : raw);
        if (!ref) continue;
        const bytes = await load(ref); record[key] = typeof raw === "string" ? toBase64url(bytes) : bytes;
      }
      catch (error) { if (!keepUnavailable) throw error; }
    }
    for (const key of ["profile_uri", "profileUri"]) {
      if (typeof record[key] !== "string") continue;
      try {
        const ref = parseContentReferenceUri(record[key] as string);
        if (!ref) continue;
        const fingerprint = record.profile_hash ?? record.profileHash;
        if (fingerprint && !bytesEqual(typeof fingerprint === "string" ? fromBase64url(fingerprint) : fingerprint as Uint8Array, ref.digest)) throw Error("Profile fingerprint mismatch.");
        record[key] = `data:application/x-osp-profile;base64,${toBase64url(await load(ref))}`;
      } catch (error) { if (!keepUnavailable) throw error; }
    }
    for (const key of ["title", "question"]) {
      if (typeof record[key] !== "string") continue;
      try {
        const ref = parseContentReferenceUri(record[key] as string);
        if (!ref) continue;
        const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await load(ref))) as Record<string, unknown>;
        if (key === "title") {
          if (typeof document.title !== "string" || typeof document.artist !== "string" || typeof document.description !== "string" || !document.title.trim() || utf8(document.title).length > 240 || utf8(document.artist).length > 240 || utf8(document.description).length > 2000) throw Error("Invalid music description.");
          record.title = document.title; record.artist = document.artist; record.description = document.description;
        } else {
          if (typeof document.question !== "string" || !document.question.trim() || document.question.length > 500 || !Array.isArray(document.options) || document.options.length < 2 || document.options.length > 8 || !document.options.every(v => typeof v === "string" && v.trim() && v.length <= 120) || new Set(document.options.map(v => (v as string).trim().toLowerCase())).size !== document.options.length || !Array.isArray(record.options) || record.options.length !== document.options.length || !record.options.every((v, i) => v === String(i))) throw Error("Invalid poll wording.");
          record.question = document.question; record.options = document.options;
        }
      } catch (error) { if (!keepUnavailable) throw error; }
    }
    for (const [key, child] of Object.entries(record)) {
      if (child && typeof child === "object" && !(child instanceof Uint8Array)) record[key] = await visit(child, depth + 1);
    }
    return record;
  }
  return await visit(input) as T;
}
