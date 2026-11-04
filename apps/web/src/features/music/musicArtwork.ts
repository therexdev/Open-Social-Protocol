import {
  bytesEqual, contentHash, decode, encode, fromBase64url, musicCoverCipher, musicKeyContext,
  newEpochKey, photoCost, photoLocation, randomBytes, toBase64url, verifyPhotoChunks,
  type MusicCover, type MusicRecord, type ProtocolClient,
} from "@osp/sdk";
import type { Services } from "../../api/services";
import { cachedMediaBytes, rememberMediaBytes } from "../../api/mediaCache";
import { archivePhoto } from "../composer/archivePhoto";
import { submitAction, type SubmitContext } from "../../tx/submit";
import type { Session } from "../../vault/store";
import { deriveAesKey, EncryptedStore } from "../../vault/encryptedStore";
import { defaultStorage } from "../../vault/storage";
import { readingKey } from "./musicAccessService";

export interface MusicArtworkDraft { cover: string; bytes: string }
export const artworkRecord = (draft: MusicArtworkDraft) => decode<MusicCover>("publications.music_cover", fromBase64url(draft.cover));
export async function supportsMusicArt(client: ProtocolClient): Promise<boolean> {
  try { return (await client.reads.publications.get_music_art_version({}))?.version === 1; } catch { return false; }
}
export function prepareMusicArtwork(client: ProtocolClient, id: Uint8Array, owner: string, audience: number, bytes: Uint8Array, key?: Uint8Array): MusicArtworkDraft {
  const encrypted = audience !== 0, nonce = encrypted ? randomBytes(24) : undefined;
  if (encrypted && !key) throw Error("Unlock the track key before adding restricted artwork.");
  const stored = encrypted ? musicCoverCipher(musicKeyContext(client.chainId, client.deployment.contracts.publications.address, id, owner), key!, nonce!).encrypt(bytes) : bytes;
  photoCost(stored.length);
  const cover: MusicCover = { photo_id: newEpochKey(), digest: contentHash(stored), size: stored.length, mime: "image/jpeg", encrypted, ...(nonce && { nonce }) };
  return { cover: toBase64url(encode("publications.music_cover", cover as unknown as Record<string, unknown>)), bytes: toBase64url(stored) };
}
export async function archiveMusicArtwork(ctx: SubmitContext, owner: string, draft: MusicArtworkDraft, assertActive: () => void) {
  if (!await supportsMusicArt(ctx.client)) throw Error("Update the publications contract before saving track artwork.");
  const cover = artworkRecord(draft);
  await archivePhoto({ url: photoLocation(ctx.client.deployment.contracts.publications.address, cover.photo_id), contentHash: cover.digest, mime: cover.mime, size: cover.size, archiveBytes: draft.bytes }, ctx, owner, assertActive);
}
export async function saveMusicArtwork(ctx: SubmitContext, id: string, owner: string, draft: MusicArtworkDraft, revision: number, assertActive: () => void) {
  const key = fromBase64url(id), cover = artworkRecord(draft);
  const current = (await ctx.client.reads.publications.get_music({ id: key }))?.value;
  if (!current || current.owner !== owner) throw Error("Track ownership could not be verified.");
  if (current.cover && bytesEqual(current.cover.photo_id, cover.photo_id) && bytesEqual(current.cover.digest, cover.digest)) return;
  if ((current.cover_revision ?? 0) !== revision) throw Error("Artwork changed on another device. Refresh before saving.");
  assertActive();
  await archiveMusicArtwork(ctx, owner, draft, assertActive);
  await submitAction(ctx, [await ctx.client.ops.publications.set_music_cover({ owner, id: key, cover, expected_revision: revision })], { label: "Saving track artwork", beforeSubmit: async () => assertActive() });
  const saved = (await ctx.client.reads.publications.get_music({ id: key }))?.value;
  if (!saved?.cover || !bytesEqual(saved.cover.photo_id, cover.photo_id) || !bytesEqual(saved.cover.digest, cover.digest)) throw Error("Artwork is still confirming. Resume to check it without uploading again.");
}
export async function artworkDraftStore(session: Session, client: ProtocolClient, id: string) {
  const scope = `${client.chainId}:${client.deployment.contracts.publications.address}:${session.identity.account}:${id}`;
  return new EncryptedStore<{ artwork: MusicArtworkDraft; revision: number }>(defaultStorage(), `osp.web.music-artwork.${scope}`, await deriveAesKey(session.identity.seed, `music-artwork:${scope}`));
}
export async function loadMusicArtwork(services: Services, id: string, record: MusicRecord, session?: Session, signal?: AbortSignal) {
  const client = services.protocol, cover = record.cover;
  if (!client || !cover || !["image/jpeg", "image/png", "image/webp"].includes(cover.mime)) throw Error("Artwork unavailable.");
  photoCost(cover.size);
  const check = () => { if (signal?.aborted) throw Error("Artwork loading cancelled."); };
  check();
  let key: Uint8Array | undefined;
  try {
    if (cover.encrypted) {
      const fresh = (await client.reads.publications.get_music({ id: fromBase64url(id) }))?.value;
      if (!fresh?.cover || fresh.owner !== record.owner || !bytesEqual(fresh.cover.photo_id, cover.photo_id)) throw Error("Artwork changed. Refresh this track.");
      key = await readingKey(client, id, fresh, session);
      if (!key || cover.nonce?.length !== 24) throw Error("Unlock access to view this artwork.");
    }
    const archive = (await client.reads.publications.get_photo({ id: cover.photo_id }))?.value;
    if (!archive || archive.owner !== record.owner || archive.size !== cover.size || archive.received !== archive.chunk_hashes.length || !bytesEqual(archive.digest, cover.digest)) throw Error("Artwork archive could not be verified.");
    const location = photoLocation(client.deployment.contracts.publications.address, cover.photo_id), hash = toBase64url(cover.digest);
    let bytes = cachedMediaBytes(location, hash);
    if (!bytes) {
      const response = await services.indexer.photoChunks(toBase64url(cover.photo_id));
      bytes = verifyPhotoChunks(archive, response.chunks.map(fromBase64url), cover.digest);
      rememberMediaBytes(location, hash, bytes);
    }
    if (bytes.length !== cover.size || !bytesEqual(contentHash(bytes), cover.digest)) throw Error("Artwork failed verification.");
    check();
    return key ? musicCoverCipher(musicKeyContext(client.chainId, client.deployment.contracts.publications.address, fromBase64url(id), record.owner), key, cover.nonce!).decrypt(bytes) : bytes;
  } finally { key?.fill(0); }
}
