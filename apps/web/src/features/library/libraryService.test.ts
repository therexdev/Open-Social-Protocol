// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import {
  AUDIENCE,
  ProtocolClient,
  identityFromSeed,
  newEpochKey,
  toBase64url,
  fromBase64url,
  parseKeyPackageSet,
  openEpochKeyFromSet,
  encryptMedia,
  utf8,
  decodeEnvelope,
  decryptContent,
  unwrapContentKey,
  unwrapMediaKey,
  openMedia,
  type CollectionRecord,
  type AlbumItemRecord,
} from "@osp/sdk";
import {
  fakeProvider,
  fixtureDeployment,
  fakeIndexerFetch,
} from "../../testing/fixtures";
import { IndexerClient } from "../../api/indexer";
import { createVaultStore } from "../../vault/store";
import { memoryStorage } from "../../vault/storage";
import { unsupportedPasskey } from "../../vault/passkey";
import { submitAction } from "../../tx/submit";
import {
  readCollection,
  saveCollection,
  putAlbumPhoto,
  readAlbumPhoto,
  removeAlbumPhoto,
  type LibraryContext,
} from "./libraryService";
import { archivePhoto, prepareArchivedPhoto } from "../composer/archivePhoto";
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
vi.mock("../composer/archivePhoto", async original => ({ ...await original<typeof import("../composer/archivePhoto")>(), archivePhoto: vi.fn() }));
const alice = identityFromSeed(new Uint8Array(32).fill(12)),
  bob = identityFromSeed(new Uint8Array(32).fill(13));
const id = toBase64url(newEpochKey()),
  itemId = toBase64url(newEpochKey());
let ctx: LibraryContext,
  record: CollectionRecord | undefined,
  item: AlbumItemRecord | undefined;
