import { describe, expect, it } from "vitest";
import {
  deviceKeyPair,
  exportIdentity,
  identityFromSeed,
  importIdentity,
  lockVault,
  newIdentitySeed,
  signerFromSeed,
  unlockVault,
  validateVaultKdf,
  VAULT_KDF_LIMITS,
  VaultError,
} from "./vault.js";
import { deterministicRng } from "./testing/fixtures.js";

const rng = deterministicRng("vault");
const fastKdf = { N: 2 ** 10, r: 8, p: 1 };

describe("vault", () => {
  it("locks and unlocks with the right passphrase", async () => {
    const seed = newIdentitySeed(rng);
    const identity = identityFromSeed(seed, 1);
    const device = deviceKeyPair(rng);
    const blob = await lockVault(
      { seed, keyVersion: 1, account: identity.account, deviceSecret: device.secret, deviceAddress: device.address, meta: { label: "laptop" } },
      "correct horse",
      { rng, kdf: fastKdf },
    );
    expect(blob.version).toBe(1);
    expect(blob.kdf.N).toBe(1024);
    const secrets = await unlockVault(blob, "correct horse");
    expect(secrets.seed).toEqual(seed);
    expect(secrets.account).toBe(identity.account);
    expect(secrets.deviceSecret).toEqual(device.secret);
    expect(secrets.deviceAddress).toBe(device.address);
    expect(secrets.meta).toEqual({ label: "laptop" });
    expect(signerFromSeed(secrets.seed).getAddress()).toBe(identity.account);
  });

  it("rejects a wrong passphrase and tampered blobs", async () => {
    const seed = newIdentitySeed(rng);
    const blob = await lockVault({ seed, keyVersion: 1, account: identityFromSeed(seed).account }, "pw", { rng, kdf: fastKdf });
    await expect(unlockVault(blob, "wrong")).rejects.toThrow(VaultError);
    await expect(unlockVault({ ...blob, salt: blob.salt.replace(/^./, (c) => (c === "A" ? "B" : "A")) }, "pw")).rejects.toThrow(VaultError);
    await expect(unlockVault({ ...blob, kdf: { ...blob.kdf, N: 2048 } }, "pw")).rejects.toThrow(VaultError);
  });

  it("exports and imports identities", () => {
    const seed = newIdentitySeed(rng);
    const identity = identityFromSeed(seed, 2);
    const json = exportIdentity({ seed, keyVersion: 2, account: identity.account });
    const imported = importIdentity(json);
    expect(imported.seed).toEqual(seed);
    expect(imported.keyVersion).toBe(2);
    expect(imported.account).toBe(identity.account);
    expect(() => importIdentity(JSON.parse(json.replace(identity.account, identityFromSeed(newIdentitySeed(rng)).account)))).toThrow(VaultError);
    expect(identity.encryption.publicKey.length).toBe(32);
  });

  it("bounds the KDF parameters a blob claims before running scrypt", async () => {
    const seed = newIdentitySeed(rng);
    const blob = await lockVault({ seed, keyVersion: 1, account: identityFromSeed(seed).account }, "pw", { rng, kdf: fastKdf });
    const hostile = async (kdf: Partial<typeof blob.kdf>) => {
      const started = Date.now();
      await expect(unlockVault({ ...blob, kdf: { ...blob.kdf, ...kdf } }, "pw")).rejects.toThrow(/unsupported kdf/);
      expect(Date.now() - started).toBeLessThan(200);
    };
    await hostile({ N: 2 ** 26 });
    await hostile({ N: 2 ** 21 });
    await hostile({ N: 2 ** 9 });
    await hostile({ N: 3000 }); // not a power of two
    await hostile({ r: 0 });
    await hostile({ r: 33 });
    await hostile({ p: 0 });
    await hostile({ p: 17 });
    await hostile({ dkLen: 64 });
    await hostile({ N: 2 ** 20, r: 32 }); // 4 GiB of scrypt memory
    await hostile({ name: "argon2" as "scrypt" });
    // malformed salt / nonce / ciphertext are VaultErrors, not opaque library errors
    await expect(unlockVault({ ...blob, salt: "AQ==" }, "pw")).rejects.toThrow(/salt/);
    await expect(unlockVault({ ...blob, nonce: "AQ==" }, "pw")).rejects.toThrow(/nonce/);
    await expect(unlockVault({ ...blob, ciphertext: 5 as unknown as string }, "pw")).rejects.toThrow(/ciphertext/);
    await expect(unlockVault({ ...blob, salt: "***" }, "pw")).rejects.toThrow(VaultError);
    // the same bounds apply when locking
    await expect(lockVault({ seed, keyVersion: 1, account: "x" }, "pw", { rng, kdf: { N: 2 ** 26 } })).rejects.toThrow(/unsupported kdf/);
    await expect(lockVault({ seed, keyVersion: 1, account: "x" }, "pw", { rng, kdf: fastKdf, salt: new Uint8Array(4) })).rejects.toThrow(/salt/);
    await expect(lockVault({ seed, keyVersion: 1, account: "x" }, "pw", { rng, kdf: fastKdf, nonce: new Uint8Array(12) })).rejects.toThrow(/nonce/);
    expect(() => validateVaultKdf({ name: "scrypt", N: VAULT_KDF_LIMITS.maxN, r: 8, p: 1, dkLen: 32 })).not.toThrow();
    expect(() => validateVaultKdf({ name: "scrypt", N: VAULT_KDF_LIMITS.minN, r: 1, p: 1, dkLen: 32 })).not.toThrow();
  });
});
