import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { AUDIENCE, OUTCOME } from "./constants.js";
import {
  buildProofManifest,
  decodeProofManifest,
  encodeProofManifest,
  ManifestError,
  manifestHash,
  manifestSigningHash,
  signProofManifest,
  validateProofManifest,
  verifyProofManifest,
  type ProofManifestInput,
} from "./manifest.js";

const signer = Signer.fromSeed("author");
const input = {
  author: signer.getAddress(),
  post_id: new Uint8Array(32).fill(1),
  content_hash: new Uint8Array(32).fill(2),
  version_number: 1,
  transaction_id: "0x1220" + "ab".repeat(32),
  block_height: 12345,
  audience: AUDIENCE.EVERYONE,
  adapter: "facebook",
  external_ref: "https://facebook.com/post/1",
  outcome: OUTCOME.SUCCEEDED,
  idempotency_key: new Uint8Array(16).fill(3),
  created_at: 1700000000000,
};

describe("proof manifest", () => {
  it("signs, verifies and hashes", async () => {
    const manifest = buildProofManifest(input);
    expect(manifest.signature.length).toBe(0);
    const signed = await signProofManifest(manifest, signer);
    expect(signed.signature.length).toBe(65);
    expect(verifyProofManifest(signed)).toEqual({ valid: true, signer: signer.getAddress() });
    expect(verifyProofManifest(signed, [signer.getAddress()]).valid).toBe(true);
    expect(verifyProofManifest(signed, [Signer.fromSeed("other").getAddress()]).valid).toBe(false);
    expect(verifyProofManifest(manifest).valid).toBe(false);
    const hash = manifestHash(signed);
    expect(hash.length).toBe(32);
    expect(manifestHash(encodeProofManifest(signed))).toEqual(hash);
    expect(hash).not.toEqual(manifestHash(manifest));
    expect(decodeProofManifest(encodeProofManifest(signed))).toEqual(signed);
    expect(manifestSigningHash(signed)).toEqual(manifestSigningHash(manifest));
  });

  it("detects tampering", async () => {
    const signed = await signProofManifest(buildProofManifest(input), signer);
    expect(verifyProofManifest({ ...signed, external_ref: "https://facebook.com/post/2" }).valid).toBe(false);
    expect(verifyProofManifest({ ...signed, block_height: "12346" }).valid).toBe(false);
    expect(verifyProofManifest({ ...signed, signer: Signer.fromSeed("other").getAddress() === "" ? signed.signer : new Uint8Array(25) }).valid).toBe(false);
    const flipped = new Uint8Array(signed.signature);
    flipped[10] = (flipped[10] as number) ^ 0xff;
    expect(verifyProofManifest({ ...signed, signature: flipped }).valid).toBe(false);
  });

  it("rejects malformed ids when building, signing and verifying", async () => {
    const malformed: Array<[string, Partial<ProofManifestInput>, RegExp]> = [
      ["short post_id", { post_id: new Uint8Array(3) }, /post_id/],
      ["short content_hash", { content_hash: new Uint8Array(1) }, /content_hash/],
      ["short idempotency_key", { idempotency_key: new Uint8Array(2) }, /idempotency_key/],
      ["empty transaction_id on a succeeded outcome", { transaction_id: "" }, /transaction_id is required/],
      ["transaction_id without the sha256 multihash prefix", { transaction_id: "0x1100" + "ab".repeat(32) }, /multihash/],
      ["33-byte transaction_id", { transaction_id: "0x1220" + "ab".repeat(31) }, /multihash/],
      ["version_number 0", { version_number: 0 }, /version_number/],
      ["odd audience_id", { audience_id: new Uint8Array(5) }, /audience_id/],
    ];
    for (const [label, override, pattern] of malformed) {
      expect(() => buildProofManifest({ ...input, ...override }), label).toThrow(ManifestError);
      expect(() => buildProofManifest({ ...input, ...override }), label).toThrow(pattern);
    }
    // an empty transaction id is fine when the outcome is not succeeded
    const failed = buildProofManifest({ ...input, transaction_id: "", outcome: OUTCOME.FAILED });
    expect(failed.transaction_id.length).toBe(0);
    expect(validateProofManifest(failed)).toBeUndefined();
    expect(validateProofManifest(buildProofManifest({ ...input, audience_id: new Uint8Array(16).fill(4) }))).toBeUndefined();

    // a well-formed manifest whose fields are then corrupted cannot be signed, and verification says why
    const signed = await signProofManifest(buildProofManifest(input), signer);
    const corrupted = { ...signed, post_id: new Uint8Array(3) };
    await expect(signProofManifest(corrupted, signer)).rejects.toThrow(ManifestError);
    expect(verifyProofManifest(corrupted)).toEqual({ valid: false, reason: "malformed: post_id must be 32 bytes" });
    expect(verifyProofManifest({ ...signed, transaction_id: new Uint8Array(0) }).reason).toMatch(/^malformed: transaction_id/);
    expect(verifyProofManifest({ ...signed, idempotency_key: new Uint8Array(2) }).reason).toMatch(/^malformed: idempotency_key/);
    expect(verifyProofManifest({ ...signed, version_number: 0 }).reason).toMatch(/^malformed: version_number/);
    expect(verifyProofManifest(signed).valid).toBe(true);
  });
});
