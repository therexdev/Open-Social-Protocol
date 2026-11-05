import {
  bytesEqual, CLIP_KIND, contentHash, MUSIC_CHUNK_BYTES, MUSIC_MAX_BYTES, encryptMedia, fromBase64url, musicBatchChunks, musicConfig,
  newEpochKey, openMedia, parseClipLocation, toBase64url, validateClip, VIDEO_UPLOAD_FEE,
  type ClipKind, type ProtocolClient,
} from "@osp/sdk";
import { toArrayBuffer } from "../../util/bytes";
import type { SubmitContext } from "../../tx/submit";
import type { MediaAttachment } from "../composer/publish";
import { loadMusic, uploadMusic, type MusicDraft } from "../music/musicService";

export interface ClipSource { bytes: Uint8Array; mime: string; durationMs: number }
export type ClipReference = Pick<MediaAttachment, "url" | "contentHash" | "mime" | "encryption"> & Partial<Pick<MediaAttachment, "size" | "durationMs">>;

/** Preparation is local. Private bytes use a fresh key; only the enclosing encrypted
 * post, comment, or DM carries that key. Never put it in the public archive manifest. */
export function prepareClip(source: ClipSource, kind: ClipKind, client: ProtocolClient, isPrivate: boolean): MediaAttachment {
  const mime = source.mime.split(";")[0]!.trim().toLowerCase();
  if (!source.bytes.length) throw new Error("The recording is empty.");
  validateClip(kind, mime, source.bytes.length + (isPrivate ? 16 : 0), source.durationMs);
  const sealed = isPrivate ? encryptMedia(source.bytes) : undefined;
  const stored = sealed?.ciphertext ?? source.bytes;
  try {
    return {
      url: `osp-clip://${client.deployment.contracts.publications.address}/${toBase64url(newEpochKey())}`,
      mime, size: stored.length, contentHash: contentHash(stored), durationMs: source.durationMs,
      archiveBytes: toBase64url(stored),
      ...(sealed && { encryption: { key: toBase64url(sealed.key), nonce: toBase64url(sealed.nonce) } }),
    };
  } finally { sealed?.key.fill(0); }
}

/** Try a lossless transport encoding only when it eliminates a full chain chunk.
 * Browsers without gzip streams can still upload the original video. */
export async function prepareVideoClip(source: ClipSource, client: ProtocolClient, isPrivate: boolean): Promise<MediaAttachment> {
  const mime = source.mime.split(";")[0]!.trim().toLowerCase();
  validateClip("video", mime, source.bytes.length, source.durationMs);
  if (source.bytes.length >= MUSIC_CHUNK_BYTES && typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined") {
    let compressed: Uint8Array | undefined;
    try {
      const stream = new Response(toArrayBuffer(source.bytes)).body!.pipeThrough(new CompressionStream("gzip"));
      compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* The original encoded file is a valid transport on older browsers. */ }
    if (compressed && compressed.length + (isPrivate ? 16 : 0) + MUSIC_CHUNK_BYTES <= source.bytes.length) {
      return { ...prepareClip({ ...source, bytes: compressed }, "video", client, isPrivate), gzipOriginalSize: source.bytes.length };
    }
  }
  return prepareClip(source, "video", client, isPrivate);
}

async function restoreVideo(bytes: Uint8Array, expected: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isInteger(expected) || expected > MUSIC_MAX_BYTES || expected < bytes.length + MUSIC_CHUNK_BYTES)
    throw new Error("Invalid compressed video size.");
  if (typeof DecompressionStream === "undefined") throw new Error("This video requires a browser with gzip playback support.");
  const reader = new Response(toArrayBuffer(bytes)).body!.pipeThrough(new DecompressionStream("gzip")).getReader();
  const output = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Video loading cancelled.");
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > expected - offset) throw new Error("Video exceeds its published size.");
      output.set(value, offset); offset += value.length;
    }
    if (offset !== expected) throw new Error("Video does not match its published size.");
    return output;
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** The caller persists the attachment before this call. Resuming uses the same
 * manifest and ciphertext, so an interrupted reservation cannot charge twice. */
export async function archiveClip(
  media: MediaAttachment, ctx: SubmitContext, owner: string, assertActive: () => void = () => {},
  progress: (received: number, total: number) => void = () => {},
): Promise<void> {
  const client = ctx.client, id = parseClipLocation(media.url, client.deployment.contracts.publications.address);
  if (!media.archiveBytes || !media.durationMs) throw new Error("The saved recording is incomplete.");
  const bytes = fromBase64url(media.archiveBytes), kind = media.mime.startsWith("video/") ? "video" : "voice";
  validateClip(kind, media.mime, bytes.length, media.durationMs);
  if (bytes.length !== media.size || !bytesEqual(contentHash(bytes), media.contentHash))
    throw new Error("The recording does not match the saved file.");
  const config = await musicConfig(client);
  if (config.clip_version !== 1) throw new Error("This network needs the Publications clip upgrade before uploading.");
  const draft: MusicDraft = {
    clipKind: CLIP_KIND[kind], gzipOriginalSize: media.gzipOriginalSize, clipEncrypted: !!media.encryption, id: toBase64url(id), owner, payer: ctx.signer.getAddress(),
    digest: toBase64url(media.contentHash), size: media.size, title: kind === "video" ? "Video" : "Voice recording",
    mime: media.mime, durationMs: media.durationMs, configRevision: config.revision,
    fee: kind === "video" ? VIDEO_UPLOAD_FEE : "0", recipient: config.recipient, batchSize: musicBatchChunks(config.version),
  };
  await uploadMusic(ctx, draft, bytes, assertActive, progress);
}

export async function loadClip(media: ClipReference, client: ProtocolClient, signal?: AbortSignal): Promise<Uint8Array> {
  const id = parseClipLocation(media.url, client.deployment.contracts.publications.address);
  const kind = media.mime.startsWith("video/") ? "video" : "voice";
  const { record, bytes } = await loadMusic(client, toBase64url(id), signal, undefined, manifest => {
    validateClip(kind, media.mime, manifest.size, manifest.duration_ms);
    if (manifest.clip_kind !== CLIP_KIND[kind] || manifest.mime !== media.mime ||
        !bytesEqual(manifest.digest, media.contentHash) || !!manifest.encrypted !== !!media.encryption ||
        (media.size !== undefined && media.size !== manifest.size) ||
        (media.durationMs !== undefined && media.durationMs !== manifest.duration_ms))
      throw new Error("Clip verification failed.");
  });
  let opened = bytes;
  if (media.encryption) {
    const key = fromBase64url(media.encryption.key);
    try { opened = openMedia(bytes, media.contentHash, { key, nonce: fromBase64url(media.encryption.nonce) }); }
    finally { key.fill(0); }
  }
  return record.gzip_original_size ? restoreVideo(opened, record.gzip_original_size, signal) : opened;
}
