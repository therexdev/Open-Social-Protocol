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
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
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
  vi.mocked(submitAction).mockImplementation(async (_ctx, ops) => {
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
