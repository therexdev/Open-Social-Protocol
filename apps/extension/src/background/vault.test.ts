import { describe, expect, it } from "vitest";
import { fromHex, identityFromSeed, unlockVault, deriveEncryptionSecret, toHex, exportIdentity } from "@osp/sdk";
import { memoryArea } from "../shared/storage";
import { DEVICE_CAPABILITIES, SESSION_KEY, VAULT_KEY, VaultManager, type VaultRecord } from "./vault";
import { TEST_KDF } from "../test/support";

const PASS = "correct horse battery";

function manager() {
  const local = memoryArea();
  const session = memoryArea();
  return { local, session, vault: new VaultManager({ local, session, kdf: TEST_KDF }) };
}

const device = (address: string) => ({ address, capabilities: DEVICE_CAPABILITIES, expiresAt: "9999999999999", authorizedAt: 1, label: "test" });

describe("vault device-key policy", () => {
  it("starts in owner mode with a device key and keeps secrets only in memory/session storage", async () => {
    const { vault, local, session } = manager();
    const s = await vault.create(PASS);
    expect(s.mode).toBe("owner");
    expect(s.ownerSeed).toBeDefined();
    expect(s.deviceAddress).not.toBe(s.account);
    const record = (await local.get<VaultRecord>(VAULT_KEY))!;
    expect(record.mode).toBe("owner");
    expect(JSON.stringify(record)).not.toContain(s.ownerSeed);
    expect(JSON.stringify(record)).not.toContain(s.deviceSecret);
    expect(await session.get(SESSION_KEY)).toMatchObject({ account: s.account });
    await vault.lock();
    expect(await session.get(SESSION_KEY)).toBeUndefined();
    expect((await vault.status()).status).toBe("locked");
  });

  it("discards the owner seed after device authorization unless the user opts in", async () => {
    const { vault, local } = manager();
    const s = await vault.create(PASS);
    const next = await vault.completeDeviceAuthorization({ passphrase: PASS, keepOwnerSeed: false, device: device(s.deviceAddress) });
    expect(next.mode).toBe("device");
    expect(next.ownerSeed).toBeUndefined();
    const record = (await local.get<VaultRecord>(VAULT_KEY))!;
    expect(record.mode).toBe("device");
    expect(record.device?.address).toBe(s.deviceAddress);
    const secrets = await unlockVault(record.blob, PASS);
    expect(toHex(secrets.seed)).not.toBe(s.ownerSeed);
    expect(toHex(secrets.seed)).toBe(toHex(deriveEncryptionSecret(fromHex(s.ownerSeed!), 1)));
    expect(secrets.meta).toMatchObject({ mode: "device", seedSlot: "encryption-secret" });
    expect(secrets.deviceAddress).toBe(s.deviceAddress);
    // relocking/unlocking keeps working without the seed, and export is refused
    await vault.lock();
    const again = await vault.unlock(PASS);
    expect(again.mode).toBe("device");
    expect(again.encryptionPublicKey).toBe(s.encryptionPublicKey);
    expect(vault.signers(again).owner).toBeUndefined();
    expect(vault.signers(again).device.getAddress()).toBe(s.deviceAddress);
    await expect(vault.export(PASS)).rejects.toThrow(/device key/);
  });

  it("keeps the owner seed when the user opts in", async () => {
    const { vault, local } = manager();
    const s = await vault.create(PASS);
    const next = await vault.completeDeviceAuthorization({ passphrase: PASS, keepOwnerSeed: true, device: device(s.deviceAddress) });
    expect(next.mode).toBe("owner");
    expect(next.ownerSeed).toBe(s.ownerSeed);
    const record = (await local.get<VaultRecord>(VAULT_KEY))!;
    expect(record.mode).toBe("owner");
    expect(toHex((await unlockVault(record.blob, PASS)).seed)).toBe(s.ownerSeed);
    expect(JSON.parse(await vault.export(PASS))).toMatchObject({ version: 1, account: s.account });
  });

  it("imports the web client's identity file and rejects a wrong passphrase", async () => {
    const { vault } = manager();
    const identity = identityFromSeed(fromHex("11".repeat(32)));
    const file = exportIdentity({ seed: identity.seed, keyVersion: 1, account: identity.account });
    const s = await vault.import(file, PASS);
    expect(s.account).toBe(identity.account);
    await vault.lock();
    await expect(vault.unlock("wrong passphrase")).rejects.toThrow(/passphrase/);
    await expect(vault.completeDeviceAuthorization({ passphrase: "wrong passphrase", keepOwnerSeed: false, device: device(s.deviceAddress) })).rejects.toThrow();
    expect(((await vault.record())!).mode).toBe("owner");
  });

  it("auto-locks after inactivity", async () => {
    const local = memoryArea();
    const session = memoryArea();
    let t = 1_000_000;
    const vault = new VaultManager({ local, session, kdf: TEST_KDF, now: () => t });
    await vault.create(PASS);
    expect(await vault.checkAutoLock(60_000)).toBe(false);
    t += 59_000;
    await vault.touch();
    t += 59_000;
    expect(await vault.checkAutoLock(60_000)).toBe(false);
    t += 60_000;
    expect(await vault.checkAutoLock(60_000)).toBe(true);
    expect((await vault.status()).status).toBe("locked");
  });
});
