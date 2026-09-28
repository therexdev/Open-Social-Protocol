import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "@osp/sdk";
import { memoryStorage } from "../../vault/storage";
import {
  decryptJson,
  deriveAesKey,
  type EncryptedRecord,
} from "../../vault/encryptedStore";
import { PrivateStore, type ExclusiveLock } from "./privateStore";
beforeAll(() =>
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  }),
);
const lock: ExclusiveLock = async (_name, action) => action();
const scope = { chainId: "test", contract: "messages" };
describe("private browser state", () => {
  it("persists encrypted state but a seed alone cannot open it", async () => {
    const storage = memoryStorage(),
      seed = randomBytes(32),
      store = new PrivateStore("alice", seed, scope, () => true, storage, lock);
    let key = "";
    await store.edit(async (data) => {
      key = data.pickleKey;
      data.inboxAfter = "42";
    });
    await store.edit(async (data) => {
      expect(data.pickleKey).toBe(key);
      expect(data.inboxAfter).toBe("42");
    });
    const raw = await storage.get<EncryptedRecord>(store.name);
    expect(JSON.stringify(raw)).not.toContain(key);
    const seedKey = await deriveAesKey(seed, store.name);
    await expect(decryptJson(seedKey, raw!)).rejects.toThrow();
    const device = await storage.get<CryptoKey>(`${store.name}:key`);
    expect(device!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", device!)).rejects.toThrow();
  });
  it("fails closed on missing keys, corrupted state, failed persistence, and lock", async () => {
    const storage = memoryStorage(),
      seed = randomBytes(32);
    let unlocked = true;
    const store = new PrivateStore(
      "alice",
      seed,
      scope,
      () => unlocked,
      storage,
      lock,
    );
    await store.edit(async () => {});
    const key = await storage.get<CryptoKey>(`${store.name}:key`);
    await storage.del(`${store.name}:key`);
    await expect(store.edit(async () => {})).rejects.toThrow("key is missing");
    await storage.set(`${store.name}:key`, key);
    unlocked = false;
    await expect(store.edit(async () => {})).rejects.toThrow("Unlock");
    unlocked = true;
    const set = storage.set;
    storage.set = async () => {
      throw new Error("quota full");
    };
    await expect(
      store.edit(async (data) => {
        data.inboxAfter = "123";
      }),
    ).rejects.toThrow("quota full");
    storage.set = set;
    await store.edit(async (data) => expect(data.inboxAfter).toBe("0"));
    const record = await storage.get<EncryptedRecord>(store.name);
    await storage.set(store.name, { ...record, ciphertext: "AAAA" });
    await expect(store.edit(async () => {})).rejects.toThrow();
  });
  it("does not regenerate the same messaging secrets after seed-only recovery on another browser", async () => {
    const seed = randomBytes(32),
      a = new PrivateStore(
        "alice",
        seed,
        scope,
        () => true,
        memoryStorage(),
        lock,
      ),
      b = new PrivateStore(
        "alice",
        seed,
        scope,
        () => true,
        memoryStorage(),
        lock,
      );
    const first = await a.edit(async (d) => d.pickleKey),
      second = await b.edit(async (d) => d.pickleKey);
    expect(first).not.toBe(second);
  });
});
