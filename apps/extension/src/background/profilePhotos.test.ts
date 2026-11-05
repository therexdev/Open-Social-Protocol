import { describe, expect, it, vi } from "vitest";
import {
  PROFILE_URI_PREFIX, ProtocolContracts, contentHash, encode, encodeProfile, encryptContent,
  identityFromSeed, photoChunks, photoLocation, profilePhotoId, toBase64url, type Profile, type ProtocolClient,
} from "@osp/sdk";
import { ProfilePhotos } from "./profilePhotos";
import type { FeedDeps } from "./feed";
import { createTestBackground } from "../test/support";
import type { FeedItem, EmbeddedMedia, Reply } from "../shared/protocol";
import { IndexerClient, type PostView } from "../shared/indexer";

const author = identityFromSeed(new Uint8Array(32).fill(19)).account;
const contract = identityFromSeed(new Uint8Array(32).fill(20)).account;
function fixture(legacy = false) {
  const bytes = new Uint8Array([1, 2, 3, 4]), digest = contentHash(bytes), hash = toBase64url(digest);
  const photoId = profilePhotoId(author, digest), chunks = photoChunks(bytes);
  const record = { owner: author, digest, size: bytes.length, received: chunks.length, chunk_hashes: chunks.map(contentHash), units: 1 };
  const identity: { account: string; profile_uri: string; profile_hash: Uint8Array } = { account: author, profile_uri: "", profile_hash: new Uint8Array() };
  const setProfile = (profile: Profile) => {
    const encoded = encodeProfile(profile);
    identity.profile_uri = PROFILE_URI_PREFIX + toBase64url(encoded); identity.profile_hash = contentHash(encoded);
  };
  setProfile({ display_name: "Photo Author", banner_photo_hash: new Uint8Array(32).fill(6),
    ...(legacy ? { avatar: { content_hash: digest, mime: "image/png", locations: [photoLocation(contract, photoId)] } } : { avatar_photo_hash: digest }) });
  const getPhoto = vi.fn(async () => ({ value: record })), photoChunksRead = vi.fn(async () => ({ chunks: chunks.map(toBase64url) }));
  const client = { chainId: "test", deployment: { contracts: { publications: { address: contract } } }, reads: {
    identity: { get_identity: vi.fn(async () => ({ value: identity })) }, publications: { get_photo: getPhoto },
  } } as unknown as ProtocolClient;
  const photos = new ProfilePhotos({ clients: async () => ({ protocol: client, indexer: { photoChunks: photoChunksRead } }) } as unknown as Pick<FeedDeps, "clients">);
  return { photos, hash, bytes, photoId, identity, setProfile, record, getPhoto, photoChunksRead };
}

