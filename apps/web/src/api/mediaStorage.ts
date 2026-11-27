/** R2 is transport only. Existing encrypted drafts, audience keys and chain commitments remain authoritative. */
import { bytesEqual, contentHash, createContentLoader, HOSTED_FILE_MAX_BYTES, MEDIA_UPLOAD_PART_BYTES, HOSTED_MEDIA_MAX_BYTES, openMedia, readMediaResponse, signMediaUpload, toBase64url, utf8,
  type MediaUploadStatement, type ProtocolClient } from "@osp/sdk";
import type { SubmitContext } from "../tx/submit";

const storage = new WeakMap<ProtocolClient, { endpoint: string; fetch: typeof fetch }>();
export function configureMediaStorage(client: ProtocolClient, endpoint: string, fetchFn: typeof fetch = fetch) {
  // Native browser fetch must keep its Window/Worker receiver when stored on settings.
  const request = fetchFn.bind(globalThis);
  storage.set(client, { endpoint, fetch: request });
  let load: ReturnType<typeof createContentLoader> | undefined;
  client.contracts.contentLoader = async reference => {
    if (!load) {
      https(endpoint);
      const response = await request(endpoint, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw Error("Content hosting is temporarily unavailable.");
      const discovery = await response.json() as { enabled: boolean; provider: string; chainId: string; contract: string; publicUrl: string };
      if (!discovery.enabled || discovery.provider !== "r2" || discovery.chainId !== client.chainId || discovery.contract !== client.deployment.contracts.identity.address) throw Error("Content hosting is not enabled for this network.");
      load = createContentLoader({ publicUrl: discovery.publicUrl, chainId: client.chainId, identityContract: discovery.contract, fetch: request });
    }
    return load(reference);
  };
}
export const usesExternalMedia = (client: ProtocolClient) => storage.has(client);

/** Upload long recordings as small resumable requests. The server verifies the
 * complete fingerprint and finishes R2 multipart storage before giving a receipt. */
export async function uploadStoredBlob(ctx: SubmitContext, owner: string, blob: Blob, digest: Uint8Array,
  assertActive: () => void = () => {}, progress: (received: number, total: number) => void = () => {}, signal?: AbortSignal): Promise<string> {
  const settings = storage.get(ctx.client);
  if (!settings?.endpoint) throw Error("Configure content hosting before uploading.");
  const options = { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" } as const;
  const timeout = (ms: number) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  const response = await settings.fetch(settings.endpoint, { ...options, signal: timeout(15_000) });
  if (!response.ok) throw Error("The hosting service is temporarily unavailable.");
  const service = await response.json() as { enabled: boolean; provider: string; chainId: string; contract: string; publicUrl: string; maxFileBytes: number;
    multipart?: { version: number; partBytes: number; maxFileBytes: number } };
  if (!service.enabled || service.provider !== "r2" || service.chainId !== ctx.client.chainId || service.contract !== ctx.client.deployment.contracts.identity.address)
    throw Error("Content hosting is not enabled for this network.");
  const origin = https(service.publicUrl), hash = toBase64url(digest);
  if (digest.length !== 32 || !blob.size || blob.size > HOSTED_FILE_MAX_BYTES) throw Error("Choose a recording up to 2 GiB.");
  const check = () => { if (signal?.aborted) throw Error("Upload cancelled."); assertActive(); };
  check();
  if (!service.multipart) {
    if (blob.size > service.maxFileBytes) throw Error("The hosting service needs the large-upload update before it can accept this recording. Your file has not been published.");
    return uploadStoredMedia(ctx, owner, new Uint8Array(await blob.arrayBuffer()), check);
  }
  const limits = service.multipart;
  if (limits.version !== 1 || limits.partBytes !== MEDIA_UPLOAD_PART_BYTES || !Number.isSafeInteger(limits.maxFileBytes) || limits.maxFileBytes < 1 || limits.maxFileBytes > HOSTED_FILE_MAX_BYTES)
    throw Error("Invalid hosting upload settings.");
  if (blob.size > limits.maxFileBytes) throw Error(`This hosting service accepts recordings up to ${(limits.maxFileBytes / 1073741824).toFixed(1)} GiB.`);
  const proof = async () => {
    check();
    const statement: MediaUploadStatement = { chainId: ctx.client.chainId, contract: service.contract, endpoint: settings.endpoint,
      account: owner, signer: ctx.signer.getAddress(), hash, size: blob.size, mime: "application/octet-stream", expires: Date.now() + 120_000 };
    const signature = await signMediaUpload(statement, ctx.signer); check();
    return toBase64url(utf8(JSON.stringify({ ...statement, signature })));
  };
  type Receipt = { url: string; hash: string; size: number };
  type State = { id?: string; token?: string; received?: number; partBytes?: number; receipt?: Receipt; processing?: boolean; error?: string | { message?: string } };
  const request = async (url: string, init: RequestInit): Promise<State> => {
    check();
    const result = await settings.fetch(url, { ...options, ...init, signal: timeout(180_000), cache: "no-store" });
    const body = await result.json() as State;
    check();
    if (!result.ok) throw Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Hosting is busy. Select the same recording to resume the upload.");
    return body;
  };
  const retryRequest = async (url: string, init: RequestInit) => {
    // Repeating a part at the same offset and completing the same session are
    // idempotent. Never apply this transport retry to a chain transaction.
    for (let attempt = 0; ; attempt++) {
      try { return await request(url, init); }
      catch (error) {
        check();
        if (attempt >= 2 || !(error instanceof Error) || !/failed to fetch|network|timeout|busy|unavailable|retry|try again/i.test(error.message)) throw error;
        await new Promise<void>(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  };
  const validateReceipt = async (receipt: Receipt) => {
    const location = https(receipt.url);
    if (location.origin !== origin.origin || !receipt.url.startsWith(`${service.publicUrl.replace(/\/+$/, "")}/osp/`) ||
      !location.pathname.endsWith(`/${hash}`) || receipt.hash !== hash || receipt.size !== blob.size) throw Error("The storage receipt does not match your file.");
    // Check delivery/CORS without downloading the whole podcast again.
    const delivered = await settings.fetch(receipt.url, { ...options, method: "HEAD", signal: timeout(20_000) });
    if (!delivered.ok || Number(delivered.headers.get("content-length")) !== blob.size) throw Error("The recording is stored but public delivery is not ready. Select the same file to retry.");
    check(); progress(blob.size, blob.size); return receipt.url;
  };
  const state = await request(`${settings.endpoint}/uploads`, { method: "POST", headers: { "x-osp-media-proof": await proof() } });
  if (state.receipt) return validateReceipt(state.receipt);
  if (!state.id || !/^[a-f0-9]{32}$/.test(state.id) || !state.token || !/^[a-f0-9]{64}$/.test(state.token) || state.partBytes !== MEDIA_UPLOAD_PART_BYTES ||
    !Number.isSafeInteger(state.received) || state.received! < 0 || state.received! > blob.size) throw Error("Invalid upload session.");
  const endpoint = `${settings.endpoint}/uploads/${state.id}`, headers = { "x-osp-upload-token": state.token };
  let received = state.received!; progress(received, blob.size);
  while (received < blob.size) {
    const end = Math.min(blob.size, received + MEDIA_UPLOAD_PART_BYTES);
    const result = await retryRequest(`${endpoint}/part?offset=${received}`, { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: blob.slice(received, end) });
    if (result.received !== end) throw Error("The hosting service returned an invalid upload offset.");
    received = end; progress(received, blob.size);
  }
  let result = await retryRequest(`${endpoint}/complete`, { method: "POST", headers: { ...headers, "x-osp-media-proof": await proof() } });
  const deadline = Date.now() + 60 * 60_000;
  while (!result.receipt) {
    if (typeof result.error === "string") throw Error(result.error);
    if (Date.now() > deadline) throw Error("Storage is still finishing this recording. Select the same file to resume.");
    await new Promise<void>(resolve => setTimeout(resolve, 2000)); check();
    result = await retryRequest(endpoint, { method: "GET", headers });
    if (!result.receipt && !result.processing && !result.error)
      result = await request(`${endpoint}/complete`, { method: "POST", headers: { ...headers, "x-osp-media-proof": await proof() } });
  }
  return validateReceipt(result.receipt);
}
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
    throw Error("Cloudflare R2 is not enabled for this deployment. Configure the media service first.");
  https(discovery.publicUrl);
  if (!Number.isSafeInteger(discovery.maxFileBytes) || discovery.maxFileBytes < 1 || discovery.maxFileBytes > HOSTED_MEDIA_MAX_BYTES) throw Error("Invalid media service size limit.");
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
  if (!Number.isSafeInteger(size) || size < 1 || size > HOSTED_MEDIA_MAX_BYTES) throw Error("Invalid media size.");
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
