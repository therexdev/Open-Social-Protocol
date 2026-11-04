// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { contentHash, identityFromSeed, musicCipher, musicKeyContext, newEpochKey, photoLocation, ProtocolClient, sealMusicKey, toBase64url, type MusicRecord } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import type { Services } from "../../api/services";
import { cachedMediaBytes } from "../../api/mediaCache";
import { archivePhoto } from "../composer/archivePhoto";
import { submitAction } from "../../tx/submit";
import { artworkRecord, loadMusicArtwork, prepareMusicArtwork, saveMusicArtwork } from "./musicArtwork";
vi.mock("../composer/archivePhoto", () => ({ archivePhoto: vi.fn() }));
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
const owner = identityFromSeed(new Uint8Array(32).fill(8)), buyer = identityFromSeed(new Uint8Array(32).fill(9));
const track = new Uint8Array(32).fill(44), trackId = toBase64url(track), image = new Uint8Array([255,216,255,1,2,3]);
let client: ProtocolClient;
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() }); });
function record(cover: ReturnType<typeof artworkRecord>, key?: Uint8Array): MusicRecord {
  const context = musicKeyContext(client.chainId, client.deployment.contracts.publications.address, track, owner.account);
  return { owner: owner.account, size: 1, digest: contentHash(new Uint8Array([1])), chunk_hashes: [new Uint8Array(32)], received: 1, title: "Track", mime: "audio/mpeg", duration_ms: 10000, fee: "10000000000", recipient: buyer.account, payer: owner.account, cover,
    audience: key ? 1 : 0, encrypted: !!key, key_hash: key && contentHash(key), owner_key: key && sealMusicKey(context, key, { address: owner.account, publicKey: owner.encryption.publicKey, keyVersion: 1 }) };
}
it("verifies artwork, caches only ciphertext and rechecks access before reading a private cache hit", async () => {
  const key = newEpochKey(), draft = prepareMusicArtwork(client, track, owner.account, 1, image, key), cover = artworkRecord(draft), value = record(cover, key);
  const bytes = Buffer.from(draft.bytes, "base64url"), archive = { owner: owner.account, size: cover.size, digest: cover.digest, received: 1, chunk_hashes: [contentHash(bytes)], units: 1 };
  const chunks = vi.fn(async () => ({ chunks: [draft.bytes] }));
  const services = { protocol: client, indexer: { photoChunks: chunks } } as unknown as Services;
  vi.spyOn(client.reads.publications, "get_music").mockResolvedValue({ value });
  vi.spyOn(client.reads.publications, "get_photo").mockResolvedValue({ value: archive });
  const context = musicKeyContext(client.chainId, client.deployment.contracts.publications.address, track, owner.account);
  const access = vi.spyOn(client.reads.publications, "get_music_access").mockResolvedValue({ eligible: true, value: { status: 2, key: sealMusicKey(context, key, { address: buyer.account, publicKey: buyer.encryption.publicKey, keyVersion: 1 }) } } as never);
  const session = { identity: buyer } as never;
  expect(await loadMusicArtwork(services, trackId, value, session)).toEqual(image);
  expect(cachedMediaBytes(photoLocation(client.deployment.contracts.publications.address, cover.photo_id), toBase64url(cover.digest))).toEqual(new Uint8Array(bytes));
  expect(bytes.length).toBe(image.length + 16);
  expect(() => musicCipher(context, key, cover.nonce!).decrypt(bytes)).toThrow();
  access.mockResolvedValue({ eligible: false } as never);
  await expect(loadMusicArtwork(services, trackId, value, session)).rejects.toThrow("not shared");
  expect(chunks).toHaveBeenCalledTimes(1);
});
it("public artwork does not need a wallet, and tampering is rejected", async () => {
  const draft = prepareMusicArtwork(client, track, owner.account, 0, image), cover = artworkRecord(draft), value = record(cover);
  vi.spyOn(client.reads.publications, "get_photo").mockResolvedValue({ value: { owner: owner.account, size: image.length, digest: cover.digest, received: 1, chunk_hashes: [contentHash(image)], units: 1 } });
  const chunks = vi.fn(async () => ({ chunks: [toBase64url(new Uint8Array([7,8]))] }));
  const services = { protocol: client, indexer: { photoChunks: chunks } } as unknown as Services;
  await expect(loadMusicArtwork(services, trackId, value)).rejects.toThrow();
  chunks.mockResolvedValue({ chunks: [draft.bytes] }); expect(await loadMusicArtwork(services, trackId, value)).toEqual(image);
  expect(cover.encrypted).toBe(false);
});
it("resumes confirmed cover updates without another archive or transaction, and rejects stale revisions before charging", async () => {
  const draft = prepareMusicArtwork(client, track, owner.account, 0, image), cover = artworkRecord(draft), value = record(cover);
  const get = vi.spyOn(client.reads.publications, "get_music").mockResolvedValue({ value });
  const ctx = { client, signer: owner.signer, payment: "self-only" as const };
  await saveMusicArtwork(ctx, trackId, owner.account, draft, 0, () => {});
  expect(archivePhoto).not.toHaveBeenCalled(); expect(submitAction).not.toHaveBeenCalled();
  get.mockResolvedValue({ value: { ...value, cover: undefined, cover_revision: 2 } });
  await expect(saveMusicArtwork(ctx, trackId, owner.account, draft, 0, () => {})).rejects.toThrow("another device");
  expect(archivePhoto).not.toHaveBeenCalled();
});
