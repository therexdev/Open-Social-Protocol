import { fromBase64url, toBase64url } from "./encoding.js";
import { MUSIC_MAX_BYTES, MUSIC_MIMES } from "./music.js";

export const CLIP_KIND = { voice: 1, video: 2 } as const;
export type ClipKind = keyof typeof CLIP_KIND;
export const VIDEO_UPLOAD_FEE = "10000000000";
export const VOICE_MAX_BYTES = 1024 * 1024;
export const VOICE_MAX_DURATION = 120000;
export const VIDEO_MIMES = ["video/webm", "video/mp4"] as const;

export function voiceStorageUnits(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > VOICE_MAX_BYTES)
    throw new Error("Voice recordings must fit 1 MiB including encryption.");
  return Math.ceil(bytes / 32768);
}
export function validateClip(kind: ClipKind, mime: string, size: number, durationMs: number): void {
  if (!Number.isInteger(durationMs)) throw new Error("The recording duration is unavailable.");
  if (kind === "video") {
    if (!(VIDEO_MIMES as readonly string[]).includes(mime)) throw new Error("Choose an MP4 or WebM video.");
    if (!Number.isSafeInteger(size) || size < 1 || size > MUSIC_MAX_BYTES) throw new Error("Videos must fit 10 MiB including encryption.");
    if (durationMs < 10000 || durationMs > 30000) throw new Error("Choose a video between 10 and 30 seconds.");
  } else {
    if (!(MUSIC_MIMES as readonly string[]).includes(mime)) throw new Error("Unsupported voice recording format.");
    voiceStorageUnits(size);
    if (durationMs < 1 || durationMs > VOICE_MAX_DURATION) throw new Error("Voice recordings can be up to two minutes.");
  }
}
export function parseClipLocation(location: string, contract: string): Uint8Array {
  const prefix = `osp-clip://${contract}/`;
  if (!location.startsWith(prefix)) throw new Error("This clip belongs to another archive.");
  const encoded = location.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(encoded)) throw new Error("Invalid clip reference.");
  const id = fromBase64url(encoded);
  if (id.length !== 32 || toBase64url(id) !== encoded) throw new Error("Invalid clip reference.");
  return id;
}
