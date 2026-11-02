/** Size pricing and portable history-backed image references (archive v1). */
import { contentHash } from "./ids.js";
import { bytesEqual, concat, fromBase64url, toBase64url } from "./encoding.js";
import type { ProtocolClient } from "./client/protocolClient.js";
export const PHOTO_BLOCK_BYTES = 32768;
export const PHOTO_CHUNK_BYTES = 16384;
export const PHOTO_RATES = [1, 2, 4, 7, 10] as const;
export const PHOTO_MAX_BYTES = PHOTO_BLOCK_BYTES * 10;
export function photoCost(size: number): number {
  if (!Number.isSafeInteger(size) || size <= 0 || size > PHOTO_MAX_BYTES)
    throw new Error(
      "Photo must fit 320 KiB including encryption. Choose a smaller prepared photo."
    );
  return PHOTO_RATES.find((rate) => size <= rate * PHOTO_BLOCK_BYTES)!;
}
export function photoChunks(bytes: Uint8Array): Uint8Array[] {
  photoCost(bytes.length);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += PHOTO_CHUNK_BYTES)
    chunks.push(bytes.slice(offset, offset + PHOTO_CHUNK_BYTES));
  return chunks;
}
export interface PhotoArchiveRecord {
  owner: string;
  digest: Uint8Array;
  size: number;
  chunk_hashes: Uint8Array[];
  received: number;
  units: number;
}
export interface CollectionRecord {
  owner: string;
  kind: number;
  revision: number;
  audience: number;
  members: string[];
  envelope: Uint8Array;
  closed: boolean;
}
export interface AlbumItemRecord {
  envelope: Uint8Array;
  epoch: number;
  revision: number;
  removed: boolean;
}
export function photoLocation(contract: string, id: Uint8Array): string {
  return `osp-photo://${contract}/${toBase64url(id)}`;
}
export function parsePhotoLocation(
  location: string,
  contract: string
): Uint8Array {
  const prefix = `osp-photo://${contract}/`;
  if (!location.startsWith(prefix))
    throw new Error("Photo belongs to another archive.");
  const text = location.slice(prefix.length),
    id = fromBase64url(text);
  if (id.length !== 32 || toBase64url(id) !== text)
    throw new Error("Invalid archive photo reference.");
  return id;
}
export function verifyPhotoChunks(
  record: PhotoArchiveRecord,
  chunks: Uint8Array[],
  expectedHash: Uint8Array
): Uint8Array {
  photoCost(record.size);
  if (
    record.received !== record.chunk_hashes.length ||
    chunks.length !== record.chunk_hashes.length ||
    chunks.length !== Math.ceil(record.size / PHOTO_CHUNK_BYTES)
  )
    throw new Error("Photo upload is incomplete.");
  chunks.forEach((chunk, i) => {
    if (
      chunk.length !==
        Math.min(PHOTO_CHUNK_BYTES, record.size - i * PHOTO_CHUNK_BYTES) ||
      !bytesEqual(contentHash(chunk), record.chunk_hashes[i]!)
    )
      throw new Error("Photo chunk does not match the archive.");
  });
  const bytes = concat(...chunks);
  if (
    !bytesEqual(contentHash(bytes), record.digest) ||
    !bytesEqual(record.digest, expectedHash)
  )
    throw new Error("Photo fingerprint does not match the archive.");
  return bytes;
}
export async function requirePhotoLibrary(
  client: ProtocolClient
): Promise<void> {
  let version: number | undefined;
  try {
    version = (await client.reads.publications.get_library_version({}))
      ?.version;
  } catch {
    /* older contract */
  }
  if (version !== 1)
    throw new Error(
      "This network has not enabled the photo library yet. Update the contracts and indexer before uploading."
    );
}
