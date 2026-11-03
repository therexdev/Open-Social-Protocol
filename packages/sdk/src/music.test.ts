import { describe, expect, it } from "vitest";
import { contentHash } from "./ids.js";
import {
  MUSIC_DEFAULT_RATE,
  MUSIC_MAX_BYTES,
  musicChunks,
  musicFee,
  verifyMusic,
  type MusicRecord,
} from "./music.js";
describe("native music pricing and verification", () => {
  it("quotes the 3:30 320 kbps benchmark at exactly 724 native tokens", () => {
    expect(musicFee(8403113)).toBe("72400000000");
    expect(musicFee(5041885)).toBe("43500000000");
    expect(musicFee(1000000)).toBe("8700000000");
    expect(musicFee(1)).toBe("100000000");
    expect(musicFee(1000000, "100000000")).toBe("100000000");
    expect(musicFee(1000001, "100000000")).toBe("200000000");
    for (const size of [0, -1, 1.5, NaN, MUSIC_MAX_BYTES + 1])
      expect(() => musicFee(size)).toThrow();
    for (const rate of ["0", "-1", "1.2", "1000000000001"])
      expect(() => musicFee(1, rate)).toThrow();
    expect(musicFee(MUSIC_MAX_BYTES, MUSIC_DEFAULT_RATE)).toBe("90300000000");
  });
  it("handles 513 chunks and rejects truncation, corruption, reordering and wrong full hashes", () => {
    const bytes = new Uint8Array(8403113);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const chunks = musicChunks(bytes);
    expect(chunks).toHaveLength(513);
    const record: MusicRecord = {
      owner: "owner",
      digest: contentHash(bytes),
      size: bytes.length,
      chunk_hashes: chunks.map(contentHash),
      received: chunks.length,
      title: "Test",
      mime: "audio/mpeg",
      duration_ms: 210000,
      fee: musicFee(bytes.length),
      recipient: "recipient",
      payer: "owner",
    };
    expect(contentHash(verifyMusic(record, chunks))).toEqual(contentHash(bytes));
    expect(() => verifyMusic(record, chunks.slice(0, -1))).toThrow("incomplete");
    const wrong = chunks.map((x) => x.slice());
    wrong[1]![0] = wrong[1]![0]! ^ 1;
    expect(() => verifyMusic(record, wrong)).toThrow("chunk verification");
    expect(() => verifyMusic(record, [...chunks].reverse())).toThrow("chunk verification");
    expect(() => verifyMusic({ ...record, digest: new Uint8Array(32) }, chunks)).toThrow(
      "file verification"
    );
  });
});

import { ProtocolClient } from "./client/protocolClient.js";
import { fixtureDeployment, fakeProvider } from "./testing/fixtures.js";
import { identityFromSeed } from "./vault.js";
import { encode, toBase64url } from "./encoding.js";
import { musicPaymentOperations, validMusicPaymentBundle } from "./music.js";
it("restricts native approvals to an exact fee and clears allowance in the same signed bundle", async () => {
  const client = new ProtocolClient({
    rpc: fakeProvider(),
    deployment: fixtureDeployment(),
  });
  const payer = identityFromSeed(new Uint8Array(32).fill(11)).account,
    native = identityFromSeed(new Uint8Array(32).fill(12)).account;
  const args = {
    owner: payer,
    payer,
    id: new Uint8Array(32),
    digest: new Uint8Array(32),
    size: 1,
    chunk_hashes: [new Uint8Array(32)],
    title: "Song",
    mime: "audio/mpeg",
    duration_ms: 210000,
    config_revision: 1,
    max_fee: "100000000",
  };
  const bundle = await musicPaymentOperations(client, args, native);
  expect(validMusicPaymentBundle(client.contracts, bundle, payer, native)).toBe(true);
  expect(validMusicPaymentBundle(client.contracts, bundle.slice(0, 2), payer, native)).toBe(false);
  expect(validMusicPaymentBundle(client.contracts, bundle, native, native)).toBe(false);
  expect(validMusicPaymentBundle(client.contracts, bundle, payer, payer)).toBe(false);
  for (const changes of [{ owner: native }, { spender: native }, { value: "200000000" }]) {
    const modified = structuredClone(bundle);
    modified[0]!.call_contract!.args = toBase64url(
      encode("publications.music_native_approval", {
        owner: payer,
        spender: client.deployment.contracts.publications.address,
        value: "100000000",
        ...changes,
      })
    );
    expect(validMusicPaymentBundle(client.contracts, modified, payer, native)).toBe(false);
  }
  const noCleanup = structuredClone(bundle);
  noCleanup[2] = noCleanup[0]!;
  expect(validMusicPaymentBundle(client.contracts, noCleanup, payer, native)).toBe(false);
});

it("weights batch RC limits by committed chunks without raising ordinary action limits", async () => {
  const { ProtocolClient, musicOperationUnits } = await import("./index.js");
  const { fakeProvider, fixtureDeployment } = await import("./testing/fixtures.js");
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() });
  const owner = fixtureDeployment().contracts.identity.address,
    id = new Uint8Array(32),
    data = new Uint8Array(16384);
  const op = await client.ops.publications.append_music_batch({
    owner,
    id,
    index: 0,
    chunks: [data, data, data, data],
  });
  expect(musicOperationUnits(client.contracts, [op])).toBe(4);
  const full = await client.ops.publications.append_music_batch({ owner, id, index: 0, chunks: Array.from({ length: 16 }, () => data) });
  expect(musicOperationUnits(client.contracts, [full])).toBe(16);
  expect(
    musicOperationUnits(client.contracts, [
      await client.ops.publications.append_music({ owner, id, index: 0, data }),
    ])
  ).toBe(1);
  expect(
    musicOperationUnits(client.contracts, [
      await client.ops.publications.append_music_batch({
        owner,
        id,
        index: 0,
        chunks: Array.from({ length: 17 }, () => data),
      }),
    ])
  ).toBe(1);
});