describe("Facebook profile photos", () => {
  it("loads the current avatar rather than the banner and reuses verified bytes across cards", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.photos.load(author, f.hash), f.photos.load(author, f.hash)]);
    expect(a).toEqual({ data: toBase64url(f.bytes), mime: "image/jpeg" }); expect(b).toEqual(a);
    expect(f.getPhoto).toHaveBeenCalledWith({ id: f.photoId }); expect(f.photoChunksRead).toHaveBeenCalledTimes(1);
    await f.photos.load(author, f.hash); expect(f.photoChunksRead).toHaveBeenCalledTimes(1);
  });
  it("supports legacy archived avatars", async () => {
    const f = fixture(true);
    expect(await f.photos.load(author, f.hash)).toEqual({ data: toBase64url(f.bytes), mime: "image/png" });
  });
  it("rejects corrupt bytes without caching the failure", async () => {
    const f = fixture(); f.photoChunksRead.mockResolvedValueOnce({ chunks: [toBase64url(new Uint8Array([9, 9, 9, 9]))] });
    await expect(f.photos.load(author, f.hash)).rejects.toThrow(/chunk/);
    expect(await f.photos.load(author, f.hash)).toMatchObject({ data: toBase64url(f.bytes) });
  });
  it("rechecks profile ownership, fingerprint and replacement even when the old photo is cached", async () => {
    const f = fixture(); await f.photos.load(author, f.hash);
    f.identity.profile_hash = new Uint8Array(32);
    await expect(f.photos.load(author, f.hash)).rejects.toThrow(/verified/);
    f.setProfile({ avatar_photo_hash: contentHash(f.bytes) }); f.identity.account = contract;
    await expect(f.photos.load(author, f.hash)).rejects.toThrow(/verified/);
    f.identity.account = author; f.setProfile({ avatar_photo_hash: new Uint8Array(32).fill(7) });
    await expect(f.photos.load(author, f.hash)).rejects.toThrow(/changed/);
    f.setProfile({ display_name: "No photo" });
    await expect(f.photos.load(author, f.hash)).rejects.toThrow(/changed/);
    expect(f.photoChunksRead).toHaveBeenCalledTimes(1);
  });
  it("does not fetch arbitrary or executable avatar URLs", async () => {
    const f = fixture();
    for (const location of ["https://untrusted.test/picture", "javascript:alert(1)"]) {
      f.setProfile({ avatar: { content_hash: contentHash(f.bytes), mime: "image/png", locations: [location] } });
      await expect(f.photos.load(author, f.hash)).rejects.toThrow(/location/);
    }
    f.setProfile({ avatar: { content_hash: contentHash(f.bytes), mime: "image/svg+xml", locations: [photoLocation(contract, f.photoId)] } });
    await expect(f.photos.load(author, f.hash)).rejects.toThrow(/Unsupported/);
    expect(f.photoChunksRead).not.toHaveBeenCalled();
  });
  it("wires the image to the verified author and only returns it to the bound Facebook card", async () => {
    const t = createTestBackground({ indexer: true, origins: ["https://www.facebook.com/*"] });
    const f = fixture(), postId = toBase64url(new Uint8Array(32).fill(18));
    const envelope = encryptContent({ content: { text: "A post with an avatar" } }).bytes;
    t.state.posts.push({ postId, author, audience: 0, state: 0, versionNumber: 1, contentHash: toBase64url(contentHash(envelope)),
      envelope: toBase64url(envelope), replyTo: "", audienceId: "", epoch: 0, createdAt: "1", reactions: { total: 0, byType: {} }, labels: [], replyCount: 0,
      sequence: "1", previousVersion: "", media: [], stateReason: "", replacementId: "", updatedAt: "1", txId: "", blockHeight: "1", versions: [] });
    t.indexer.profiles.set(author, { profileUri: f.identity.profile_uri });
    const contracts = new ProtocolContracts(t.deployment), original = t.provider.readContract.bind(t.provider);
    vi.spyOn(t.provider, "readContract").mockImplementation(async op => {
      const decoded = contracts.decodeOperation(op);
      const value = decoded?.method === "get_identity" ? f.identity : decoded?.method === "get_photo" ? f.record : undefined;
      return value ? { logs: "", result: toBase64url(encode(`${decoded!.contract}.${decoded!.method}_result`, { value })) } : original(op);
    });
    const chunksRead = vi.spyOn(IndexerClient.prototype, "photoChunks").mockResolvedValue({ chunks: [toBase64url(f.bytes)] });
    await t.call("adapter.enable", { adapter: "facebook" }); await t.call("settings.update", { patch: { feedInsertion: true } });
    const content = t.chrome._contentSender("https://www.facebook.com/"), frame = { ...t.chrome._extensionSender(`src/embed/index.html#post=${postId}`), frameId: 2, tab: content.tab };
    const send = <T>(type: string, payload: unknown, sender = frame) => t.chrome._dispatch({ type, payload }, sender) as Promise<Reply<T>>;
    const card = await send<{ item: FeedItem }>("embed.post", { postId });
    expect(card.ok && card.result.item).toMatchObject({ authorName: "Photo Author", authorAvatarHash: f.hash });
    const photo = await send<EmbeddedMedia>("embed.avatar", { postId, hash: f.hash });
    expect(photo.ok && photo.result).toEqual({ data: toBase64url(f.bytes), mime: "image/jpeg" });
    expect((await send("embed.avatar", { postId, hash: f.hash }, content as typeof frame)).ok).toBe(false);
    expect((await send("embed.avatar", { postId, hash: f.hash, author: contract })).ok).toBe(false);
    expect((await send("embed.avatar", { postId: toBase64url(new Uint8Array(32).fill(1)), hash: f.hash })).ok).toBe(false);
    expect((await send("embed.avatar", { postId, targetId: toBase64url(new Uint8Array(32).fill(1)), hash: f.hash })).ok).toBe(false);
    expect(t.state.broadcasts).toHaveLength(0);
    chunksRead.mockRestore();
  });
});
