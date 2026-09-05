import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { LIMITS } from "../constants.js";
import { deriveEncryptionKeyPair, deriveEncryptionSecret, encryptionPublicKey } from "./keys.js";
import {
  AudienceError,
  buildKeyPackageSet,
  buildKeyPackageSets,
  findSealedKeyFor,
  findSealedKeysFor,
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

  it("picks the sealed key for the recipient's key version after a rotation", () => {
    const epochKey = newEpochKey(rng);
    const seed = rng(32);
    const v1 = deriveEncryptionKeyPair(seed, 1);
    const v2 = deriveEncryptionKeyPair(seed, 2);
    const carol = Signer.fromSeed("carol").getAddress();
    // the author seals to both of carol's key versions in one set (old and rotated key)
    const { bytes } = buildKeyPackageSet({
      epochKey,
      author,
      epoch: 7,
      recipients: [
        { address: carol, publicKey: v1.publicKey, keyVersion: 1 },
        { address: alice.address, publicKey: alice.publicKey, keyVersion: 1 },
        { address: carol, publicKey: v2.publicKey, keyVersion: 2 },
      ],
      rng,
    });
    const set = parseKeyPackageSet(bytes);
    expect(findSealedKeysFor(set, carol).map((k) => k.recipient_key_version)).toEqual([1, 2]);
    expect(findSealedKeysFor(set, carol, 2).map((k) => k.recipient_key_version)).toEqual([2]);
    expect(findSealedKeyFor(set, carol)?.recipient_key_version).toBe(1);
    expect(findSealedKeyFor(set, carol, 2)?.recipient_key_version).toBe(2);
    expect(findSealedKeyFor(set, carol, 3)).toBeUndefined();
    // a client holding only the rotated secret recovers the key, with or without naming the version
    expect(openEpochKeyFromSet(set, carol, v2.secretKey, 2)).toEqual(epochKey);
    expect(openEpochKeyFromSet(set, carol, v2.secretKey)).toEqual(epochKey);
    expect(openEpochKeyFromSet(set, carol, v1.secretKey, 1)).toEqual(epochKey);
    // a version hint that does not match still falls back to the other entries
    expect(openEpochKeyFromSet(set, carol, v1.secretKey, 2)).toEqual(epochKey);
    // not addressed at all -> undefined; addressed but no entry opens -> AudienceError
    expect(openEpochKeyFromSet(set, bob.address, bob.secretKey)).toBeUndefined();
    expect(() => openEpochKeyFromSet(set, carol, bob.secretKey)).toThrow(AudienceError);
  });
});
