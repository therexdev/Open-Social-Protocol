// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import {
  ProtocolClient,
  contentHash,
  identityFromSeed,
  musicChunks,
  toBase64url,
  type MusicConfig,
  type MusicRecord,
} from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { submitAction, type SubmitContext } from "../../tx/submit";
import { loadMusic, newMusicDraft, uploadMusic, type MusicDraft } from "./musicService";
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
const alice = identityFromSeed(new Uint8Array(32).fill(8));
let client: ProtocolClient,
  ctx: SubmitContext,
  config: MusicConfig,
  draft: MusicDraft,
  bytes: Uint8Array,
  record: MusicRecord | undefined;
let saved: Map<number, Uint8Array>, paid: number, failAt: number | undefined;
beforeEach(() => {
  vi.restoreAllMocks();
  saved = new Map();
  paid = 0;
  failAt = undefined;
  record = undefined;
  client = new ProtocolClient({
    rpc: fakeProvider(),
    deployment: fixtureDeployment(),
  });
  ctx = { client, signer: alice.signer, payment: "sponsor-only" };
  config = {
    native_token: fixtureDeployment().contracts.token.address,
    version: 1,
    revision: 2,
    recipient: fixtureDeployment().deployer ?? "recipient",
    rate_per_mb: "8610000000",
    max_bytes: 10485760,
    enabled: true,
  };
  bytes = new Uint8Array(40000).fill(9);
  draft = newMusicDraft({
    owner: alice.account,
    payer: alice.account,
    bytes,
    config,
    title: "Test song",
    mime: "audio/mpeg",
    durationMs: 210000,
  });
  vi.spyOn(client.reads.publications, "get_music_config").mockImplementation(async () => ({
    value: config,
  }));
  vi.spyOn(client.reads.publications, "get_music").mockImplementation(async () => ({
    value: record,
  }));
  vi.spyOn(client.reads.publications, "get_music_chunk").mockImplementation(async (args) => ({
    data: saved.get(args!.index)!,
  }));
  vi.mocked(submitAction).mockImplementation(async (_ctx, ops, options) => {
    await options.beforeSubmit?.();
    const op = client.contracts.decodeOperation(ops.length === 3 ? ops[1]! : ops[0]!)!,
      a = op.args;
    if (op.method === "begin_music") {
      paid++;
      record = {
        artist: (a.artist ?? "") as string,
        description: (a.description ?? "") as string,
        audience: (a.audience ?? 0) as number,
        group_id: a.group_id as Uint8Array,
        encrypted: !!a.encrypted,
        nonce: a.nonce as Uint8Array,
        owner_key: a.owner_key as any,
        unlock_price: (a.unlock_price ?? "0") as string,
        key_hash: a.key_hash as Uint8Array,
        owner: a.owner as string,
        payer: a.payer as string,
        title: a.title as string,
        mime: a.mime as string,
        duration_ms: a.duration_ms as number,
        size: a.size as number,
        digest: a.digest as Uint8Array,
        chunk_hashes: a.chunk_hashes as Uint8Array[],
        received: 0,
        fee: a.max_fee as string,
        recipient: config.recipient,
      };
    } else {
      if (a.index === failAt) throw new Error("connection interrupted");
      const batch =
        op.method === "append_music_batch" ? (a.chunks as Uint8Array[]) : [a.data as Uint8Array];
      batch.forEach((chunk, offset) => saved.set(Number(a.index) + offset, chunk));
      record!.received += batch.length;
    }
    return {} as never;
  });
});
it("resumes a partly uploaded track without another payment and verifies playback", async () => {
  failAt = 1;
  await expect(
    uploadMusic(
      ctx,
      draft,
      bytes,
      () => {},
      () => {}
    )
  ).rejects.toThrow("interrupted");
  expect(record?.received).toBe(1);
  expect(paid).toBe(1);
  failAt = undefined;
  config.enabled = false;
  config.revision++;
  await uploadMusic(
    ctx,
    draft,
    bytes,
    () => {},
    () => {}
  );
  expect(paid).toBe(1);
  expect(record?.received).toBe(3);
  const loaded = await loadMusic(client, draft.id);
  expect(toBase64url(contentHash(loaded.bytes))).toBe(draft.digest);
  saved.get(1)![0] = saved.get(1)![0]! ^ 1;
  await expect(loadMusic(client, draft.id)).rejects.toThrow("verification");
});
it("does not pay after a stale quote, different file, or account lock", async () => {
  config.revision++;
  await expect(
    uploadMusic(
      ctx,
      draft,
      bytes,
      () => {},
      () => {}
    )
  ).rejects.toThrow("price changed");
  config.revision--;
  await expect(
    uploadMusic(
      ctx,
      draft,
      new Uint8Array(4),
      () => {},
      () => {}
    )
  ).rejects.toThrow("same audio file");
  await expect(
    uploadMusic(
      ctx,
      draft,
      bytes,
      () => {
        throw Error("locked");
      },
      () => {}
    )
  ).rejects.toThrow("locked");
  expect(paid).toBe(0);
  expect(submitAction).not.toHaveBeenCalled();
});
it("stops between confirmed chunks and resumes after a pause", async () => {
  let stopped = false;
  await expect(
    uploadMusic(
      ctx,
      draft,
      bytes,
      () => {
        if (stopped) throw Error("paused");
      },
      (n) => {
        if (n === 1) stopped = true;
      }
    )
  ).rejects.toThrow("paused");
  expect(record?.received).toBe(1);
  await uploadMusic(
    ctx,
    draft,
    bytes,
    () => {},
    () => {}
  );
  expect(paid).toBe(1);
});
it("handles a previously completed reservation without sending or charging anything", async () => {
  await uploadMusic(
    ctx,
    draft,
    bytes,
    () => {},
    () => {}
  );
  vi.mocked(submitAction).mockClear();
  await uploadMusic(
    ctx,
    draft,
    bytes,
    () => {},
    () => {}
  );
  expect(submitAction).not.toHaveBeenCalled();
  expect(paid).toBe(1);
});
it("loads all 513 chunks of the 3:30 benchmark with at most four reads in flight", async () => {
  const large = new Uint8Array(8403113).fill(81),
    chunks = musicChunks(large);
  record = {
    owner: alice.account,
    payer: alice.account,
    title: "Full-size test",
    mime: "audio/mpeg",
    duration_ms: 210000,
    digest: contentHash(large),
    size: large.length,
    chunk_hashes: chunks.map(contentHash),
    received: chunks.length,
    fee: "72400000000",
    recipient: "recipient",
  };
  let active = 0,
    peak = 0;
  vi.mocked(client.reads.publications.get_music_chunk).mockImplementation(async (args) => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return { data: chunks[args!.index]! };
  });
  expect(contentHash((await loadMusic(client, draft.id)).bytes)).toEqual(contentHash(large));
  expect(client.reads.publications.get_music_chunk).toHaveBeenCalledTimes(513);
  expect(peak).toBeLessThanOrEqual(4);
});