let grants: Array<ReturnType<typeof parseKeyPackageSet>>;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(archivePhoto).mockReset().mockResolvedValue(undefined);
  record = undefined;
  item = undefined;
  grants = [];
  const vault = createVaultStore({
    storage: memoryStorage(),
    kdf: { N: 1024, r: 8, p: 1 },
    passkey: unsupportedPasskey,
  });
  await vault.getState().create("library test passphrase");
  const session = vault.getState().session!,
    client = new ProtocolClient({
      rpc: fakeProvider(),
      deployment: fixtureDeployment(),
    });
  const indexer = new IndexerClient({
    baseUrl: "https://indexer.test",
    fetch: fakeIndexerFetch({}),
  });
  ctx = {
    session,
    services: {
      protocol: client,
      indexer,
      resolved: {} as LibraryContext["services"]["resolved"],
    },
    submit: { client, signer: session.identity.signer, payment: "self-only" },
  };
  vi.spyOn(client.reads.publications, "get_library_version").mockResolvedValue({
    version: 1,
  });
  vi.spyOn(client.reads.publications, "get_collection").mockImplementation(
    async () => ({ value: record })
  );
  vi.spyOn(client.reads.publications, "get_album_item").mockImplementation(
    async () => ({ value: item })
  );
  vi.spyOn(client.reads.identity, "get_identity").mockImplementation(
    async (args) => {
      const account = args!.account;
      const person = [session.identity, alice, bob].find(
        (i) => i.account === account
      )!;
      return {
        value: {
          account,
          owner: account,
          encryption_key: person.encryption.publicKey,
          key_version: 1,
        } as never,
      };
    }
  );
  vi.mocked(submitAction).mockImplementation(async (_ctx, ops, options) => {
    await options?.beforeSubmit?.();
    for (const op of ops) {
      const call = client.contracts.decodeOperation(op)!,
        a = call.args;
      if (call.method === "distribute_keys")
        grants.push(parseKeyPackageSet(a.packages as Uint8Array));
      if (call.method === "save_collection")
        record = {
          owner: a.owner as string,
          kind: a.kind as number,
          revision: (a.previous_revision as number) + 1,
          audience: a.audience as number,
          members: a.members as string[],
          envelope: a.envelope as Uint8Array,
          closed: false,
        };
      if (call.method === "set_album_item")
        item = {
          epoch: a.epoch as number,
          revision: (a.previous_revision as number) + 1,
          envelope: a.envelope as Uint8Array,
          removed: a.removed as boolean,
        };
    }
    return { transaction: { id: "test" } } as Awaited<
      ReturnType<typeof submitAction>
    >;
  });
});
async function create() {
  await saveCollection(ctx, {
    id,
    name: "Family photos",
    kind: 1,
    audience: AUDIENCE.CUSTOM,
    members: [alice.account],
  });
  return readCollection(ctx, id);
}
it("encrypts album names and shares existing album keys only with newly selected accounts", async () => {
  const previous = await create(),
    key = ctx.session!.keys.get({
      author: record!.owner,
      audienceId: fromBase64url(id),
      epoch: 1,
    })!;
  expect(new TextDecoder().decode(record!.envelope)).not.toContain(
    "Family photos"
  );
  expect(previous.name).toBe("Family photos");
  grants = [];
  await saveCollection(ctx, {
    id,
    name: previous.name,
    kind: 1,
    audience: 2,
    members: [bob.account],
    previous,
  });
  const historic = grants.find((g) => g.epoch === 1)!,
    fresh = grants.find((g) => g.epoch === 2)!;
  expect(
    openEpochKeyFromSet(historic, bob.account, bob.encryption.secretKey)
  ).toEqual(key);
  expect(
    openEpochKeyFromSet(fresh, alice.account, alice.encryption.secretKey)
  ).toBeUndefined();
  expect(
    openEpochKeyFromSet(fresh, bob.account, bob.encryption.secretKey)
  ).toHaveLength(32);
  // A retained old key does not authorize a current app view after revocation.
  await expect(
    readCollection(
      { ...ctx, session: { ...ctx.session!, identity: alice } },
      id
    )
  ).rejects.toThrow("no longer shared");
});
it("rewraps an existing encrypted image for the album, avoids duplicate entries, and removes it", async () => {
  const collection = await create(),
    encrypted = encryptMedia(utf8("private image pixels"));
  const media = {
    url: "osp-photo://archive/example",
    mime: "image/jpeg",
    size: encrypted.ciphertext.length,
    contentHash: encrypted.contentHash,
    encryption: {
      key: toBase64url(encrypted.key),
      nonce: toBase64url(encrypted.nonce),
    },
  };
  await putAlbumPhoto(ctx, collection, media, itemId);
  const opened = await readAlbumPhoto(ctx, collection, itemId);
  expect(opened.content.media[0]!.mediaKey).toEqual(encrypted.key);
  const calls = vi.mocked(submitAction).mock.calls.length;
  await putAlbumPhoto(ctx, collection, media, itemId);
  expect(vi.mocked(submitAction).mock.calls.length).toBe(calls);
  await removeAlbumPhoto(ctx, collection, itemId, opened.revision);
  await expect(readAlbumPhoto(ctx, collection, itemId)).rejects.toThrow(
    "removed"
  );
});
it("does not silently publish private images or pretend public images become private", async () => {
  const collection = await create();
  await expect(
    putAlbumPhoto(ctx, collection, {
      url: "https://example.org/public.jpg",
      mime: "image/jpeg",
      size: 1,
      contentHash: new Uint8Array(32),
    })
  ).rejects.toThrow("already public");
});

