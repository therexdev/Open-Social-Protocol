import { beforeEach, describe, expect, it } from "vitest";
import { importIdentity } from "@osp/sdk";
import { createVaultStore } from "./store";
import { memoryStorage } from "./storage";
import { unsupportedPasskey, type PasskeyAdapter } from "./passkey";

const kdf = { N: 1024, r: 8, p: 1 };

describe("vault store", () => {
  let storage = memoryStorage();
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("starts empty, creates an identity and keeps secrets only in memory", async () => {
    const vault = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    expect(vault.getState().status).toBe("empty");
    const identity = await vault.getState().create("correct horse battery");
    expect(vault.getState().status).toBe("unlocked");
    expect(vault.getState().account).toBe(identity.account);
    expect(vault.getState().session?.identity.account).toBe(identity.account);
    // persisted record holds an encrypted blob and the account, never the seed
    const persisted = JSON.stringify([...storage.map.entries()]);
    expect(persisted).toContain(identity.account);
    expect(persisted).not.toContain(Buffer.from(identity.seed).toString("hex"));
    expect(persisted).toContain("xchacha20poly1305");
  });

  it("locks, refuses a wrong passphrase and unlocks with the right one", async () => {
    const vault = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    const identity = await vault.getState().create("correct horse battery");
    vault.getState().lock();
    expect(vault.getState().status).toBe("locked");
    expect(vault.getState().session).toBeUndefined();
    expect(vault.getState().account).toBe(identity.account);
    await expect(vault.getState().unlock("wrong")).rejects.toThrow(/cannot unlock/);
    expect(vault.getState().status).toBe("locked");
    const again = await vault.getState().unlock("correct horse battery");
    expect(again.account).toBe(identity.account);
    expect(vault.getState().status).toBe("unlocked");
    expect(Buffer.from(again.seed)).toEqual(Buffer.from(identity.seed));
  });

  it("survives a reload as locked", async () => {
    const first = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await first.getState().init();
    const identity = await first.getState().create("correct horse battery");
    const second = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await second.getState().init();
    expect(second.getState().status).toBe("locked");
    expect(second.getState().account).toBe(identity.account);
  });

  it("auto-locks after inactivity and not before", async () => {
    let now = 1_000_000;
    const vault = createVaultStore({ storage, kdf, passkey: unsupportedPasskey, now: () => now, autoLockMs: 60_000 });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    now += 30_000;
    expect(vault.getState().checkAutoLock()).toBe(false);
    vault.getState().touch();
    now += 45_000;
    expect(vault.getState().checkAutoLock()).toBe(false); // touched 45 s ago
    now += 20_000;
    expect(vault.getState().checkAutoLock()).toBe(true);
    expect(vault.getState().status).toBe("locked");
    expect(vault.getState().session).toBeUndefined();
  });

  it("exports an identity file that imports back to the same account", async () => {
    const vault = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    const identity = await vault.getState().create("correct horse battery");
    const file = vault.getState().exportFile();
    expect(importIdentity(file).account).toBe(identity.account);
    const other = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await other.getState().init();
    const imported = await other.getState().importFromFile(file, "another passphrase");
    expect(imported.account).toBe(identity.account);
    expect(Buffer.from(imported.encryption.secretKey)).toEqual(Buffer.from(identity.encryption.secretKey));
  });

  it("unlocks with a passkey when one is enrolled", async () => {
    let stored: Uint8Array | undefined;
    const passkey: PasskeyAdapter = {
      supported: async () => true,
      enroll: async (_account, secret) => {
        stored = secret;
        return { credentialId: "cred", salt: "salt", iv: "iv", wrapped: "wrapped" };
      },
      open: async () => {
        if (!stored) throw new Error("not enrolled");
        return stored;
      },
    };
    const vault = createVaultStore({ storage, kdf, passkey });
    await vault.getState().init();
    const identity = await vault.getState().create("correct horse battery");
    await vault.getState().enrollPasskey("correct horse battery");
    expect(vault.getState().passkeyEnrolled).toBe(true);
    vault.getState().lock();
    const again = await vault.getState().unlockWithPasskey();
    expect(again.account).toBe(identity.account);
    expect(vault.getState().status).toBe("unlocked");
  });

  it("destroy forgets the account", async () => {
    const vault = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    await vault.getState().destroy();
    expect(vault.getState().status).toBe("empty");
    expect(storage.map.size).toBe(0);
  });
});
