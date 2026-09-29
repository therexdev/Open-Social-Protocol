/** Portable image attachments. IPFS stores bytes; the encrypted post carries access keys. */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Signer, type SignerInterface } from "koilib";
import { base32nopad, base58 } from "@scure/base";
import { bytesEqual, canonicalJson, concat, fromBase64url, toBase64url, utf8 } from "./encoding.js";
import { randomBytes, type Rng } from "./crypto/keys.js";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const DEFAULT_IPFS_GATEWAYS = ["https://gateway.pinata.cloud", "https://ipfs.io", "https://dweb.link"];
const FILE_AAD = utf8("osp/media/file/v1");
const WRAP_AAD = utf8("osp/media/key/v1");

export function ipfsCid(location: string): string {
  const cid = location.replace(/^ipfs:\/\//, "");
  try {
    if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) {
      const bytes = base58.decode(cid);
      if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 32) return cid;
    }
    if (/^b[a-z2-7]{58}$/.test(cid)) {
      const bytes = base32nopad.decode(cid.slice(1).toUpperCase());
      // CIDv1, raw or dag-pb, sha2-256. These are the interoperable file formats in this version.
      if (bytes.length === 36 && bytes[0] === 1 && (bytes[1] === 0x55 || bytes[1] === 0x70) && bytes[2] === 0x12 && bytes[3] === 32) return cid;
    }
  } catch { /* reject invalid encodings */ }
  throw new Error("Invalid IPFS content address");
}

export function encryptMedia(bytes: Uint8Array, rng: Rng = randomBytes) {
  const key = rng(32), nonce = rng(24);
  const ciphertext = xchacha20poly1305(key, nonce, FILE_AAD).encrypt(bytes);
  return { ciphertext, key, nonce, contentHash: sha256(ciphertext) };
}

/** v1: version byte, 24-byte wrapping nonce, 48-byte authenticated wrapped key. */
export function wrapMediaKey(key: Uint8Array, contentKey: Uint8Array, hash: Uint8Array, rng: Rng = randomBytes): Uint8Array {
  if (key.length !== 32 || hash.length !== 32) throw new Error("Invalid media key or hash");
  const nonce = rng(24);
  return concat(new Uint8Array([1]), nonce, xchacha20poly1305(contentKey, nonce, concat(WRAP_AAD, hash)).encrypt(key));
}
export function unwrapMediaKey(wrapped: Uint8Array, contentKey: Uint8Array, hash: Uint8Array): Uint8Array {
  if (wrapped.length !== 73 || wrapped[0] !== 1 || hash.length !== 32) throw new Error("Unsupported encrypted image key");
  return xchacha20poly1305(contentKey, wrapped.slice(1,25), concat(WRAP_AAD, hash)).decrypt(wrapped.slice(25));
}
export function openMedia(bytes: Uint8Array, hash: Uint8Array, encryption?: { key: Uint8Array; nonce: Uint8Array }): Uint8Array {
  if (!bytesEqual(sha256(bytes), hash)) throw new Error("Image does not match its published fingerprint");
  return encryption ? xchacha20poly1305(encryption.key, encryption.nonce, FILE_AAD).decrypt(bytes) : bytes;
}

export interface MediaUploadStatement {
  chainId: string;
  contract: string;
  endpoint: string;
  account: string;
  signer: string;
  hash: string;
  size: number;
  mime: string;
  expires: number;
}
function proofHash(s: MediaUploadStatement): Uint8Array {
  // Pick fields explicitly: extension fields cannot alter the signature domain.
  const { chainId, contract, endpoint, account, signer, hash, size, mime, expires } = s;
  return sha256(utf8(canonicalJson({ domain: "osp/media-upload/v1", chainId, contract, endpoint, account, signer, hash, size, mime, expires })));
}
export async function signMediaUpload(statement: MediaUploadStatement, signer: SignerInterface): Promise<string> {
  return toBase64url(await signer.signHash(proofHash(statement)));
}
export function verifyMediaUpload(statement: MediaUploadStatement, signature: string): boolean {
  try { return Signer.recoverAddress(proofHash(statement), fromBase64url(signature)) === statement.signer; } catch { return false; }
}

/** A bounded streaming read: a malicious gateway cannot make the client buffer an unbounded file. */
export async function readMediaResponse(response: Response, maxBytes = MAX_IMAGE_BYTES, signal?: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) { await response.body?.cancel(); throw new Error("Image is too large"); }
  if (!response.body) throw new Error("Image response has no body");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Image loading cancelled");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error("Image loading cancelled");
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("Image is too large");
      chunks.push(value);
    }
  } finally { signal?.removeEventListener("abort", abort); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk,offset); offset += chunk.length; }
  return out;
}

/** Gateway URLs are local preferences; only the ipfs:// CID is part of the post.
 * Start a fallback after 750 ms instead of waiting for a slow gateway's timeout.
 * The whole operation has a hard deadline, including stalled response bodies.
 */
export async function fetchIpfsMedia(location: string, hash: Uint8Array, options: {
  gateways?: string[]; fetch?: typeof fetch; signal?: AbortSignal; maxBytes?: number;
} = {}): Promise<Uint8Array> {
  const cid = ipfsCid(location), fetchFn = options.fetch ?? fetch;
  if (options.signal?.aborted) throw new Error("Image loading cancelled");
  const urls: string[] = [];
  for (const base of options.gateways?.length ? options.gateways : DEFAULT_IPFS_GATEWAYS) {
    let url: URL;
    try { url = new URL(base); } catch { continue; }
    if (url.username || url.password || url.search || url.hash) continue;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) continue;
    const target = `${url.href.replace(/\/+$/, "").replace(/\/ipfs$/, "")}/ipfs/${cid}`;
    if (!urls.includes(target)) urls.push(target);
    if (urls.length === 3) break;
  }
  if (!urls.length) throw new Error("No usable IPFS gateway is configured. Check Settings.");
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    let settled = false, next = 0, failed = 0;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      settled = true; clearTimeout(deadline); clearTimeout(hedge);
      options.signal?.removeEventListener("abort", abort);
      for (const controller of controllers) controller.abort();
    };
    const abort = () => { if (!settled) { cleanup(); reject(new Error("Image loading cancelled")); } };
    const deadline = setTimeout(() => {
      if (!settled) { cleanup(); reject(new Error("Photo loading timed out. Retry the photo or choose another IPFS gateway in Settings.")); }
    }, 18_000);
    const launch = () => {
      if (settled || next >= urls.length) return;
      clearTimeout(hedge);
      const target = urls[next++]!, controller = new AbortController();
      controllers.push(controller);
      if (next < urls.length) hedge = setTimeout(launch, 750);
      void (async () => {
        const response = await fetchFn(target, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
        if (controller.signal.aborted || !response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error(`Gateway returned ${response.status}`);
        }
        const bytes = await readMediaResponse(response, options.maxBytes, controller.signal);
        if (!bytesEqual(sha256(bytes), hash)) throw new Error("Image does not match its published fingerprint");
        return bytes;
      })().then(bytes => {
        if (!settled) { cleanup(); resolve(bytes); }
      }, () => {
        if (settled) return;
        failed++;
        if (failed === urls.length) { cleanup(); reject(new Error("Photo unavailable from your IPFS gateways. Retry the photo or choose another gateway in Settings.")); }
        else launch();
      });
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort(); else launch();
  });
}
