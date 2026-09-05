import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Signer, utils } from "koilib";
import { addressToBytes, chainIdToBytes, contentHash, customAudienceId, idempotencyKey, isAddress, newAttemptId, postId } from "./ids.js";
import { toHex } from "./encoding.js";
import { deterministicRng, HARBINGER_CHAIN_ID } from "./testing/fixtures.js";

const sha256 = (...parts: Uint8Array[]) => new Uint8Array(createHash("sha256").update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest());

describe("ids", () => {
  const author = Signer.fromSeed("author").getAddress();
  const envelope = new TextEncoder().encode("envelope bytes");

  it("computes post ids exactly as spec 2.1", () => {
    const ch = contentHash(envelope);
    expect(ch).toEqual(sha256(envelope));
    const seq = Buffer.alloc(8);
    seq.writeBigUInt64BE(7n);
    const pv = Buffer.alloc(4);
    pv.writeUInt32BE(1);
    const expected = sha256(
      Buffer.from("osp/v1/post-id", "ascii"),
      Buffer.from(utils.decodeBase64url(HARBINGER_CHAIN_ID)),
      pv,
      Buffer.from(utils.decodeBase58(author)),
      seq,
      Buffer.from(ch),
    );
    const id = postId({ chainId: HARBINGER_CHAIN_ID, author, sequence: 7, contentHash: ch });
    expect(id).toEqual(expected);
    expect(postId({ chainId: chainIdToBytes(HARBINGER_CHAIN_ID), author: addressToBytes(author), sequence: "7", contentHash: ch })).toEqual(expected);
    expect(postId({ chainId: HARBINGER_CHAIN_ID, author, sequence: 8, contentHash: ch })).not.toEqual(expected);
  });

  it("derives idempotency keys (16 bytes) per spec 2.2", () => {
    const attempt = newAttemptId(deterministicRng("attempt"));
    expect(attempt.length).toBe(16);
    const key = idempotencyKey(author, attempt);
    const expected = sha256(Buffer.from("osp/v1/idem", "ascii"), Buffer.from(utils.decodeBase58(author)), Buffer.from(attempt)).slice(0, 16);
    expect(key).toEqual(expected);
    expect(() => idempotencyKey(author, new Uint8Array(15))).toThrow();
  });

  it("derives custom audience ids per spec 2.3", () => {
    const id = customAudienceId(author, "close friends");
    const expected = sha256(Buffer.from("osp/v1/audience", "ascii"), Buffer.from(utils.decodeBase58(author)), Buffer.from("close friends", "utf8")).slice(0, 16);
    expect(id).toEqual(expected);
    expect(toHex(customAudienceId(author, "other"))).not.toBe(toHex(id));
  });

  it("validates addresses and chain ids", () => {
    expect(isAddress(author)).toBe(true);
    expect(isAddress("not-an-address")).toBe(false);
    expect(addressToBytes(author).length).toBe(25);
    expect(() => addressToBytes(new Uint8Array(24))).toThrow();
    expect(chainIdToBytes(HARBINGER_CHAIN_ID)[0]).toBe(0x12);
    expect(chainIdToBytes(HARBINGER_CHAIN_ID).length).toBe(34);
  });
});
