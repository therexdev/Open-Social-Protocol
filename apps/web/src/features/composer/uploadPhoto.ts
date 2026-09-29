import { MAX_IMAGE_BYTES, contentHash, encryptMedia, ipfsCid, signMediaUpload, toBase64url, utf8, type Identity, type MediaUploadStatement } from "@osp/sdk";
import type { MediaAttachment } from "./publish";
import { rememberMediaBytes } from "../../api/mediaCache";

export { preparePhoto } from "./preparePhoto";

export async function uploadPhoto(bytes: Uint8Array, options: {
  endpoint: string; chainId: string; contract: string; identity: Identity; private: boolean;
  signal?: AbortSignal; fetch?: typeof fetch; now?: number;
}): Promise<MediaAttachment> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES - 16) throw new Error("Photo is too large");
  if (!options.endpoint) throw new Error("Choose a photo upload service in Settings → Network & endpoints.");
  const url = new URL(options.endpoint);
  if (url.username || url.password || url.hash || url.search || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Use an HTTPS photo upload service.");
  const encrypted = options.private ? encryptMedia(bytes) : undefined;
  const uploaded = encrypted?.ciphertext ?? bytes, hash = contentHash(uploaded);
  const proof: MediaUploadStatement = { chainId: options.chainId, contract: options.contract, endpoint: options.endpoint,
    account: options.identity.account, signer: options.identity.signer.getAddress(), hash: toBase64url(hash), size: uploaded.length,
    // Two minutes for submission, with headroom inside the service's five-minute clock bound.
    mime: encrypted ? "application/octet-stream" : "image/jpeg", expires: (options.now ?? Date.now()) + 120_000 };
  const signature = await signMediaUpload(proof, options.identity.signer);
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, 60_000);
  options.signal?.addEventListener("abort",abort,{ once: true });
  try {
    if (options.signal?.aborted) throw new Error("Photo upload cancelled");
    const response = await (options.fetch ?? fetch)(options.endpoint, { method: "POST", body: new Uint8Array(uploaded), credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { "content-type": "application/octet-stream", "x-osp-media-proof": toBase64url(utf8(JSON.stringify({ ...proof, signature }))) } });
    if (response.status === 404) throw new Error("Photo uploads are not enabled on this service yet. Update the server or choose another upload service in Settings.");
    const result = await response.json() as { url?: string; hash?: string; size?: number; error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message || "Photo upload failed. Your post has not been published.");
    if (!result.url?.startsWith("ipfs://") || result.hash !== proof.hash || result.size !== uploaded.length) throw new Error("The storage service returned an invalid photo receipt");
    ipfsCid(result.url);
    rememberMediaBytes(result.url, proof.hash, uploaded);
    return { url: result.url, mime: "image/jpeg", size: uploaded.length, contentHash: hash,
      ...(encrypted && { encryption: { key: toBase64url(encrypted.key), nonce: toBase64url(encrypted.nonce) } }) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? "Photo upload cancelled" : "Photo upload timed out. Your post has not been published. Try again.");
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort",abort); encrypted?.key.fill(0); }
}
