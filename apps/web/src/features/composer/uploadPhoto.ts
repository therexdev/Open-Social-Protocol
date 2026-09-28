import { MAX_IMAGE_BYTES, contentHash, encryptMedia, ipfsCid, signMediaUpload, toBase64url, utf8, type Identity, type MediaUploadStatement } from "@osp/sdk";
import type { MediaAttachment } from "./publish";

/** Re-encode locally: strips EXIF/GPS, bounds dimensions and avoids serving active image formats. */
export async function preparePhoto(file: File): Promise<Uint8Array> {
  if (!/^image\/(jpeg|png|webp|avif|heic|heif)$/.test(file.type)) throw new Error("Choose a JPEG, PNG, WebP, AVIF, or HEIC photo. Animated files and SVG are not supported.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a photo smaller than 20 MB.");
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error("This browser cannot open that photo. Save it as JPEG or PNG and try again."); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error("This photo's dimensions are too large. Resize it first.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable in this browser.");
    for (const [longest,quality] of [[2048,0.86],[2048,0.72],[1536,0.82],[1536,0.65],[1024,0.72]] as const) {
      const scale = Math.min(1, longest / Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#ffffff"; context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,"image/jpeg",quality));
      // Keep the pilot fast and compatible with common reverse proxies' 1 MiB default.
      if (blob && blob.size <= 900_000) return new Uint8Array(await blob.arrayBuffer());
    }
    throw new Error("This photo is still too large after resizing. Choose a smaller image.");
  } finally { URL.revokeObjectURL(url); }
}

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
    return { url: result.url, mime: "image/jpeg", size: uploaded.length, contentHash: hash,
      ...(encrypted && { encryption: { key: toBase64url(encrypted.key), nonce: toBase64url(encrypted.nonce) } }) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? "Photo upload cancelled" : "Photo upload timed out. Your post has not been published. Try again.");
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort",abort); encrypted?.key.fill(0); }
}
