import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { AUDIENCE, OUTCOME } from "./constants.js";
import { buildProofManifest, decodeProofManifest, encodeProofManifest, manifestHash, manifestSigningHash, signProofManifest, verifyProofManifest } from "./manifest.js";

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
});