it("batches four chunks, resumes after interruption, and preserves encrypted audio and metadata", async () => {
  const { musicCipher, musicKeyContext, fromBase64url, openMusicKey } = await import("@osp/sdk");
  config.version = 2;
  bytes = new Uint8Array(150000).fill(42);
  draft = newMusicDraft({
    owner: alice.account,
    payer: alice.account,
    bytes,
    config,
    title: "Private song",
    artist: "Test artist",
    description: "Test description",
    audience: 1,
    unlockPrice: "9",
    identity: alice,
    client,
    mime: "audio/mpeg",
    durationMs: 210000,
  });
  failAt = 4;
  await expect(
    uploadMusic(
      ctx,
      draft,
      bytes,
      () => {},
      () => {}
    )
  ).rejects.toThrow("interrupted");
  expect(record!.received).toBe(4);
  expect(paid).toBe(1);
  const restored = JSON.parse(JSON.stringify(draft));
  failAt = undefined;
  await uploadMusic(
    ctx,
    restored,
    bytes,
    () => {},
    () => {}
  );
  expect(paid).toBe(1);
  expect(record!.received).toBe(10);
  expect(record!.artist).toBe("Test artist");
  const loaded = await loadMusic(client, draft.id);
  expect(loaded.bytes).not.toEqual(bytes);
  const context = musicKeyContext(
    client.chainId,
    client.deployment.contracts.publications.address,
    fromBase64url(draft.id),
    alice.account
  );
  const key = openMusicKey(
    context,
    record!.owner_key!,
    alice.account,
    alice.seed,
    record!.key_hash!
  );
  expect(musicCipher(context, key, record!.nonce!).decrypt(loaded.bytes)).toEqual(bytes);
});
it("rejects an encrypted file that would exceed the limit and invalid OSAT prices", () => {
  config.version = 2;
  config.max_bytes = 100;
  const input = {
    owner: alice.account,
    payer: alice.account,
    bytes: new Uint8Array(100),
    config,
    title: "Song",
    identity: alice,
    client,
    mime: "audio/mpeg",
    durationMs: 1000,
  };
  expect(() => newMusicDraft({ ...input, audience: 1 })).toThrow("including encryption");
  for (const unlockPrice of ["-1", "1.5", "1000001", "1e2"])
    expect(() => newMusicDraft({ ...input, unlockPrice })).toThrow("whole OSAT");
});
