import { describe, expect, it, vi } from "vitest";
import { createVaultStore, startAutoLock, UPLOAD_KEEPALIVE_MS, VAULT_KEY, type VaultRecord } from "./store";
import { memoryStorage } from "./storage";
import { unsupportedPasskey } from "./passkey";
import { REMEMBER_MS, REMEMBER_POINTER, rememberedKey, type RememberPointer, type RememberedRecord } from "./rememberDevice";

const password = "correct horse battery";
function setup(autoLockMs = 60_000) {
  const storage = memoryStorage();
  let id: string | undefined, time = 1_000_000;
  const pointer: RememberPointer = { get: () => id, set: (v) => { id = v; }, clear: () => { id = undefined; } };
  const make = () => createVaultStore({ storage, kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey, now: () => time, autoLockMs, rememberPointer: pointer });
  return { storage, pointer, make, advance: (ms: number) => { time += ms; }, now: () => time };
}

describe("30-day remembered sign-in", () => {
  it("is opt-in, restores after a reload, and keeps the seed encrypted under a non-exportable key", async () => {
    const h = setup(), first = h.make();
    await first.getState().create(password);
    expect(h.pointer.get()).toBeUndefined();
    const session = first.getState().session!;
    await first.getState().rememberDevice();
    const stored = await h.storage.get<RememberedRecord>(rememberedKey(h.pointer.get()!));
    expect(stored?.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", stored!.key)).rejects.toThrow();
    const json = JSON.stringify([...h.storage.map]);
    expect(json).not.toContain(Buffer.from(session.identity.seed).toString("hex"));
    expect(json).not.toContain(password);
    h.advance(20 * 24 * 60 * 60_000);
    const second = h.make();
    await second.getState().init();
    expect(second.getState().status).toBe("unlocked");
    expect(second.getState().session?.identity.seed).toEqual(session.identity.seed);
    expect(second.getState().rememberedUntil).toBe(first.getState().rememberedUntil);
    expect(second.getState().checkAutoLock()).toBe(false);
  });

  it("supports the remember checkbox during unlock and does not remember a wrong password", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    v.getState().lock();
    await expect(v.getState().unlock("incorrect", true)).rejects.toThrow();
    expect(h.pointer.get()).toBeUndefined();
    await v.getState().unlock(password, true);
    expect(v.getState().rememberedUntil).toBe(h.now() + REMEMBER_MS);
    const reopened = h.make();
    await reopened.getState().init();
    expect(reopened.getState().status).toBe("unlocked");
  });

  it("expires at a fixed 30 days, even with auto-lock 0 and an upload in progress", async () => {
    const h = setup(0), v = h.make();
    await v.getState().create(password);
    await v.getState().rememberDevice();
    h.advance(REMEMBER_MS - 1);
    v.getState().touch();
    v.getState().keepUnlocked();
    expect(v.getState().checkAutoLock()).toBe(false);
    h.advance(1);
    expect(v.getState().checkAutoLock()).toBe(true);
    expect(h.pointer.get()).toBeUndefined();
    const reopened = h.make();
    await reopened.getState().init();
    expect(reopened.getState().status).toBe("locked");
  });

  it("refuses an expired remembered record on startup", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    await v.getState().rememberDevice();
    h.advance(REMEMBER_MS);
    const reopened = h.make();
    await reopened.getState().init();
    expect(reopened.getState().status).toBe("locked");
    expect(h.pointer.get()).toBeUndefined();
  });

  it("Lock now revokes remembered sign-in immediately, including other tabs", async () => {
    const h = setup(), first = h.make();
    await first.getState().create(password);
    await first.getState().rememberDevice();
    const second = h.make();
    await second.getState().init();
    const stop = startAutoLock(second);
    try {
      second.getState().keepUnlocked();
      first.getState().lock();
      expect(h.pointer.get()).toBeUndefined();
      window.dispatchEvent(new StorageEvent("storage", { key: REMEMBER_POINTER, newValue: null }));
      expect(second.getState().status).toBe("locked");
      const reopened = h.make();
      await reopened.getState().init();
      expect(reopened.getState().status).toBe("locked");
    } finally { stop(); }
  });

  it("does not let a stale tab revoke a newly enabled remembered session", async () => {
    const h = setup(), first = h.make();
    await first.getState().create(password);
    await first.getState().rememberDevice();
    const second = h.make();
    await second.getState().init();
    await first.getState().rememberDevice();
    const current = h.pointer.get();
    expect(second.getState().checkAutoLock()).toBe(true);
    expect(h.pointer.get()).toBe(current);
    expect(first.getState().checkAutoLock()).toBe(false);
  });

  it("turning off remember restores normal idle locking without destroying the vault", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    await v.getState().rememberDevice();
    h.advance(2 * 60_000);
    v.getState().forgetRememberedDevice();
    expect(v.getState().status).toBe("unlocked");
    expect(v.getState().checkAutoLock()).toBe(false);
    h.advance(60_000);
    expect(v.getState().checkAutoLock()).toBe(true);
    await v.getState().unlock(password);
    expect(v.getState().status).toBe("unlocked");
  });

  it.each(["corrupt", "account", "vault"])("fails closed for %s stored data", async (kind) => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    await v.getState().rememberDevice();
    if (kind === "corrupt") {
      const key = rememberedKey(h.pointer.get()!);
      const record = (await h.storage.get<RememberedRecord>(key))!;
      record.encrypted.ciphertext = "AAAA";
      await h.storage.set(key, record);
    } else {
      const record = (await h.storage.get<VaultRecord>(VAULT_KEY))!;
      if (kind === "account") record.account = "different account";
      else record.blob = { ...record.blob, changed: true } as typeof record.blob;
      await h.storage.set(VAULT_KEY, record);
    }
    const reopened = h.make();
    await reopened.getState().init();
    expect(reopened.getState().status).toBe("locked");
    expect(h.pointer.get()).toBeUndefined();
  });

  it("password changes and account removal revoke the remembered identity", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    await v.getState().rememberDevice();
    await v.getState().changePassphrase(password, "a new passphrase");
    expect(h.pointer.get()).toBeUndefined();
    const reopened = h.make();
    await reopened.getState().init();
    expect(reopened.getState().status).toBe("locked");
    await reopened.getState().unlock("a new passphrase", true);
    await reopened.getState().destroy();
    expect(h.pointer.get()).toBeUndefined();
    expect(h.storage.map.size).toBe(0);
  });

  it("an in-flight remember operation cannot restore access after Lock now", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    const pending = v.getState().rememberDevice();
    const rejection = expect(pending).rejects.toThrow(/cancelled/);
    v.getState().lock();
    await rejection;
    expect(h.pointer.get()).toBeUndefined();
    expect(v.getState().status).toBe("locked");
    expect([...h.storage.map.keys()].filter((key) => key.startsWith(REMEMBER_POINTER))).toEqual([]);
  });

  it("an in-flight unlock cannot reopen an explicitly locked vault", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    v.getState().lock();
    const pending = v.getState().unlock(password, true);
    const rejection = expect(pending).rejects.toThrow(/cancelled/);
    v.getState().lock();
    await rejection;
    expect(h.pointer.get()).toBeUndefined();
    expect(v.getState().status).toBe("locked");
  });

  it("does not enter a remembered session when browser persistence fails", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    v.getState().lock();
    vi.spyOn(h.pointer, "set").mockImplementation(() => { throw new Error("Storage blocked"); });
    await expect(v.getState().unlock(password, true)).rejects.toThrow("Storage blocked");
    expect(v.getState().status).toBe("locked");
    expect(h.pointer.get()).toBeUndefined();
    await v.getState().unlock(password);
    expect(v.getState().status).toBe("unlocked");
  });
});

