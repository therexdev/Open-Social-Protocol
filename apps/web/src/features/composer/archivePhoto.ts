import {
  bytesEqual,
  contentHash,
  encryptMedia,
  fromBase64url,
  newEpochKey,
  parsePhotoLocation,
  photoChunks,
  photoCost,
  photoLocation,
  requirePhotoLibrary,
  toBase64url,
  type ProtocolClient,
} from "@osp/sdk";
import { submitAction, type SubmitContext } from "../../tx/submit";
import { rememberMediaBytes } from "../../api/mediaCache";
import type { MediaAttachment } from "./publish";

/** Local preparation only. No transaction or usage charge before confirmation. */
export function prepareArchivedPhoto(
  bytes: Uint8Array,
  client: ProtocolClient,
  isPrivate: boolean
): MediaAttachment {
  const encrypted = isPrivate ? encryptMedia(bytes) : undefined;
  const stored = encrypted?.ciphertext ?? bytes;
  photoCost(stored.length);
  const hash = contentHash(stored),
    url = photoLocation(
      client.deployment.contracts.publications.address,
      newEpochKey()
    );
  rememberMediaBytes(url, toBase64url(hash), stored);
  const result: MediaAttachment = {
    url,
    mime: "image/jpeg",
    size: stored.length,
    contentHash: hash,
    archiveBytes: toBase64url(stored),
    ...(encrypted && {
      encryption: {
        key: toBase64url(encrypted.key),
        nonce: toBase64url(encrypted.nonce),
      },
    }),
  };
  encrypted?.key.fill(0);
  return result;
}

/** The containing encrypted draft MUST be saved first. All calls are idempotent;
 * a timeout/reload resumes this exact ciphertext/id, with at most one charge. */
export async function archivePhoto(
  media: MediaAttachment,
  ctx: SubmitContext,
  owner: string,
  assertActive?: () => void,
  progress: (uploadedBytes: number) => void = () => {}
): Promise<void> {
  if (!media.archiveBytes) return;
  const client = ctx.client;
  await requirePhotoLibrary(client);
  const id = parsePhotoLocation(
      media.url,
      client.deployment.contracts.publications.address
    ),
    data = fromBase64url(media.archiveBytes),
    chunks = photoChunks(data),
    digest = contentHash(data);
  if (!bytesEqual(digest, media.contentHash) || data.length !== media.size)
    throw new Error("Saved photo failed its integrity check.");
  let record = (await client.reads.publications.get_photo({ id }))?.value;
  assertActive?.();
  if (!record) {
    await submitAction(
      ctx,
      [
        await client.ops.publications.begin_photo({
          owner,
          id,
          digest,
          size: data.length,
          chunk_hashes: chunks.map(contentHash),
        }),
      ],
      {
        label: "Reserving photo storage",
        success: "Photo storage reserved",
        quietProgress: true,
        beforeSubmit: async () => assertActive?.(),
      }
    );
    record = (await client.reads.publications.get_photo({ id }))?.value;
  }
  if (
    !record ||
    record.owner !== owner ||
    !bytesEqual(record.digest, digest) ||
    record.size !== data.length ||
    record.chunk_hashes.length !== chunks.length ||
    record.chunk_hashes.some((h, i) => !bytesEqual(h, contentHash(chunks[i]!)))
  )
    throw new Error(
      "Photo reservation could not be verified. Resume the saved post to check again."
    );
  let uploadedBytes = chunks.slice(0, record.received).reduce((n, chunk) => n + chunk.length, 0);
  progress(uploadedBytes);
  for (let index = record.received; index < chunks.length; index++) {
    assertActive?.();
    await submitAction(
      ctx,
      [
        await client.ops.publications.append_photo({
          owner,
          id,
          index,
          data: chunks[index]!,
        }),
      ],
      {
        label: `Saving photo ${index + 1}/${chunks.length}`,
        success: "Photo chunk saved",
        quietProgress: true,
        beforeSubmit: async () => assertActive?.(),
      }
    );
    uploadedBytes += chunks[index]!.length;
    progress(uploadedBytes);
  }
  const final = (await client.reads.publications.get_photo({ id }))?.value;
  if (final?.received !== chunks.length)
    throw new Error(
      "Photo storage is still confirming. Resume this saved post; it will not charge twice."
    );
}
