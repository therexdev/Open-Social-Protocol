import { beforeEach, expect, it, vi } from "vitest";
import { contentHash, identityFromSeed, ProtocolClient, type MusicRecord } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "./__tests__/helpers.js";
import { musicAllowance } from "./music.js";
import { QuotaStore } from "./quota.js";
const alice = identityFromSeed(new Uint8Array(32).fill(9)).account,
  sponsor = identityFromSeed(new Uint8Array(32).fill(10)).account;
let client: ProtocolClient, record: MusicRecord | undefined;
const id = new Uint8Array(32).fill(8),
  data = new Uint8Array(16384).fill(11);
beforeEach(() => {
  client = new ProtocolClient({
    rpc: fakeProvider(),
    deployment: fixtureDeployment(),
  });
  record = {
    owner: alice,
    payer: alice,
    recipient: sponsor,
    fee: "72400000000",
    size: 8403113,
    received: 0,
    chunk_hashes: Array.from({ length: 513 }, () => contentHash(data)),
    digest: new Uint8Array(32),
    title: "Song",
    mime: "audio/mpeg",
    duration_ms: 210000,
  };
  vi.spyOn(client.reads.publications, "get_music").mockImplementation(async () => ({
    value: record,
  }));
});
const append = () => client.ops.publications.append_music({ owner: alice, id, index: 0, data });
it("provides a bounded paid quota that carries a 513-chunk upload past the free-post limit", async () => {
  const paid = await musicAllowance(client, sponsor, alice, [await append()]);
  expect(paid?.limit).toBe(1026);
  const quota = new QuotaStore({
    path: ":memory:",
    limits: { dailyOps: 200, burstOps: 180, burstWindowSec: 60 },
  });
  for (let i = 0; i < 513; i++) {
    const hold = quota.reserve(paid!.key, 1, 1700000000000 + i * 1000, paid!.limit);
    expect(hold.ok).toBe(true);
    if (hold.ok) hold.commit();
  }
  expect(quota.dailyOps(alice, 1700000000000)).toBe(0);
  quota.close();
});
it("refuses unpaid uploads, other treasuries, stale/replayed chunks and corrupt bytes", async () => {
  const op = await append();
  record!.recipient = alice;
  await expect(musicAllowance(client, sponsor, alice, [op])).rejects.toThrow("paid music");
  record!.recipient = sponsor;
  record!.received = 1;
  await expect(musicAllowance(client, sponsor, alice, [op])).rejects.toThrow("Refresh");
  record!.received = 0;
  record!.chunk_hashes[0] = new Uint8Array(32);
  await expect(musicAllowance(client, sponsor, alice, [op])).rejects.toThrow("Refresh");
  record = undefined;
  await expect(musicAllowance(client, sponsor, alice, [op])).rejects.toThrow("paid music");
});
it("rejects mixed bundles and leaves ordinary operations on their normal quota", async () => {
  const op = await append();
  await expect(musicAllowance(client, sponsor, alice, [op, op])).rejects.toThrow("one operation");
  expect(
    await musicAllowance(client, sponsor, alice, [
      await client.ops.publications.react({
        actor: alice,
        post_id: id,
        reaction: 1,
        active: true,
      } as never),
    ])
  ).toBeUndefined();
});

import { musicPaymentOperations, type MusicConfig } from "@osp/sdk";
import { Allowlist, defaultAllowlist } from "./policy.js";
import { validateOperations } from "./validate.js";
it("only sponsors exact native payment bundles to this sponsor", async () => {
  const native = identityFromSeed(new Uint8Array(32).fill(12)).account;
  const config: MusicConfig = {
    version: 1,
    revision: 1,
    native_token: native,
    recipient: sponsor,
    enabled: true,
    rate_per_mb: "8610000000",
    max_bytes: 10485760,
  };
  vi.spyOn(client.reads.publications, "get_music_config").mockResolvedValue({
    value: config,
  });
  const args = {
    owner: alice,
    payer: alice,
    id,
    digest: contentHash(data),
    size: data.length,
    chunk_hashes: [contentHash(data)],
    title: "Song",
    mime: "audio/mpeg",
    duration_ms: 210000,
    config_revision: 1,
    max_fee: "200000000",
  };
  const bundle = await musicPaymentOperations(client, args, native);
  const context = {
    sponsor,
    chainId: client.chainId,
    contracts: client.contracts,
    allowlist: new Allowlist([
      ...defaultAllowlist(client.deployment),
      {
        contract: "native" as const,
        address: native,
        method: "approve",
        entryPoint: 0x74e21680,
      },
    ]),
    limits: { maxBytesPerOp: 24576, maxRcPerOp: "200000000", maxOpsPerTx: 4 },
  };
  expect(await validateOperations(bundle, alice, context)).toHaveLength(3);
  expect(await musicAllowance(client, sponsor, alice, bundle)).toBeUndefined();
  await expect(validateOperations([bundle[0]!], alice, context)).rejects.toThrow(
    "exact music payment"
  );
  await expect(
    validateOperations([bundle[0]!, bundle[1]!, bundle[0]!], alice, context)
  ).rejects.toThrow("exact music payment");
  await expect(validateOperations(bundle, sponsor, context)).rejects.toThrow();
  config.recipient = alice;
  await expect(musicAllowance(client, sponsor, alice, bundle)).rejects.toThrow(
    "configured account"
  );
});

it("checks every chunk in a batch and charges quota per chunk", async () => {
  const op = await client.ops.publications.append_music_batch({
    owner: alice,
    id,
    index: 0,
    chunks: [data, data, data, data],
  });
  const allowance = await musicAllowance(client, sponsor, alice, [op]);
  expect(allowance?.units).toBe(4);
  expect(allowance?.limit).toBe(1026);
  record!.chunk_hashes[3] = new Uint8Array(32);
  await expect(musicAllowance(client, sponsor, alice, [op])).rejects.toThrow("Refresh");
});
it("sponsors sixteen chunks with sixteen quota units and rejects corruption in the last chunk", async () => {
  const op = await client.ops.publications.append_music_batch({ owner: alice, id, index: 0, chunks: Array.from({ length: 16 }, () => data) });
  expect((await musicAllowance(client, sponsor, alice, [op]))?.units).toBe(16);
  record!.chunk_hashes[15] = new Uint8Array(32);
  await expect(musicAllowance(client, sponsor, alice, [op])).rejects.toThrow("Refresh");
});
it("rejects oversized or mixed batches, skipped indexes and a forged owner", async () => {
  const batch = (changes = {}) =>
    client.ops.publications.append_music_batch({
      owner: alice,
      id,
      index: 0,
      chunks: [data, data, data, data],
      ...changes,
    });
  await expect(
    musicAllowance(client, sponsor, alice, [
      await batch({ chunks: Array.from({ length: 17 }, () => data) }),
    ])
  ).rejects.toThrow();
  await expect(
    musicAllowance(client, sponsor, alice, [await batch({ index: 1 })])
  ).rejects.toThrow();
  await expect(
    musicAllowance(client, sponsor, alice, [await batch({ owner: sponsor })])
  ).rejects.toThrow();
  await expect(
    musicAllowance(client, sponsor, alice, [await batch(), await append()])
  ).rejects.toThrow();
});
