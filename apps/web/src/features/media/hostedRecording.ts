import { prepareHostedBlob, hostedFileLocation, toBase64url, validateHostedFile } from "@osp/sdk";
import type { SubmitContext } from "../../tx/submit";
import { uploadStoredBlob } from "../../api/mediaStorage";
import type { MediaAttachment } from "../composer/publish";
import type { CapturedMedia } from "./MediaCapture";

export async function uploadHostedRecording(recording: CapturedMedia, ctx: SubmitContext, owner: string, encrypted: boolean,
  assertActive: () => void = () => {}, progress?: (received: number, total: number) => void, signal?: AbortSignal): Promise<MediaAttachment> {
  const check = () => { if (signal?.aborted) throw Error("Upload cancelled."); assertActive(); };
  validateHostedFile(recording.mime, recording.file.size, recording.durationMs);
  const stored = await prepareHostedBlob(recording.file, encrypted, check);
  try {
    const location = await uploadStoredBlob(ctx, owner, stored.blob, stored.digest, check, progress, signal);
    return { url: hostedFileLocation(location, stored.digest), mime: recording.mime, size: stored.blob.size, durationMs: recording.durationMs, contentHash: stored.digest,
      ...(stored.encryption && { encryption: { key: toBase64url(stored.encryption.key), nonce: toBase64url(stored.encryption.nonce) } }) };
  } finally { stored.encryption?.key.fill(0); }
}
