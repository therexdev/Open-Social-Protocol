import { describe, expect, it } from "vitest";
import { identityFromSeed, newIdentitySeed, toBase64url } from "@osp/sdk";

describe("environment", () => {
  it("has webcrypto, localStorage and the sdk", async () => {
    expect(typeof globalThis.crypto.subtle.digest).toBe("function");
    expect(typeof localStorage.setItem).toBe("function");
    const me = identityFromSeed(newIdentitySeed());
    expect(me.account.length).toBeGreaterThan(20);
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array([1, 2, 3]));
    expect(toBase64url(new Uint8Array(digest)).length).toBeGreaterThan(10);
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveKey"]);
    expect(key.type).toBe("secret");
    expect(typeof indexedDB).toBe("undefined");
  });
});
