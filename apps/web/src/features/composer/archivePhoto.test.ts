import { beforeEach, expect, it, vi } from "vitest";
import {
  contentHash,
  identityFromSeed,
  ProtocolClient,
  toBase64url,
  type PhotoArchiveRecord,
} from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { configureMediaStorage } from "../../api/mediaStorage";
import { archivePhoto, prepareArchivedPhoto } from "./archivePhoto";
import { submitAction } from "../../tx/submit";
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
const identity = identityFromSeed(new Uint8Array(32).fill(62));
const client = new ProtocolClient({
  rpc: fakeProvider(),
  deployment: fixtureDeployment(),
});
const ctx = { client, signer: identity.signer, payment: "self-only" as const };
let record: PhotoArchiveRecord | undefined,
  charged: number,
  failAt: number,
  appends: number[];
beforeEach(() => {
  record = undefined;
  charged = 0;
  failAt = -1;
  appends = [];
  vi.restoreAllMocks();
  vi.spyOn(client.reads.publications, "get_library_version").mockResolvedValue({
    version: 1,
  });
  vi.spyOn(client.reads.publications, "get_photo").mockImplementation(
    async () => ({ value: record })
  );
  vi.mocked(submitAction).mockImplementation(async (_ctx, ops) => {
    for (const op of ops) {
      const call = client.contracts.decodeOperation(op)!;
      const args = call.args;
      if (call.method === "begin_photo") {
        charged++;
        record = {
          owner: args.owner as string,
          digest: args.digest as Uint8Array,
          size: args.size as number,
          chunk_hashes: args.chunk_hashes as Uint8Array[],
          received: args.external_uri ? (args.chunk_hashes as Uint8Array[]).length : 0,
          external_uri: args.external_uri as string | undefined,
          units: 4,
        };
      }
      if (call.method === "append_photo") {
        const index = args.index as number;
        if (index === failAt) {
          failAt = -1;
          throw new Error("simulated timeout");
        }
        appends.push(index);
        record!.received = index + 1;
      }
    }
    return { transaction: { id: "tx" } } as Awaited<
      ReturnType<typeof submitAction>
    >;
  });
});
it("resumes the same ciphertext after interruption without charging twice", async () => {
  const photo = prepareArchivedPhoto(
      new Uint8Array(40000).fill(3),
      client,
      true
    ),
    saved = JSON.parse(
      JSON.stringify({ ...photo, contentHash: toBase64url(photo.contentHash) })
    );
  failAt = 1;
  await expect(archivePhoto(photo, ctx, identity.account)).rejects.toThrow(
    "timeout"
  );
  expect(charged).toBe(1);
  expect(record!.received).toBe(1);
  await archivePhoto(photo, ctx, identity.account);
  expect(charged).toBe(1);
  expect(appends).toEqual([0, 1, 2]);
  expect(record!.received).toBe(3);
  expect(
    JSON.parse(
      JSON.stringify({ ...photo, contentHash: toBase64url(photo.contentHash) })
    )
  ).toEqual(saved);
});
it("rejects a substituted reservation before uploading any chunks", async () => {
  const photo = prepareArchivedPhoto(
    new Uint8Array(100).fill(4),
    client,
    false
  );
  record = {
    owner: identity.account,
    digest: new Uint8Array(32),
    size: 100,
    chunk_hashes: [contentHash(new Uint8Array(100))],
    received: 0,
    units: 1,
  };
  await expect(archivePhoto(photo, ctx, identity.account)).rejects.toThrow(
    "could not be verified"
  );
  expect(appends).toEqual([]);
  expect(charged).toBe(0);
});

it("commits encrypted R2 photo references without any append transaction", async () => {
  vi.spyOn(client.reads.publications, "get_library_version").mockResolvedValue({ version: 1, external_media_version: 1 });
  const media = prepareArchivedPhoto(new Uint8Array(100).fill(1), client, true);
  const hash = toBase64url(media.contentHash), location = `https://media.example/osp/test/${hash}`;
  const { fromBase64url } = await import("@osp/sdk");
  const stored = fromBase64url(media.archiveBytes!);
  const fetchFn = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === location) return new Response(new Uint8Array(stored));
    return new Response(JSON.stringify(init?.method === "POST" ? { url: location, hash, size: stored.length } : {
      enabled: true, provider: "r2", chainId: client.chainId, contract: client.deployment.contracts.identity.address,
      maxFileBytes: 10485760, publicUrl: "https://media.example",
    }));
  });
  configureMediaStorage(client, "https://uploads.example/v1/media", fetchFn);
  await archivePhoto(media, ctx, identity.account);
  expect(record!.external_uri).toBe(location);
  expect(appends).toEqual([]);
  expect(charged).toBe(1);
  await archivePhoto(media, ctx, identity.account);
  expect(charged).toBe(1);
  expect(fetchFn).toHaveBeenCalledTimes(3);
});
