import { fromBase64url, MUSIC_MIMES, toBase64url, utf8, utf8Decode, type ProtocolClient } from "@osp/sdk";
import type { MediaAttachment } from "../composer/publish";
import type { Session } from "../../vault/store";
import { EncryptedStore, deriveAesKey } from "../../vault/encryptedStore";
import { defaultStorage } from "../../vault/storage";

// Legacy comments are raw UTF-8. 0xff cannot be its first byte. Version the binary
// extension so even a text comment containing a literal JSON attachment stays text.
const HEADER = [255, 79, 83, 80, 1];
const MAX_BYTES = 3984;
export type StoredVoice = Omit<MediaAttachment, "contentHash"> & { contentHash: string };
export interface VoiceCommentDraft {
  voice: StoredVoice;
  id: string;
  body: string;
  nonce?: string;
  replyTo?: string;
}
export const restoreVoice = (value: StoredVoice): MediaAttachment => ({ ...value, contentHash: fromBase64url(value.contentHash) });

export function encodeVoiceComment(caption: string, voice: MediaAttachment): Uint8Array {
  const payload = utf8(JSON.stringify({
    text: caption, url: voice.url, mime: voice.mime, size: voice.size,
    digest: toBase64url(voice.contentHash),
    ...(voice.encryption && { key: voice.encryption.key, nonce: voice.encryption.nonce }),
  }));
  if (payload.length + HEADER.length > MAX_BYTES) throw Error("Shorten the caption to attach this recording.");
  const out = new Uint8Array(HEADER.length + payload.length);
  out.set(HEADER); out.set(payload, HEADER.length);
  return out;
}
function canonicalBytes(value: unknown, length: number) {
  if (typeof value !== "string") return false;
  const decoded = fromBase64url(value);
  return decoded.length === length && toBase64url(decoded) === value;
}
export function decodeMusicComment(plain: Uint8Array, restricted: boolean): { text: string; voice?: MediaAttachment } {
  if (plain[0] !== 255) return { text: utf8Decode(plain) };
  if (!HEADER.every((byte, i) => plain[i] === byte) || plain.length > MAX_BYTES) throw Error("Unsupported comment format");
  const v = JSON.parse(utf8Decode(plain.subarray(HEADER.length)));
  if (!v || typeof v.text !== "string" || typeof v.url !== "string" ||
      !/^osp-clip:\/\/[1-9A-HJ-NP-Za-km-z]{25,35}\/[A-Za-z0-9_-]{43}=$/.test(v.url) ||
      !MUSIC_MIMES.includes(v.mime) || !Number.isSafeInteger(v.size) || v.size < 1 || v.size > 1048576 ||
      !canonicalBytes(v.digest, 32)) throw Error("Invalid voice comment");
  if (restricted ? !(canonicalBytes(v.key,32) && canonicalBytes(v.nonce,24)) : (v.key !== undefined || v.nonce !== undefined))
    throw Error("Voice comment audience mismatch");
  return { text: v.text, voice: { url: v.url, mime: v.mime, size: v.size, contentHash: fromBase64url(v.digest),
    ...(restricted && { encryption: { key: v.key, nonce: v.nonce } }) } };
}
export async function voiceCommentStore(session: Session, client: ProtocolClient, track: string) {
  const scope = `osp.voice-comment:${client.chainId}:${client.deployment.contracts.publications.address}:${track}:${session.identity.account}`;
  return new EncryptedStore<VoiceCommentDraft>(defaultStorage(), scope, await deriveAesKey(session.identity.seed, scope));
}
