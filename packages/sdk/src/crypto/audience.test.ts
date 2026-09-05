import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { LIMITS } from "../constants.js";
import { deriveEncryptionKeyPair, deriveEncryptionSecret, encryptionPublicKey } from "./keys.js";
import {
  AudienceError,
  buildKeyPackageSet,
  buildKeyPackageSets,
  findSealedKeyFor,
  newEpochKey,
  openEpochKey,
  openEpochKeyFromSet,
  parseKeyPackageSet,
  sealEpochKey,
} from "./audience.js";
import { deterministicRng } from "../testing/fixtures.js";

const author = Signer.fromSeed("author").getAddress();
const rng = deterministicRng("audience");
const alice = { address: Signer.fromSeed("alice").getAddress(), ...deriveEncryptionKeyPair(rng(32), 1) };
const bob = { address: Signer.fromSeed("bob").getAddress(), ...deriveEncryptionKeyPair(rng(32), 2) };

describe("audience keys", () => {
  it("derives encryption keys deterministically from the seed and key version", () => {
    const seed = new Uint8Array(32).fill(1);
    const v1 = deriveEncryptionSecret(seed, 1);
    expect(v1.length).toBe(32);
    expect(deriveEncryptionSecret(seed, 1)).toEqual(v1);
    expect(deriveEncryptionSecret(seed, 2)).not.toEqual(v1);
    expect(encryptionPublicKey(v1).length).toBe(32);
  });

  it("seal/open round trip and wrong recipient fails", () => {
    const epochKey = newEpochKey(rng);
    const sealed = sealEpochKey({
      epochKey,
      recipient: alice.address,
      recipientPublicKey: alice.publicKey,
      recipientKeyVersion: 1,
      author,
      epoch: 2,
      rng,
    });
    expect(sealed.recipient.length).toBe(25);
    expect(sealed.ciphertext.length).toBe(32 + 16);
    expect(openEpochKey({ sealed, recipientSecretKey: alice.secretKey, author, epoch: 2 })).toEqual(epochKey);
    expect(() => openEpochKey({ sealed, recipientSecretKey: bob.secretKey, author, epoch: 2 })).toThrow(AudienceError);
    expect(() => openEpochKey({ sealed, recipientSecretKey: alice.secretKey, author, epoch: 3 })).toThrow(AudienceError);
    expect(() => openEpochKey({ sealed, recipientSecretKey: alice.secretKey, author: bob.address, epoch: 2 })).toThrow(AudienceError);
  });

  it("builds and parses key package sets", () => {
    const epochKey = newEpochKey(rng);
    const audienceId = new Uint8Array(16).fill(9);
    const { set, bytes } = buildKeyPackageSet({
      epochKey,
      author,
      audienceId,
      epoch: 5,
      recipients: [alice, bob].map((r) => ({ address: r.address, publicKey: r.publicKey, keyVersion: r.keyVersion })),
      rng,
    });
    expect(bytes.length).toBeLessThan(LIMITS.maxKeyPackageBytes);
    const parsed = parseKeyPackageSet(bytes);
    expect(parsed.epoch).toBe(5);
    expect(parsed.audience_id).toEqual(audienceId);
    expect(parsed.keys.length).toBe(2);
    expect(findSealedKeyFor(parsed, bob.address)?.recipient_key_version).toBe(2);
    expect(findSealedKeyFor(parsed, author)).toBeUndefined();
    expect(openEpochKeyFromSet(parsed, alice.address, alice.secretKey)).toEqual(epochKey);
    expect(openEpochKeyFromSet(parsed, bob.address, bob.secretKey)).toEqual(epochKey);
    expect(openEpochKeyFromSet(parsed, author, alice.secretKey)).toBeUndefined();
    expect(set.keys[0]?.recipient).toEqual(parsed.keys[0]?.recipient);
  });

  it("splits large audiences into multiple sets", () => {
    const epochKey = newEpochKey(rng);
    const recipients = Array.from({ length: 30 }, (_, i) => {
      const pair = deriveEncryptionKeyPair(rng(32), 1);
      return { address: Signer.fromSeed(`member-${i}`).getAddress(), publicKey: pair.publicKey, keyVersion: 1 };
    });
    const sets = buildKeyPackageSets({ epochKey, author, epoch: 1, recipients, rng }, 1500);
    expect(sets.length).toBeGreaterThan(1);
    expect(sets.every((s) => s.bytes.length <= 1500)).toBe(true);
    expect(sets.reduce((n, s) => n + s.set.keys.length, 0)).toBe(30);
    expect(() => buildKeyPackageSet({ epochKey, author, epoch: 1, recipients: [] })).toThrow(/no recipients/);
  });
});