it("keeps a group banner encrypted and gives new members the current banner without historical group keys", async () => {
  const banner = prepareArchivedPhoto(utf8("private banner pixels"), ctx.services.protocol!, true);
  await saveCollection(ctx, { id, name: "Friends music", kind: 2, audience: 2, members: [alice.account], banner });
  expect(archivePhoto).toHaveBeenCalledOnce();
  expect(record!.envelope.length).toBeLessThanOrEqual(4096);
  const previous = await readCollection(ctx, id);
  expect(previous.banner).toMatchObject({ url: banner.url, encryption: banner.encryption, contentHash: banner.contentHash });
  expect(previous.banner).not.toHaveProperty("archiveBytes");
  grants = []; vi.mocked(archivePhoto).mockClear();
  await saveCollection(ctx, { id, name: "Renamed group", kind: 2, audience: 2, members: [bob.account], previous });
  expect(archivePhoto).not.toHaveBeenCalled();
  expect(grants.map(g => g.epoch)).toEqual([2]);
  const fresh = grants[0]!;
  expect(openEpochKeyFromSet(fresh, alice.account, alice.encryption.secretKey)).toBeUndefined();
  const epochKey = openEpochKeyFromSet(fresh, bob.account, bob.encryption.secretKey)!;
  const aad = { chainId: ctx.services.protocol!.chainId, author: record!.owner, audience: 2,
    audienceId: fromBase64url(id), epoch: 2, postId: fromBase64url(id), versionNumber: 2 };
  const envelope = decodeEnvelope(record!.envelope), content = decryptContent({ envelope, epochKey, aad });
  expect(JSON.parse(content.text!)).toEqual({ name: "Renamed group", banner: 0 });
  const media = content.media![0]!, ck = unwrapContentKey(envelope, epochKey, aad),
    key = unwrapMediaKey(media.wrapped_key!, ck, media.content_hash!);
  expect(openMedia(fromBase64url(banner.archiveBytes!), banner.contentHash, { key, nonce: media.nonce! })).toEqual(utf8("private banner pixels"));
  await expect(readCollection({ ...ctx, session: { ...ctx.session!, identity: alice } }, id)).rejects.toThrow("no longer shared");
});

it("supports existing bannerless groups, banner replacement and explicit removal", async () => {
  const input = { id, name: "Our group", kind: 2, audience: 2, members: [] };
  await saveCollection(ctx, input);
  expect((await readCollection(ctx, id)).banner).toBeUndefined();
  const banner = prepareArchivedPhoto(utf8("banner one"), ctx.services.protocol!, true);
  await saveCollection(ctx, { ...input, previous: await readCollection(ctx, id), banner });
  const replacement = prepareArchivedPhoto(utf8("banner two"), ctx.services.protocol!, true);
  await saveCollection(ctx, { ...input, previous: await readCollection(ctx, id), banner: replacement });
  expect((await readCollection(ctx, id)).banner?.url).toBe(replacement.url);
  await saveCollection(ctx, { ...input, previous: await readCollection(ctx, id), banner: null });
  expect((await readCollection(ctx, id)).banner).toBeUndefined();
  expect(archivePhoto).toHaveBeenCalledTimes(2);
});

it("does not upload a banner for a non-owner, a stale revision, or an unencrypted photo", async () => {
  const input = { id, name: "Our group", kind: 2, audience: 2, members: [alice.account] };
  await saveCollection(ctx, input);
  const previous = await readCollection(ctx, id), banner = prepareArchivedPhoto(utf8("new banner"), ctx.services.protocol!, true);
  await expect(saveCollection({ ...ctx, session: { ...ctx.session!, identity: alice } }, { ...input, previous, banner })).rejects.toThrow("Only the owner");
  await expect(saveCollection(ctx, { ...input, previous, banner: { ...banner, encryption: undefined } })).rejects.toThrow("encrypted photos");
  await saveCollection(ctx, { ...input, name: "Changed elsewhere", previous });
  await expect(saveCollection(ctx, { ...input, previous, banner })).rejects.toThrow("collection changed");
  expect(archivePhoto).not.toHaveBeenCalled();
});

it("retries an interrupted banner upload with the same ciphertext and archive id", async () => {
  const input = { id, name: "Our group", kind: 2, audience: 2, members: [], banner: prepareArchivedPhoto(utf8("banner"), ctx.services.protocol!, true) };
  vi.mocked(archivePhoto).mockRejectedValueOnce(Error("Interrupted"));
  await expect(saveCollection(ctx, input)).rejects.toThrow("Interrupted");
  expect(record).toBeUndefined();
  await saveCollection(ctx, input);
  expect(vi.mocked(archivePhoto).mock.calls.map(call => call[0])).toEqual([input.banner, input.banner]);
  expect((await readCollection(ctx, id)).banner?.encryption).toEqual(input.banner.encryption);
});
