import { describe, expect, it } from "vitest";
import { deviceKeyPair, exportIdentity, identityFromSeed, importIdentity, lockVault, newIdentitySeed, signerFromSeed, unlockVault, VaultError } from "./vault.js";
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
});
