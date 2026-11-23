/** R2 is transport only. Existing encrypted drafts, audience keys and chain commitments remain authoritative. */
import { bytesEqual, contentHash, createContentLoader, openMedia, readMediaResponse, signMediaUpload, toBase64url, utf8,
  type MediaUploadStatement, type ProtocolClient } from "@osp/sdk";
import type { SubmitContext } from "../tx/submit";

const storage = new WeakMap<ProtocolClient, { endpoint: string; fetch: typeof fetch }>();
export function configureMediaStorage(client: ProtocolClient, endpoint: string, fetchFn: typeof fetch = fetch) {
  storage.set(client, { endpoint, fetch: fetchFn });
  let load: ReturnType<typeof createContentLoader> | undefined;
  client.contracts.contentLoader = async reference => {
    if (!load) {
      https(endpoint);
      const response = await fetchFn(endpoint, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw Error("Content hosting is temporarily unavailable.");
      const discovery = await response.json() as { enabled: boolean; provider: string; chainId: string; contract: string; publicUrl: string };
      if (!discovery.enabled || discovery.provider !== "r2" || discovery.chainId !== client.chainId || discovery.contract !== client.deployment.contracts.identity.address) throw Error("Content hosting is not enabled for this network.");
      load = createContentLoader({ publicUrl: discovery.publicUrl, chainId: client.chainId, identityContract: discovery.contract, fetch: fetchFn });
    }
    return load(reference);
  };
}
export const usesExternalMedia = (client: ProtocolClient) => storage.has(client);
function https(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || value.length > 512) throw Error("Use an HTTPS media service without credentials, query or fragment.");
  return url;
}
export async function uploadStoredMedia(ctx: SubmitContext, owner: string, bytes: Uint8Array, assertActive: () => void = () => {}): Promise<string> {
  const settings = storage.get(ctx.client);
  if (!settings?.endpoint) throw Error("Configure the R2 media upload service before uploading.");
  https(settings.endpoint);
  const options = { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" } as const;
  const response = await settings.fetch(settings.endpoint, { ...options, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error("The media service is unavailable. No file bytes were sent to the blockchain.");
  const discovery = await response.json() as { enabled: boolean; provider: string; chainId: string; contract: string; maxFileBytes: number; publicUrl: string };
  const contract = ctx.client.deployment.contracts.identity.address;
  if (!discovery.enabled || discovery.provider !== "r2" || discovery.chainId !== ctx.client.chainId || discovery.contract !== contract)
    throw Error("Cloudflare R2 is not enabled for this testnet deployment. Configure the media service first.");
  https(discovery.publicUrl);
  if (!Number.isSafeInteger(discovery.maxFileBytes) || discovery.maxFileBytes < 1 || discovery.maxFileBytes > 10 * 1024 * 1024) throw Error("Invalid media service size limit.");
  if (!bytes.length || bytes.length > discovery.maxFileBytes) throw Error("This file exceeds the media service size limit.");
  assertActive();
  const proof: MediaUploadStatement = { chainId: ctx.client.chainId, contract, endpoint: settings.endpoint,
    account: owner, signer: ctx.signer.getAddress(), hash: toBase64url(contentHash(bytes)), size: bytes.length,
    mime: "application/octet-stream", expires: Date.now() + 120_000 };
  const signature = await signMediaUpload(proof, ctx.signer);
  assertActive();
  const uploaded = await settings.fetch(settings.endpoint, { ...options, method: "POST", signal: AbortSignal.timeout(90_000),
    body: new Uint8Array(bytes), headers: { "content-type": "application/octet-stream", "x-osp-media-proof": toBase64url(utf8(JSON.stringify({ ...proof, signature }))) } });
  const receipt = await uploaded.json() as { url: string; hash: string; size: number; error?: { message?: string } };
  if (!uploaded.ok) throw Error(receipt.error?.message ?? "Media upload failed. Retry the saved upload.");
  const location = https(receipt.url), base = https(discovery.publicUrl);
  if (location.origin !== base.origin || !location.href.startsWith(`${base.href.replace(/\/+$/, "")}/osp/`) ||
      !location.pathname.endsWith(`/${proof.hash}`) || receipt.hash !== proof.hash || receipt.size !== bytes.length)
    throw Error("The storage receipt does not match the saved file.");
  assertActive();
  // Check public delivery/CORS and the full ciphertext before committing a reference.
  await fetchStoredMedia(receipt.url, contentHash(bytes), bytes.length, undefined, settings.fetch);
  assertActive();
  return receipt.url;
}
export async function fetchStoredMedia(location: string, digest: Uint8Array, size: number, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  https(location);
  if (!Number.isSafeInteger(size) || size < 1 || size > 10 * 1024 * 1024) throw Error("Invalid media size.");
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, 60_000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw Error("Media loading cancelled.");
    const response = await fetchFn(location, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal });
    if (!response.ok) throw Error("The stored media is temporarily unavailable.");
    const bytes = await readMediaResponse(response, size, controller.signal);
    if (bytes.length !== size || !bytesEqual(contentHash(bytes), digest)) throw Error("Stored media does not match its on-chain fingerprint.");
    return openMedia(bytes, digest);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