describe("upload inactivity protection", () => {
  it("keeps a progressing upload unlocked, then restores the ordinary timeout", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    const lease = v.getState().keepUnlocked();
    for (let i = 0; i < 40; i++) {
      h.advance(60_000);
      expect(v.getState().checkAutoLock()).toBe(false);
      lease.renew();
    }
    lease.release();
    expect(v.getState().checkAutoLock()).toBe(false);
    h.advance(60_000);
    expect(v.getState().checkAutoLock()).toBe(true);
  });

  it("a stalled upload does not keep the vault unlocked forever", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    v.getState().keepUnlocked();
    h.advance(UPLOAD_KEEPALIVE_MS);
    expect(v.getState().checkAutoLock()).toBe(true);
  });

  it("manual lock overrides protection and stale leases cannot affect the next session", async () => {
    const h = setup(), v = h.make();
    await v.getState().create(password);
    const lease = v.getState().keepUnlocked();
    v.getState().lock();
    await v.getState().unlock(password);
    h.advance(60_000);
    lease.renew();
    lease.release();
    expect(v.getState().checkAutoLock()).toBe(true);
  });

  it("0 prevents inactivity locking across days and visibility changes", async () => {
    const h = setup(0), v = h.make();
    await v.getState().create(password);
    const stop = startAutoLock(v);
    try {
      h.advance(40 * 24 * 60 * 60_000);
      expect(v.getState().checkAutoLock()).toBe(false);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      expect(v.getState().status).toBe("unlocked");
      // The existing distinction: disabling inactivity cannot persist a session.
      const reopened = h.make();
      await reopened.getState().init();
      expect(reopened.getState().status).toBe("locked");
    } finally { stop(); }
  });
});
