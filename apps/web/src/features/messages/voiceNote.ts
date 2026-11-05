import { fromBase64url, toBase64url, validPrivateVoiceNote, type PrivateVoiceNote } from "@osp/sdk";
import type { MediaAttachment } from "../composer/publish";

/** Whitelist the properties shared with the recipient. Upload bytes stay in the local queue. */
export function describeVoiceNote(media: MediaAttachment, durationMs: number): PrivateVoiceNote {
  if (!media.encryption) throw new Error("Private recordings must be encrypted before upload.");
  const note = {
    url: media.url, mime: media.mime, size: media.size, durationMs,
    digest: toBase64url(media.contentHash), key: media.encryption.key, nonce: media.encryption.nonce,
  };
  if (!validPrivateVoiceNote(note)) throw new Error("This voice recording cannot be sent.");
  return note;
}

export function voiceAttachment(note: PrivateVoiceNote, archiveBytes?: string) {
  return {
    url: note.url, mime: note.mime, size: note.size, durationMs: note.durationMs,
    contentHash: fromBase64url(note.digest), encryption: { key: note.key, nonce: note.nonce },
    ...(archiveBytes && { archiveBytes }),
  };
}
